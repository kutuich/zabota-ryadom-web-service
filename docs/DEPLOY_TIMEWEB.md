# Деплой на Timeweb

> Статус: OPERATIONAL. Выполнять только по отдельному разрешению. Текущее состояние: [PRODUCTION_CURRENT_STATE.md](PRODUCTION_CURRENT_STATE.md).

> Важно: после Production 12B production работает на PostgreSQL 16 и private S3-compatible storage. Forward-only boundary пройден; SQLite остаётся только historical/rollback/audit asset и не является deploy target.

## Архитектура

```text
GitHub main -> /opt/zabota/releases/<release-sha>
Internet -> Caddy :80/:443 -> 127.0.0.1:4100 -> Compose backend:4000
                              Compose postgres -> persistent Docker volume
                              Compose migrate  -> one-shot prisma migrate deploy
                              Backend storage  -> private S3-compatible bucket
```

Application container отдаёт landing `/`, React `/app`, legal `/legal/*` и API `/api/*`. Caddyfile: `/etc/caddy/Caddyfile`. PostgreSQL data находятся в persistent volume, а private objects — в S3; они не входят в application image и release directory.

## Матрица сред

| Среда | PAYMENT_PROVIDER | TBANK_TERMINAL_MODE | SEED_DEMO_DATA | ALLOW_LEGACY_MOCK_TOP_UP |
|---|---|---|---|---|
| Local development | mock | test | false/ручной seed | false |
| Local demo | mock | test | true | false |
| T-Bank test terminal | tbank | test | false | false |
| Current production live | tbank | live | false | false |

Во всех средах `PAYMENT_RECEIPT_ENABLED=false`, пока онлайн-касса не пройдёт отдельную проверку. Production нельзя переключать обратно на mock обычным deploy-скриптом.

## Production env без секретов

`.env.production.example` показывает имена переменных и текущие флаги. Реальный `/opt/zabota/releases/<active-sha>/.env.production` имеет mode `0600`, не входит в Git и без вывода значений переносится только в новый release directory. Historical `/opt/zabota/repo` не является production config source.

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
APP_HOST_PORT=4100
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

1. Полный release gate выполняет GitHub Actions `CI` для точного `main` SHA: PostgreSQL regression/contract tests, production build, OpenAPI, dependency audit, Docker targets и critical Playwright E2E должны завершиться успешно.
2. `deploy-zabota-production.command` работает только из clean `main`, точно совпадающего с `origin/main`, и fail-closed проверяет успешный GitHub `CI` для этого SHA. Скрипт не делает push/merge.
3. Локальный preflight требует Node.js 22 и выполняет `git diff --check`, `npm run check` и `npm run build`. Локальный `npm test` не дублируется: database-dependent suite уже прошёл в authoritative GitHub CI с PostgreSQL 16.
4. Перед изменением production скрипт сохраняет rollback image и создаёт fresh PostgreSQL backup с `pg_restore --list` и checksum verification.
5. До создания release/build/backup требуется не менее 3 GiB свободного места. Скрипт никогда не запускает prune и не удаляет images, backups, releases, volumes или data.

## Migration и application rollout

`compose.production.yml` разделяет три ответственности:

- `postgres` хранит данные в persistent named volume и имеет `pg_isready` healthcheck;
- `migrate` собран из Docker target `migration`, содержит Prisma CLI и выполняет только `prisma migrate deploy`;
- `backend` собран из target `runner`, содержит `@prisma/client`, но не содержит Prisma CLI и не изменяет schema при startup.

Контролируемый порядок deployment:

```bash
docker compose --project-name zabota-production --env-file .env.production -f compose.production.yml build migrate backend
docker compose --project-name zabota-production --env-file .env.production -f compose.production.yml up -d --wait postgres
docker compose --project-name zabota-production --env-file .env.production -f compose.production.yml run --rm migrate
docker compose --project-name zabota-production --env-file .env.production -f compose.production.yml up -d --no-deps backend
```

`deploy-zabota-production.command` определяет active release только из Compose-label реально запущенного backend и проверяет путь `/opt/zabota/releases/<full-sha>`. Новый approved GitHub SHA клонируется в новый неперезаписываемый release directory. Любая ошибка `migrate deploy` возвращает non-zero и прерывает rollout до переключения backend. `depends_on.condition: service_healthy` обеспечивает DB readiness, а `service_completed_successfully` не позволяет Compose запустить backend после failed migration.

Время успешного запуска нового backend фиксируется как консервативная `FORWARD_ONLY_BOUNDARY_UTC`: с этого момента новая версия может принимать PostgreSQL/S3 writes, поэтому автоматический DB rollback за эту границу запрещён.

Application startup по-прежнему выполняет только безопасный bootstrap системных данных и опциональный явно включённый seed/bootstrap администратора; Prisma CLI он не вызывает. `db push`, reset и изменение migration history в production запрещены.

## Аварийное восстановление доступа superadmin

Начиная с image, в который включён `reset-superadmin-password`, пароль существующего active `superadmin` можно заменить без изменения JWT/session secrets и без прямого SQL. Перед операцией подтвердить наличие актуального backup PostgreSQL и выполнять команду только из интерактивной SSH-сессии в каталоге актуального Compose release:

```bash
docker compose --project-name zabota-production --env-file .env.production -f compose.production.yml exec backend reset-superadmin-password
```

Пароль вводится скрыто дважды и не поддерживается как argument/env/pipe. Команда требует ровно один active `superadmin`; для неоднозначной базы допустим только несекретный `--user-id <id>`. Успешная операция ставит обязательную штатную смену временного пароля, отзывает все сессии выбранного пользователя и пишет безопасный audit event. Подробные инварианты: [USER_MANAGEMENT_AND_SECURITY.md](USER_MANAGEMENT_AND_SECURITY.md).

## Health и smoke

```bash
curl -i http://127.0.0.1:4100/api/health
curl -i https://zabota-ugorsk.ru/api/health
curl -i http://127.0.0.1:4100/api/ready
curl -i https://zabota-ugorsk.ru/api/ready
curl -I http://zabota-ugorsk.ru
```

Затем открыть `/`, `/app`, `/legal/privacy`, проверить login, workflow v2 и read-only admin screens. Банковский Init/Cancel не является частью обычного deploy smoke.

## Caddy

```caddyfile
zabota-ugorsk.ru {
    encode gzip
    reverse_proxy 127.0.0.1:4100
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

Временная публикация container на внешнем 80 допустима только как аварийная ручная мера после остановки Caddy; после восстановления вернуть `127.0.0.1:4100`.

Запрещены `docker volume prune`, `docker system prune -a --volumes`, destructive Prisma push и любые команды удаления `/opt/zabota/data`.
