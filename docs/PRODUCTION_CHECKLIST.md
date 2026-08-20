# Production checklist

> Статус: OPERATIONAL. Не выводить secrets и не выполнять пункты на production без отдельного разрешения.

## Инфраструктура и данные

- [ ] Перед deploy PostgreSQL-target версии выполнен отдельный утверждённый production cutover; пока production SQLite, deploy заблокирован организационно.
- [ ] PostgreSQL schema применена только через `prisma migrate deploy`, статус migration history проверен.
- [ ] SQLite source backup и PostgreSQL backup хранятся отдельно, restore обоих проверен.

- [ ] DNS и HTTPS работают; HTTP перенаправляется на HTTPS.
- [ ] Caddy слушает 80/443, `zabota-web` опубликован только на `127.0.0.1:4000`.
- [ ] `/`, `/app`, `/api/health` и публичные `/legal/*` доступны.
- [ ] `/opt/zabota/data:/data` подключён; база — `/data/zabota.db`, uploads — `/data/uploads`.
- [ ] Перед обновлением созданы backup DB и env без вывода секретов.
- [ ] `SEED_DEMO_DATA=false`; demo users/data не создаются.
- [ ] SQLite backup проверен восстановлением на отдельном пути.
- [ ] Rollback не удаляет `/opt/zabota/data`.
- [ ] Перед lifecycle-действиями проверить `/api/admin/category-structures/:id/dependencies` и сделать backup БД.
- [ ] Не удалять active или историческую структуру ради повторного использования номера.
- [ ] После emergency disable проверить effective fallback и список временно скрытых заявок.
- [ ] Pending structure update отсутствует в общей выдаче Помощников и возвращается после подтверждения Заказчиком.

## Production flags

- [ ] `PAYMENT_PROVIDER=tbank`.
- [ ] `TBANK_TERMINAL_MODE=live`.
- [ ] `PAYMENT_RECEIPT_ENABLED=false`.
- [ ] `ALLOW_LEGACY_MOCK_TOP_UP=false`.
- [ ] `DEFAULT_SERVICE_FEE_AMOUNT=50`.
- [ ] Ключи заполнены в production env, но не выведены в лог/отчёт.

## Платежи

- [ ] Подписанный `CONFIRMED` webhook с совпадающей суммой зачисляет баланс один раз.
- [ ] Повторный webhook/GetState не создаёт второй `payment_credit:<paymentId>`.
- [ ] Live top-up/refund отражается в реестре «Мой налог»; internal fee ledger не отражается.
- [ ] Test/mock операции не попадают в NPD register.
- [ ] Partial refund и insufficient main balance переводятся в manual review без отрицательного баланса.
- [ ] Manager видит платежи read-only и не может refund/refresh/update.
- [ ] Онлайн-касса не включена.

## Workflow v2

- [ ] Каталог показывает четыре направления в стабильном порядке и принимает `selectedTasks[]`.
- [ ] График 5 дней × 3 слота × 2 часа даёт 15 визитов и 30 часов.
- [ ] Создание заявки не создаёт fee ledger, batch, финальные visits или allocations.
- [ ] Первое подтверждение не списывает средства.
- [ ] Второе подтверждение списывает 750 ₽ с каждой стороны для 15 визитов.
- [ ] Неуспех любой стороны не оставляет частичных списаний/визитов/batch и не открывает адрес.
- [ ] Повторное/параллельное подтверждение не создаёт дублей.
- [ ] Bonus расходуется раньше main; allocations соответствуют source ledger.
- [ ] Reserve разделяет main и bonus, reconciliation идемпотентен.
- [ ] `VISIT_RECONCILIATION_ENABLED=true`, interval валиден, startup catch-up включён.
- [ ] В admin summary видны последнее успешное/ошибочное выполнение и ближайший запуск.
- [ ] Спор удерживает allocations одного визита и не вызывает банковский refund.
- [ ] Manager не разрешает спор и не запускает reconciliation.
- [ ] График с визитами 60/120/180 минут показывает индивидуальные цены и итог как сумму визитов.
- [ ] Legacy заявка читается без переписывания snapshot.

## Категории, сообщения и файлы

- [ ] Effective fallback `city -> region -> federal` проверен.
- [ ] Импорт создаёт draft и не меняет active автоматически.
- [ ] Маркетинговая рассылка исключает пользователей без согласия.
- [ ] Service-message attachments хранятся в `/data/uploads/service-messages` и скачиваются через protected endpoint.
- [ ] Прямой `/uploads/service-messages/...` закрыт.
- [ ] Весь `/uploads` закрыт для публичного доступа; документы Помощников скачиваются только через `/api/performer-documents/:id/download`.
- [ ] Проекты договоров хранятся в `/data/uploads/agreement-contracts` и скачиваются только через `/api/agreement-contracts/:id/download`.

## Документация и rollback

- [ ] Source of truth, documentation index и domain docs соответствуют release.
- [ ] Known limitations не выданы за готовые функции.
- [ ] Выполнены `npm run check`, `npm test`, `npm run build`, Docker build и `git diff --check`.
- [ ] Для rollback сохранены предыдущий image/tag, DB backup и env backup.
# User Management & Security

- [ ] В backup-копии подтверждён ровно один active `superadmin`.
- [ ] Legacy-пользователи `admin`, если есть, проверены вручную; автоматического повышения до `superadmin` нет.
- [ ] Существующий пользователь входит со старым bcrypt-паролем.
- [ ] Сброс пароля отзывает старый JWT и требует обязательной смены.
- [ ] Временный пароль отсутствует в AuditLog, логах и сервисных сообщениях.
- [ ] `TEMPORARY_PASSWORD_TTL_HOURS` не обязателен; безопасный default равен 24 часам.
# Service Structure Tree v3

- Сделать резервную копию БД.
- Импортировать v3 как draft и проверить preview/compare.
- Проверить effective tree, dynamic fields, blocking safety и pricing breakdown на тестовом городе.
- Проверить legacy structure/snapshot compatibility.
- Проверить empty/partial draft, autosave conflict, publish idempotency и support reply.
- Активировать слои только вручную; `db:seed-service-tree-v3` публикацию не выполняет.
