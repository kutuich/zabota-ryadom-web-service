# Заявка, согласование и визиты v2

> Статус: ACTIVE TECHNICAL DOCUMENT. Продуктовые правила задаёт [source of truth](../ZABOTA_RYADOM_CURRENT_SOURCE_OF_TRUTH.md).

## Модели и связи

```text
ClientRequest
  -> RequestCategorySnapshot (предварительный snapshot schemaVersion=2)
  -> RequestResponse -> Chat
  -> AgreementVersion[]
       -> RequestVisit[]
       -> ServiceFeeAgreementBatch (один на версию)
            -> ServiceFeeVisitAllocation[]
  -> RequestVisitDispute[]
```

`Chat` сохраняет агрегированные legacy-compatible поля условий, но каноническая версия задач и графика — `AgreementVersion`. Исторические snapshot и версии не переписываются.

## API

- `GET /api/categories/for-request?cityId=...` — плоский каталог effective structure.
- `POST /api/requests/calculate-price` — backend quote для `selectedTasks[]` и конечного графика.
- `POST /api/requests` — предварительная заявка и snapshot v2.
- `PATCH /api/chats/:id/terms` — новая версия условий, reset подтверждений.
- `POST /api/chats/:id/client-confirm` — подтверждение Заказчика.
- `POST /api/chats/:id/performer-confirm` — подтверждение Помощника.
- `GET /api/visits/request/:requestId` — визиты участника; admin/manager имеют read access.
- `POST /api/visits/:visitId/disputes` — открыть спор по визиту.
- `GET /api/admin/visits/reserve-summary` — read-only summary для manager/admin/superadmin.
- `POST /api/admin/visits/reconcile` — только admin/superadmin.
- `POST /api/admin/visits/disputes/:id/resolve` — только admin/superadmin.

## Snapshot v2

`RequestCategorySnapshot.snapshotJson` содержит `schemaVersion: 2`, effective structure и fallback, Подопечного, `selectedTasks`, `scheduleRules`, preliminary expanded visits, visit count, total duration, pricing breakdown, unpriced tasks, fee totals, safety warnings и timestamp.

Это предварительная версия. При согласовании `AgreementVersion` заново разворачивает schedule backend-ом и сохраняет:

- `selectedTasksJson`;
- `scheduleRulesJson`;
- `expandedVisitsJson`;
- `pricingSnapshotJson`;
- индивидуальную согласованную сумму и pricing breakdown каждого визита, а также итог за период;
- число визитов и минут;
- сборы за период;
- `termsHash` и timestamps подтверждений.

## График

`RequestScheduleInput` поддерживает `urgent_today`, `once`, `daily`, `weekly`, `several_weekly`, `regular_schedule`. Повторяющийся график обязан иметь `endDate`, `weeksCount` или `visitCount`. Один slot содержит `startTime` и `durationMinutes`; end time вычисляется backend.

Несколько слотов в день сортируются и не могут пересекаться. Все даты строятся в `City.timezone`. Frontend totals никогда не принимаются как источник истины.

```text
5 дней × 3 слота = 15 визитов
5 × (60 + 120 + 180 минут) = 1 800 минут = 30 часов
```

## Lifecycle

1. `POST /api/requests` создаёт `draft/private`; сборы, batch и финальные visits отсутствуют.
2. Publish и response используют legacy-compatible статусы.
3. Accept response открывает `Chat`; чат доступен до оплаты.
4. `PATCH /terms` создаёт draft `AgreementVersion`, supersedes предыдущую и ставит request в `discussion`.
5. Первое подтверждение фиксирует timestamp и статус ожидания второй стороны; денег не списывает.
6. Второе подтверждение вызывает `finalizeAgreementIfReady()`.
7. При недостатке средств request/chat получают `waiting_client_balance` либо `waiting_performer_balance`; финансовых сущностей нет.
8. При успехе request=`in_progress`, chat=`in_work`, AgreementVersion=`finalized`.

## Финализация и идемпотентность

