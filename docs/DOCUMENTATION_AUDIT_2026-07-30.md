# Аудит архитектуры и документации — 2026-07-30

> Статус: HISTORICAL AUDIT REPORT. Не является источником текущих требований. Актуальные правила: [source of truth](../ZABOTA_RYADOM_CURRENT_SOURCE_OF_TRUTH.md).

## 1. Git и границы аудита

- Ветка: `main`.
- Последний commit в начале аудита: `a7d7c24 Improve category structures communications and request calculator`.
- Рабочее дерево содержало незакоммиченную реализацию request workflow v2; она новее последнего commit и считалась частью фактической архитектуры.
- Reset, restore, checkout, clean, commit и push не выполнялись.
- Production DB/env не читались и не изменялись. Состояние T-Bank live зафиксировано по утверждённому решению задачи, а не по secrets.

## 2. Фактическая архитектура workflow v2

Реализованы `AgreementVersion`, `RequestVisit`, `ServiceFeeAgreementBatch`, `ServiceFeeVisitAllocation`, `RequestVisitDispute` и связи с `ClientRequest`/`Chat`. Предварительная заявка хранит `RequestCategorySnapshot` schema v2; финальные visits появляются только после двойного подтверждения.

Lifecycle проверен по routes/services:

```text
calculate-price -> create draft -> publish -> response -> accept/open chat
-> PATCH terms/new AgreementVersion -> customer/helper confirmations
-> atomic claim -> batch + visits + allocations + ledger -> in_work/in_progress
-> reconciliation или dispute -> admin resolution
```

Сборы используют 50 ₽ × visits для каждой стороны. Сначала списывается bonus, затем main. Idempotency обеспечивают chat claim, unique batch/version, visit/version+sequence, allocation/visit+side и ledger keys.

Reserve считает main-funded money reserve и bonus obligations отдельно. Спор относится к одному visit и не вызывает банковский refund. Manager получает read-only summary; reconcile/resolve требуют admin/superadmin.

## 3. Несоответствия кода

| Severity | Файл | Проблема | Статус |
|---|---|---|---|
| P1 | `AgreedTermsSummary.tsx`, `ChatPanel.tsx`, `PriceSummary.tsx`, `AdminDashboard.tsx` | UI/exports описывали стоимость как доход Помощника после удержания, хотя оплата проходит напрямую | Исправлено: стоимость и оба сбора показаны отдельно, backend compatibility fields сохранены |
| P1 | `scripts/visual-audit.mjs` | Login и data-dependent ролевые экраны делали audit недетерминированным | Исправлено: frontend-only `/app/audit/*` fixtures не требуют auth/API/DB, audit проверяет desktop/laptop/mobile и validation state |
| P2 | `requestScheduleService.ts` | Для графика со слотами разной длительности pricing использовал одну сумму | Исправлено: каждый visit рассчитывается по своей длительности, period total равен точной сумме visits |
| P2 | `visitOperationsService.ts` | Reconciliation запускался lazy/read или вручную | Исправлено: startup catch-up и interval scheduler с mutex/diagnostics; manual и lazy пути сохранены |
| P2 | `chats.ts` | Финализированный график нельзя изменить; финансовая delta/replacement workflow отсутствует | Не исправлено; отдельный следующий этап |
| P3 | `visitOperationsService.ts` | Функция принимала `client`, но inner transaction использовал global `prisma` | Исправлено: transaction выполняется через переданный client |

## 4. Противоречия документации

| Файл | Устаревшая формулировка | Новая формулировка | Статус |
|---|---|---|---|
| `README.md` | Большой второй source, legacy categories, mock как production, будущая ЮKassa | Короткий onboarding, workflow v2, ссылки на domain docs, current production architecture | Переписан |
| `AGENTS.md` | Нет index/change process и правил v2 | Обязательная иерархия, selectedTasks, конечный график, fee per visit, отчётность | Переписан |
| Source of truth | Старые package/fee примеры, net-income wording, противоречащие env sections | Единый workflow v2, direct payment, 50/50 per visit, live production matrix, limitations | Переписан |
| `REQUEST_CALCULATOR.md` | Legacy single-extra-task модель | `selectedTasks[]`, effective rules, no double count, unpriced tasks, per-period totals | Переписан |
| `CATEGORY_STRUCTURES.md` | Snapshot с одной дополнительной задачей | Flat catalog, selectedTasks, snapshot v2, expanded visits | Переписан |
| `PRODUCTION_CHECKLIST.md` | Mock/test flags как production и старая форма | Live flags и проверки 15 visits/double confirm/main+bonus/reserve/dispute | Переписан |
| `DEPLOY_TIMEWEB.md` | Инструкция могла вернуть production на mock | Environment matrix и current live без secrets | Переписан |
| Security checklist | Production назывался preview; PostgreSQL требовался немедленно | SQLite single-instance с persistent backup; PostgreSQL перед scaling | Переписан |
| Payment docs | Test checklist предполагал возврат production к mock | Test terminal отделён от current live; внутренние fees/reserve отделены от bank/NPD | Переписан |
| `landing-public/README.md` | Routing описан как будущий | Фактические `/`, `/app`, `/api`, `/legal/*` | Обновлён |

