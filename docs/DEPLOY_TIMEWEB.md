# Деплой на Timeweb

> Статус: OPERATIONAL. Выполнять только по отдельному разрешению. Текущее состояние: [PRODUCTION_CURRENT_STATE.md](PRODUCTION_CURRENT_STATE.md).

> Важно: текущий production остаётся на SQLite, а основной Prisma provider репозитория подготовлен для PostgreSQL. Обычный deploy этой версии запрещён до отдельного production migration/cutover. Локальная репетиция описана в [POSTGRESQL_MIGRATION_REHEARSAL.md](POSTGRESQL_MIGRATION_REHEARSAL.md).

## Архитектура

```text
Internet -> Caddy :80/:443 -> 127.0.0.1:4000 -> Compose backend:4000
                                             -> /opt/zabota/data:/data
                              Compose postgres -> persistent Docker volume
                              Compose migrate  -> one-shot prisma migrate deploy
```

Application container отдаёт landing `/`, React `/app`, legal `/legal/*` и API `/api/*`. Caddyfile: `/etc/caddy/Caddyfile`. PostgreSQL data и uploads не входят в image. Текущий live production всё ещё остаётся на описанной в `PRODUCTION_CURRENT_STATE.md` SQLite-схеме до отдельного cutover.

## Матрица сред

| Среда | PAYMENT_PROVIDER | TBANK_TERMINAL_MODE | SEED_DEMO_DATA | ALLOW_LEGACY_MOCK_TOP_UP |
|---|---|---|---|---|
| Local development | mock | test | false/ручной seed | false |
| Local demo | mock | test | true | false |
| T-Bank test terminal | tbank | test | false | false |
| Current production live | tbank | live | false | false |

Во всех средах `PAYMENT_RECEIPT_ENABLED=false`, пока онлайн-касса не пройдёт отдельную проверку. Production нельзя переключать обратно на mock обычным deploy-скриптом.

## Production env без секретов

`.env.production.example` показывает имена переменных и текущие флаги. Реальный `/opt/zabota/repo/.env.production` не читается и не коммитится.

Обязательные несекретные значения:

```env
NODE_ENV=production
PORT=4000
APP_BASE_URL=https://zabota-ugorsk.ru
PUBLIC_SITE_URL=https://zabota-ugorsk.ru
DATABASE_URL=postgresql://APP_USER:REPLACE_ME@POSTGRES_HOST:5432/zabota?schema=public
POSTGRES_USER=APP_USER
POSTGRES_PASSWORD=REPLACE_ME
POSTGRES_DB=zabota
APP_ENV_FILE=.env.production
APP_HOST_PORT=4000
ZABOTA_DATA_PATH=/opt/zabota/data
CORS_ORIGIN=https://zabota-ugorsk.ru
UPLOADS_DIR=/data/uploads
DEFAULT_SERVICE_FEE_AMOUNT=50
DEFAULT_MIN_TOP_UP_AMOUNT=150
PAYMENT_PROVIDER=tbank
TBANK_TERMINAL_MODE=live
PAYMENT_RECEIPT_ENABLED=false
ALLOW_LEGACY_MOCK_TOP_UP=false
SEED_DEMO_DATA=false
```

T-Bank URLs используют HTTPS. Credentials и JWT существуют только в env. OAuth flags изменяются отдельной задачей после проверки callback.

## Перед deploy

1. Проверить `git status` и release diff.
2. Выполнить `npm run check`, `npm test`, `npm run build`, Docker build.
3. До PostgreSQL cutover создать timestamped backup `/opt/zabota/data/zabota.db` и `.env.production` без печати содержимого; после cutover использовать проверенный PostgreSQL backup плюс backup uploads.
4. Проверить свободное место и существование `/opt/zabota/data/uploads`.
5. Не запускать prune с volumes и не удалять data directory.

## Migration и application rollout

`compose.production.yml` разделяет три ответственности:

- `postgres` хранит данные в persistent named volume и имеет `pg_isready` healthcheck;
- `migrate` собран из Docker target `migration`, содержит Prisma CLI и выполняет только `prisma migrate deploy`;
- `backend` собран из target `runner`, содержит `@prisma/client`, но не содержит Prisma CLI и не изменяет schema при startup.

Контролируемый порядок deployment:

```bash
docker compose --env-file .env.production -f compose.production.yml build migrate backend
docker compose --env-file .env.production -f compose.production.yml up -d --wait postgres
docker compose --env-file .env.production -f compose.production.yml run --rm migrate
docker compose --env-file .env.production -f compose.production.yml up -d --no-deps backend
```

`deploy-zabota-production.command` использует этот порядок только после отдельного разрешения и PostgreSQL cutover. Он не останавливает предыдущий standalone application container до успешного завершения migration step. Любая ошибка `migrate deploy` возвращает non-zero и прерывает rollout до запуска новой версии backend. `depends_on.condition: service_healthy` обеспечивает DB readiness, а `service_completed_successfully` не позволяет Compose запустить backend после failed migration.

Application startup по-прежнему выполняет только безопасный bootstrap системных данных и опциональный явно включённый seed/bootstrap администратора; Prisma CLI он не вызывает. `db push`, reset и изменение migration history в production запрещены.

## Health и smoke

```bash
curl -i http://127.0.0.1:4000/api/health
curl -i https://zabota-ugorsk.ru/api/health
curl -I http://zabota-ugorsk.ru
```

Затем открыть `/`, `/app`, `/legal/privacy`, проверить login, workflow v2 и read-only admin screens. Банковский Init/Cancel не является частью обычного deploy smoke.

## Caddy

```caddyfile
zabota-ugorsk.ru {
    encode gzip
    reverse_proxy 127.0.0.1:4000
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }
}
```

Проверка:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl status caddy --no-pager
journalctl -u caddy --no-pager -n 100
```

Настройка первого HTTPS описана в `scripts/setup-https-caddy-timeweb.sh`; повторно запускать её без необходимости не нужно.

## Payment verification

Текущий production live не означает разрешение выполнять тестовый платёж при каждом deploy. Webhook остаётся основным подтверждением, GetState — резервным. Ручной test-terminal checklist выполняется только в отдельном контуре по [PAYMENT_TEST_CHECKLIST.md](PAYMENT_TEST_CHECKLIST.md).

Проверить без секретов:

- provider/mode отображаются как live в разрешённом admin UI;
- legacy mock top-up возвращает запрет;
- receipt выключен;
- повторный webhook не дублирует balance credit;
- internal service-fee ledger не попадает в NPD register.

## Safe rollback

1. При failure migration step новая версия application не запускается; исправить migration/config и повторить one-shot job.
2. После успешной совместимой migration предыдущий application image можно вернуть только если он совместим с новой schema.
3. Prisma migrations считаются forward-only deployment boundary: автоматического schema rollback нет.
4. При несовместимой schema остановить application и восстановить проверенный PostgreSQL backup вместе с предыдущим image по отдельно утверждённому rollback-плану.
5. Не изменять и не удалять `/opt/zabota/data` или PostgreSQL volume; проверить local/public health и Caddy.

Временная публикация container на внешнем 80 допустима только как аварийная ручная мера после остановки Caddy; после восстановления вернуть `127.0.0.1:4000`.

Запрещены `docker volume prune`, `docker system prune -a --volumes`, destructive Prisma push и любые команды удаления `/opt/zabota/data`.