Финализация выполняется одной Prisma-транзакцией. Claim — условный update `Chat.agreementFinalizedAt IS NULL` и `status != in_work`. Batch имеет unique `agreementVersionId` и ключ `agreement_fee_batch:<agreementVersionId>`.

Перед claim backend проверяет целостность версии: число визитов, сумму индивидуальных `agreedHelpAmount` и `termsHash`. Frontend totals/end time/fees не используются. `RequestVisit` получает собственные `helpAmount` и `pricingBreakdownJson` из подтверждённой immutable-версии.

Ledger prefixes:

```text
agreement_fee_batch:<batchId>:customer:bonus|main
agreement_fee_batch:<batchId>:helper:bonus|main
```

Дополнительные unique guards:

- `(agreementVersionId, sequence)` для визитов;
- `(visitId, side)` для allocations;
- unique `BalanceTransaction.idempotencyKey`.

Повторное и параллельное подтверждение не создаёт второй batch или ledger.

## Балансы и allocations

Доступно `balance + bonusBalance`. Сначала списывается bonus, затем main. На источник создаётся отдельная ledger-запись. Каждая allocation хранит `feeAmount`, `mainBalanceAmount`, `bonusBalanceAmount`, `sourceLedgerEntriesJson`.

За `N` визитов каждая сторона оплачивает `N × 50 ₽`. Если любой стороне не хватает полной суммы, транзакция не создаёт частичное состояние.

## Reserve и reconciliation

Allocation начинает в `reserved`. `reconcileDueVisits()` выбирает визиты `scheduled/in_work` с `autoCloseAt <= now` без открытого спора, атомарно переводит визит в `completed`, а allocations — в `released`, и пишет AuditLog. Повторный запуск идемпотентен и служит catch-up после перезапуска.

`visitReconciliationScheduler` запускает catch-up при старте и затем выполняет reconcile по интервалу. In-process mutex не допускает параллельный run, timer использует `unref()` и останавливается вместе с HTTP server. Настройки: `VISIT_RECONCILIATION_ENABLED`, `VISIT_RECONCILIATION_INTERVAL_MINUTES`, `VISIT_RECONCILIATION_RUN_ON_STARTUP`. Ручной admin endpoint и lazy reconcile при чтении сохранены.

`reserveSummary()` разделяет main-funded money reserve, bonus obligations и их общий operational risk. Это аналитика, не банковский баланс и не доказательство выполнения визита.

## Споры и права

Участник, admin или superadmin может открыть спор по доступному визиту. Manager не получает право открыть чужой спор. Открытый спор удерживает только allocations этого визита в `disputed`.

Admin/superadmin выбирает `keep_fee` или `return_to_source`. Возврат создаёт idempotent ledger отдельно в main и bonus. T-Bank refund не вызывается. Manager видит summary, но не reconcile/resolve.

## Приватность

До `in_work` Помощник не получает точный адрес и контактные поля. После `in_work` текущая политика открывает дом, но не квартиру, подъезд, этаж, домофон, private comment и телефон. DTO строятся policy serializer-ом.

## UI

Форма идёт вертикально по восьми секциям; ошибки backend имеют `details.validationErrors[{path,message}]`, UI фокусирует первое поле. На mobile используется верхняя sticky-навигация, форма не перекрывается нижней панелью. Карточки нескольких визитов имеют стабильную ширину и не создают horizontal overflow.

## Legacy compatibility

Старые заявки читаются из legacy-полей. Если у чата нет snapshot v2, первое сохранение условий строит один визит из `agreedScheduledAt` или даты/длительности заявки. История не мигрируется автоматически.

## Ограничения

- Изменение финализированного графика и расчёт финансовой дельты не реализованы.
- Auto-close означает только внутреннюю сверку по сроку и отсутствию спора.
- Юридический эффект agreement data не утверждён.
- Автоматического банковского возврата по спору нет.
- Scheduler lock рассчитан на один application instance; distributed lock не реализован.