## 5. Обновлённые документы

- `AGENTS.md`, `README.md`, `SECURITY_PRODUCTION_CHECKLIST.md`;
- `ZABOTA_RYADOM_CURRENT_SOURCE_OF_TRUTH.md`;
- `docs/REQUEST_WORKFLOW_V2.md`, `REQUEST_CALCULATOR.md`;
- `docs/CATEGORY_STRUCTURES.md`, `CATEGORY_IMPORT_EXPORT.md`;
- `docs/AGREEMENT_SCHEDULE_TECHNICAL_DRAFT.md`;
- `docs/TBANK_PAYMENT_SETUP.md`, `PAYMENT_TEST_CHECKLIST.md`;
- `docs/PRODUCTION_CHECKLIST.md`, `DEPLOY_TIMEWEB.md`;
- `docs/SERVICE_MESSAGES_AND_BROADCASTS.md`, `vk-id-auth.md`;
- `docs/CODE_AUDIT_BUTTON.md`, `VISUAL_AUDIT_BUTTON.md`;
- `landing-public/README.md`, `.env.production.example`.

## 6. Созданные документы

- `docs/DOCUMENTATION_INDEX.md`;
- `docs/CHANGE_MANAGEMENT.md`;
- `docs/DECISIONS_LOG.md`;
- `docs/PRODUCTION_CURRENT_STATE.md`;
- `docs/DOCUMENTATION_AUDIT_2026-07-30.md`.

## 7. Historical/obsolete

Отдельных дублирующих Markdown-файлов, безопасно подлежащих удалению, не найдено. Устаревшее содержимое активных документов переписано на месте. Этот audit report и `DECISIONS_LOG.md` имеют статус historical; agreement schedule имеет статус technical draft. Файлов со статусом obsolete после синхронизации нет.

## 8. Изолированный E2E

Использована отдельная временная SQLite `/tmp/zabota-workflow-v2-stabilization-20260730.db`. Seed и API были направлены только в неё. Попытка финального удаления отклонена sandbox из-за лимита авторизации; файл не входит в репозиторий и не является working/production DB.

- schedule: 5 дней, по 3 слота на 60/120/180 минут;
- expanded: 15 visits, 1 800 минут / 30 часов;
- quote: 700/900/1 100 ₽ по длительности, 13 500 ₽ за период;
- fee: 750 ₽ Заказчик + 750 ₽ Помощник;
- создание заявки: 0 ledger, 0 final visits, 0 batch;
- первое подтверждение: 0 fee ledger;
- второе подтверждение: 1 batch, 15 visits, 30 allocations;
- funding: 550 ₽ bonus + 950 ₽ main;
- repeat/parallel confirm: batch и ledger не дублируются;
- dispute: 1 visit, 2 disputed allocations, остальные 28 released;
- repeated reconciliation: 0 повторных закрытий;
- admin return: 50 ₽ каждой стороне возвращены в исходный bonus bucket один раз;
- bank/NPD operations в сценарии не создавались.
- tampered agreement hash отклоняется до batch/ledger; после восстановления version happy path завершается.

## 9. Проверки

- `npm run db:generate` — успешно.
- `DATABASE_URL=<temporary> npm run db:push` — успешно, без `--accept-data-loss`.
- Seed временной DB — успешно.
- `npm run check` — успешно.
- `npm test` на временной DB — успешно, backend и frontend.
- `npm run build` — успешно; остаётся Vite warning о chunk >500 kB.
- `docker build -t zabota-web-service:documentation-audit-check .` — историческая сборка этапа аудита была успешна; это не считается отдельным vulnerability scan.
- `docker build -t zabota-web-service:workflow-v2-stabilization-check .` — не запущен: sandbox запретил доступ к Docker socket, а расширенный доступ был отклонён лимитом среды. Отдельный scanner образа на этом этапе не запускался.
- `npm run visual:audit` — скрипт полностью обновлён на workflow v2 и 23 детерминированных screenshots. Фактический browser-run в текущей sandbox не выполнен: bind локального server заблокирован (`EPERM`). Audit-enabled frontend build успешен.
- Markdown relative link check — успешно после создания этого отчёта.
- `git diff --check` — успешно после финальной проверки.

## 10. Production risks

- Live flags документированы по решению пользователя, но не подтверждались чтением production env.
- SQLite требует одного пишущего инстанса, persistent volume и проверяемых backups.
- Receipt/онлайн-касса выключены.
- Partial refunds требуют manual review.
- Visual/code audit scripts не должны печатать production logs с персональными данными или secrets.
- Deploy script способен менять production и остаётся только ручной операцией по отдельному разрешению.

## 11. Legal и незавершённое

