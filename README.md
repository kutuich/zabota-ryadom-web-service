# Забота Рядом

Web-сервис бытовой помощи семье, дому и близким. Заказчик создаёт заявку, Помощник откликается, стороны согласуют конечный график в чате и подтверждают одну версию условий.

Продуктовая архитектура и требования утверждаются в Notion. Репозиторий фиксирует фактическую реализацию, технические контракты и эксплуатационные инструкции; карта документов находится в [`docs/DOCUMENTATION_INDEX.md`](docs/DOCUMENTATION_INDEX.md).

## Стек

- React, TypeScript, Vite, plain CSS;
- Node.js, NestJS, TypeScript; NestJS работает на стандартном Express HTTP adapter без legacy router bridge;
- Prisma и PostgreSQL 16; SQLite поддерживается только как источник миграционной репетиции;
- private S3-compatible object storage через заменяемый adapter; local filesystem остаётся dev/test и rollback provider до production cutover;
- Argon2id; короткий JWT access token в памяти клиента и rotating HttpOnly refresh-session; OAuth VK ID включается env-флагами;
- Docker; production HTTPS через Caddy;
- mock и T-Bank adapters для пополнения внутреннего баланса.

## Локальный запуск

Проект закреплён на Node.js 22 LTS (`.nvmrc`, `package.json#engines`), как и Docker runtime.

```bash
cp .env.example .env
npm install
npm run db:generate
docker compose -f compose.postgres-rehearsal.yml up -d
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

- frontend: `http://localhost:5173`;
- backend health: `http://localhost:4000/api/health`.
- Swagger UI: `http://localhost:4000/api/docs` (вне production по умолчанию);
- OpenAPI JSON: `http://localhost:4000/api/openapi.json` (вне production по умолчанию).

Локальные безопасные значения: `PAYMENT_PROVIDER=mock`, `TBANK_TERMINAL_MODE=test`, `PAYMENT_RECEIPT_ENABLED=false`, `ALLOW_LEGACY_MOCK_TOP_UP=false`. Секреты из examples необходимо заменить; реальные значения не коммитятся.

## Демо и Docker

`npm run db:reset-demo` очищает только явно выбранную локальную demo-базу и создаёт повторяемый набор тестовых данных. Перед запуском проверьте `DATABASE_URL`; команду нельзя направлять на production.

```bash
cp .env.preview.example .env.preview
docker build --target migration -t zabota-migration .
docker run --rm --env-file .env.preview zabota-migration
docker build --target runner -t zabota-web-service .
docker run --rm -p 4000:4000 --env-file .env.preview -v zabota-local-data:/data zabota-web-service
```

Локальный PostgreSQL запускается через `compose.postgres-rehearsal.yml`. По умолчанию files использует local adapter; MinIO-контур и перенос описаны в [`docs/OBJECT_STORAGE.md`](docs/OBJECT_STORAGE.md).

На macOS `start-zabota-local.command` собирает и запускает локальный контейнер, а `stop-zabota-local.command` его останавливает. Флаг `SEED_DEMO_DATA=true` допустим только для локальной demo-среды.

## Workflow заявки v2

Новая форма получает effective category structure по цепочке `city -> region -> federal`, показывает четыре направления и сохраняет `selectedTasks[]` со snapshot schema v2. Конечный график разворачивается в конкретные визиты. Несколько непересекающихся слотов в день поддерживаются.

Создание заявки не списывает баланс. После отклика чат открывается до списания. Сохранение условий создаёт новую `AgreementVersion` и сбрасывает подтверждения. Второе подтверждение атомарно создаёт визиты, fee batch, allocations и ledger. Сбор равен 50 ₽ с каждой стороны за каждый визит.

Каждый визит рассчитывается и сохраняется отдельно; итог конечного графика равен сумме визитов. Reconciliation запускается автоматически по безопасному интервалу, вручную admin и при чтении как fallback. Текущий scheduler предназначен для одного application instance.

Подробности:

- [`docs/REQUEST_WORKFLOW_V2.md`](docs/REQUEST_WORKFLOW_V2.md);
- [`docs/REQUEST_CALCULATOR.md`](docs/REQUEST_CALCULATOR.md);
- [`docs/CATEGORY_STRUCTURES.md`](docs/CATEGORY_STRUCTURES.md);
- [`docs/AGREEMENT_SCHEDULE_TECHNICAL_DRAFT.md`](docs/AGREEMENT_SCHEDULE_TECHNICAL_DRAFT.md).

## Основные команды

```bash
npm run check
npm test
npm run build
npm run api:openapi
npm run auth:credential-inventory
npm run storage:inventory -- --output=storage-migration-reports/inventory.json
npm run visual:audit
npm run db:generate
```

Локально schema применяется через `npm run db:migrate:deploy`. Production-style процесс использует отдельный migration target/service перед application runner; application startup Prisma CLI не вызывает. Репетиция SQLite -> PostgreSQL описана в [`docs/POSTGRESQL_MIGRATION_REHEARSAL.md`](docs/POSTGRESQL_MIGRATION_REHEARSAL.md).
Правила генерации и проверки фактического API contract описаны в [`docs/API_OPENAPI.md`](docs/API_OPENAPI.md); generated JSON не хранится в Git.

## Структура

- `backend/prisma/schema.prisma` — модель данных;
- `backend/src/nest` — NestJS bootstrap, domain modules, controllers, guards, lifecycle и общая HTTP infrastructure;
- `backend/src/services` — доменная логика;
- `frontend/src` — приложение и ролевые кабинеты;
- `landing-public` — публичные статические страницы;
- `scripts` и `*.command` — локальный запуск, аудит и production operations;
- `docs` — технические и operational документы.

## Production

Текущая архитектура: Caddy принимает 80/443, контейнер `zabota-web` доступен только на `127.0.0.1:4000`, `/opt/zabota/data` монтируется в `/data`. Текущее заявленное платёжное состояние и безопасные read-only проверки зафиксированы в [`docs/PRODUCTION_CURRENT_STATE.md`](docs/PRODUCTION_CURRENT_STATE.md). Deploy выполняется только по отдельной команде пользователя.

Инструкции:

- [`docs/DEPLOY_TIMEWEB.md`](docs/DEPLOY_TIMEWEB.md);
- [`docs/PRODUCTION_CHECKLIST.md`](docs/PRODUCTION_CHECKLIST.md);
- [`SECURITY_PRODUCTION_CHECKLIST.md`](SECURITY_PRODUCTION_CHECKLIST.md);
- [`docs/TBANK_PAYMENT_SETUP.md`](docs/TBANK_PAYMENT_SETUP.md).

## Известные ограничения

- изменение уже финализированного графика с финансовой дельтой не реализовано;
- соглашение о графике остаётся техническим черновиком до юридического утверждения;
- частичный банковский возврат требует ручной проверки;
- текущий production остаётся на SQLite до отдельного контролируемого cutover; код этого этапа нельзя деплоить до миграции production данных;
- runtime ownership всех HTTP endpoints перенесён в NestJS; полный inventory зафиксирован в [`docs/NESTJS_MIGRATION.md`](docs/NESTJS_MIGRATION.md);
- встроенное геокодирование Яндекс.Карт не подключено;
- внешняя отправка сервисных сообщений по email/SMS не реализована.
