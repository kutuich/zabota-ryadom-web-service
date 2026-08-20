# Деплой на Timeweb

> Статус: OPERATIONAL. Выполнять только по отдельному разрешению. Текущее состояние: [PRODUCTION_CURRENT_STATE.md](PRODUCTION_CURRENT_STATE.md).

> Важно: текущий production остаётся на SQLite, а основной Prisma provider репозитория подготовлен для PostgreSQL. Обычный deploy этой версии запрещён до отдельного production migration/cutover. Локальная репетиция описана в [POSTGRESQL_MIGRATION_REHEARSAL.md](POSTGRESQL_MIGRATION_REHEARSAL.md).

## Архитектура

```text
Internet -> Caddy :80/:443 -> 127.0.0.1:4000 -> Docker zabota-web:4000
                                             -> /opt/zabota/data:/data
```

Container отдаёт landing `/`, React `/app`, legal `/legal/*` и API `/api/*`. Caddyfile: `/etc/caddy/Caddyfile`. База и uploads не входят в image.

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

## Запуск container

Production run сохраняет имя, env и volume:

```bash
docker run -d \
  --name zabota-web \
  --restart unless-stopped \
  --env-file /opt/zabota/repo/.env.production \
  -p 127.0.0.1:4000:4000 \
  -v /opt/zabota/data:/data \
  zabota-web-service
```

Приложение не занимает внешний 80. Startup выполняет `prisma migrate deploy`, затем bootstrap системных данных; production demo seed выключен. `db push` в production не используется.

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

1. Не изменять и не удалять `/opt/zabota/data`.
2. Перезапустить предыдущий проверенный image с тем же env, localhost binding и volume.
3. При несовместимости схемы восстановить DB только из созданного перед deploy backup после остановки container.
4. Проверить local/public health и Caddy.

Временная публикация container на внешнем 80 допустима только как аварийная ручная мера после остановки Caddy; после восстановления вернуть `127.0.0.1:4000`.

Запрещены `docker volume prune`, `docker system prune -a --volumes`, destructive Prisma push и любые команды удаления `/opt/zabota/data`.
