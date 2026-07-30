# Проверка production-безопасности

> Статус: OPERATIONAL. Текущее состояние без секретов: [`docs/PRODUCTION_CURRENT_STATE.md`](docs/PRODUCTION_CURRENT_STATE.md).

## Secrets и сеть

- production `JWT_SECRET`, T-Bank и OAuth credentials хранятся только в env;
- logs/API не возвращают secrets, tokens или raw банковские credentials;
- CORS разрешает только production origin;
- Caddy принимает 80/443, приложение слушает host localhost;
- webhook проверяет Token, terminal/order/payment ids и amount.

## База и файлы

Текущий production использует SQLite на persistent storage с обязательным backup. PostgreSQL требуется перед горизонтальным масштабированием, несколькими пишущими инстансами или ростом конкурентной записи.

- `/opt/zabota/data` не удаляется при deploy/rollback;
- DB и uploads регулярно резервируются и проверяются восстановлением;
- service-message attachments скачиваются только через protected endpoint;
- production не запускает demo seed и legacy mock top-up.

## Workflow v2

- ownership проверяется для request/chat/visit/dispute;
- точный адрес и contact fields проходят allowlist DTO;
- одна версия условий подтверждается обеими сторонами;
- batch claim, unique constraints и ledger idempotency защищают от двойной финализации;
- проверка полной суммы обеих сторон предшествует списанию;
- main/bonus ledger и allocations сохраняют источник;
- manager не получает admin dispute/financial permissions;
- действия открытия/закрытия/решения спора пишутся в AuditLog;
- спор не вызывает T-Bank refund.

## Legal и аккаунты

- опубликованные legal versions не редактируются;
- required consents и content hash проверяются;
- OAuth не назначает admin;
- acting mode выдаётся только подписанной backend-сессией;
- архивирование сохраняет финансовую, legal и message history.

## Payments

- `PAYMENT_PROVIDER=tbank`, `TBANK_TERMINAL_MODE=live`, receipt выключен;
- payment credit и refunds атомарны и идемпотентны;
- test/mock/internal fee operations исключены из NPD register;
- partial refund требует manual review;
- online касса не включается без отдельной юридической и технической проверки.