- Agreement schedule — technical draft, юридический текст не утверждён.
- Автоматического bank refund по visit dispute нет.
- Изменение финализированного графика с финансовой delta отсутствует.
- Partial bank refund обрабатывается вручную.
- Reconciliation не доказывает фактическое выполнение визита.
- PostgreSQL migration остаётся задачей до horizontal scaling.
- In-process scheduler рассчитан на один instance. Перед horizontal scaling нужен DB/distributed lock.
- Mock visual audit проверяет layout/content, но не заменяет API E2E и ручную проверку экранной клавиатуры.

## 12. Рекомендованный следующий этап

1. Спроектировать amendment/version delta для финализированного графика.
2. Юридически утвердить договор и правила спора/возврата.
3. Провести visual audit в среде, где разрешён bind localhost, и просмотреть 23 screenshots.
4. Добавить distributed lock и external monitoring перед запуском нескольих instances.
5. Подготовить PostgreSQL migration plan до масштабирования.

### Этап стабилизации workflow v2

После исходного аудита закрыты три его технических ограничения:

- pricing разнородного графика стал per-visit; `AgreementVersion` и `RequestVisit` хранят индивидуальные суммы и breakdown;
- reconciliation получил startup/interval scheduler с in-process mutex, diagnostics, audit и graceful shutdown; manual/lazy fallback сохранён;
- visual audit переведён на изолированные workflow v2 fixtures для Заказчика, Помощника и admin;
- изменение финализированного графика и financial delta намеренно не реализованы; immutable guard сохранён.

Контрольный сценарий на временной SQLite подтвердил 15 визитов по 60/120/180 минут, точный итог 13 500 ₽, сборы 750/750 ₽, 30 allocations, main/bonus breakdown 950/550 ₽, идемпотентный dispute/reconcile/return-to-source. Production DB/env, T-Bank, NPD, deploy и git remote не затрагивались.

## 13. Полный список файлов рабочего дерева

Изменённые файлы:

- `.env.production.example`, `AGENTS.md`, `README.md`, `SECURITY_PRODUCTION_CHECKLIST.md`, `ZABOTA_RYADOM_CURRENT_SOURCE_OF_TRUTH.md`, `audit-zabota-code.command`;
- `backend/prisma/schema.prisma`;
- `backend/src/app.ts`, `backend/src/config/env.ts`;
- `backend/src/routes/categoryStructures.ts`, `backend/src/routes/chats.ts`, `backend/src/routes/requests.ts`;
- `backend/src/services/balanceService.ts`, `backend/src/tests/business.test.ts`, `backend/src/utils/http.ts`;
- `docs/CATEGORY_IMPORT_EXPORT.md`, `docs/CATEGORY_STRUCTURES.md`, `docs/CODE_AUDIT_BUTTON.md`, `docs/DEPLOY_BUTTON.md`, `docs/DEPLOY_TIMEWEB.md`;
- `docs/PAYMENT_TEST_CHECKLIST.md`, `docs/PRODUCTION_CHECKLIST.md`, `docs/REQUEST_CALCULATOR.md`, `docs/SERVICE_MESSAGES_AND_BROADCASTS.md`;
- `docs/TBANK_PAYMENT_SETUP.md`, `docs/VISUAL_AUDIT_BUTTON.md`, `docs/vk-id-auth.md`;
- `frontend/src/api/client.ts`;
- `frontend/src/components/AgreedTermsSummary.tsx`, `frontend/src/components/ChatPanel.tsx`, `frontend/src/components/CityCombobox.tsx`, `frontend/src/components/PriceSummary.tsx`;
- `frontend/src/pages/AdminDashboard.tsx`, `frontend/src/pages/ClientDashboard.tsx`, `frontend/src/pages/ManagerDashboard.tsx`;
- `frontend/src/routes/navigation.ts`, `frontend/src/styles/global.css`, `frontend/src/tests/navigationTerminology.test.ts`, `frontend/src/types/index.ts`;
- `landing-public/README.md`, `scripts/visual-audit.mjs`.

Новые файлы:

- `backend/src/routes/visits.ts`;
- `backend/src/services/agreementWorkflowService.ts`, `backend/src/services/requestScheduleService.ts`, `backend/src/services/visitOperationsService.ts`;
- `docs/AGREEMENT_SCHEDULE_TECHNICAL_DRAFT.md`, `docs/CHANGE_MANAGEMENT.md`, `docs/DECISIONS_LOG.md`;
- `docs/DOCUMENTATION_AUDIT_2026-07-30.md`, `docs/DOCUMENTATION_INDEX.md`, `docs/PRODUCTION_CURRENT_STATE.md`, `docs/REQUEST_WORKFLOW_V2.md`;
- `frontend/src/components/RequestCreationForm.tsx`, `frontend/src/components/VisitReservePanel.tsx`.

Этот список включает реализацию workflow v2, уже находившуюся в незакоммиченном рабочем дереве на момент начала аудита, и изменения документации/проверок текущей задачи. Чужие изменения не откатывались.
