# Деплой на Timeweb

## 1. Что деплоим

Деплоится один Docker container с приложением `Забота Рядом 2.0`.

Внутри контейнера:

- `landing-public` - очищенный публичный лендинг;
- React frontend - production build из `frontend/dist`;
- backend API - Node.js/Express/TypeScript build из `backend/dist`;
- Prisma + SQLite.

Маршруты:

- `/` - лендинг;
- `/app` - React-приложение;
- `/legal` и `/legal/*` - юридические документы приложения;
- `/api` и `/api/*` - backend API.

## 2. Переменные окружения

Безопасный шаблон находится в `.env.production.example`. Реальные секреты в репозиторий не добавлять.

Обязательные и важные переменные:

- `NODE_ENV=production` - включает production static routing.
- `PORT=4000` - порт внутри контейнера. Timeweb может пробрасывать внешний порт отдельно.
- `APP_BASE_URL=https://zabota-ugorsk.ru` - основной URL приложения.
- `PUBLIC_SITE_URL=https://zabota-ugorsk.ru` - публичный URL лендинга.
- `DATABASE_URL="file:/data/zabota.db"` - SQLite база на persistent volume.
- `JWT_SECRET` - длинный случайный production secret. Не использовать значение из example.
- `CORS_ORIGIN="https://zabota-ugorsk.ru"` - production origin сайта.
- `YANDEX_MAPS_API_KEY` - пока пусто, встроенные Яндекс.Карты не подключены.
- `VITE_YANDEX_MAPS_API_KEY` - пока пусто.
- `DEFAULT_SERVICE_FEE_AMOUNT=50` - текущий сервисный сбор.
- `DEFAULT_MIN_TOP_UP_AMOUNT=150` - минимальное пополнение.
- `PAYMENT_PROVIDER=mock` - для первого запуска оставить mock.
- `PAYMENT_RECEIPT_ENABLED=false` - онлайн-касса пока не включена.
- `SEED_DEMO_DATA=false` - demo/test пользователи, заявки, чаты и платежи не создаются автоматически.
- `PRODUCTION_ADMIN_EMAIL` - email первого администратора, если база пустая.
- `PRODUCTION_ADMIN_PASSWORD` - пароль первого администратора, если база пустая.
- `PRODUCTION_ADMIN_PHONE` - телефон первого администратора, если база пустая.
- `TBANK_TERMINAL_KEY` - заполнять только перед включением Т-Банка.
- `TBANK_TERMINAL_MODE` - `test` для демо-терминала, `live` только для боевого терминала; по умолчанию `test`.
- `TBANK_PASSWORD` - заполнять только перед включением Т-Банка.
- `TBANK_API_URL=https://securepay.tinkoff.ru/v2` - API URL Т-Банка.
- `TBANK_SUCCESS_URL=https://zabota-ugorsk.ru/app/balance/payment-success` - URL успешного возврата.
- `TBANK_FAIL_URL=https://zabota-ugorsk.ru/app/balance/payment-fail` - URL неуспешного возврата.
- `TBANK_NOTIFICATION_URL=https://zabota-ugorsk.ru/api/payments/tbank/webhook` - webhook/notification URL.
- `UPLOADS_DIR=/data/uploads` - целевой путь для persistent uploads.
- `OAUTH_ENABLED=false` и `VK_ID_ENABLED=false` - VK ID не включать до отдельной настройки.

`PAYMENT_PROVIDER=tbank` включать только после проверки домена, HTTPS, webhook и тестового терминала. До этого production preview должен работать с `PAYMENT_PROVIDER=mock`.

Backend использует `UPLOADS_DIR` как единый корень загрузок, создаёт его при старте и хранит в БД только URL/storage key без абсолютного пути контейнера.

## 3. Persistent volume

Между перезапусками контейнера нужно сохранять:

- `/data/zabota.db` - SQLite база;
- `/data/uploads` - файлы загрузок.

Для базы используется `DATABASE_URL="file:/data/zabota.db"`, для файлов — `UPLOADS_DIR=/data/uploads`. Оба пути попадают в один persistent volume.

На Timeweb рекомендуется монтировать `-v /opt/zabota/data:/data`. Тогда файлы будут храниться в `/opt/zabota/data/uploads` на хосте.

## 4. Первый запуск

Порядок:

1. Собрать Docker image.
2. Запустить container с production env.
3. Подключить persistent volume к `/data`.
4. Проверить `/api/health`.
5. Открыть `/`.
6. Открыть `/app`.
7. Войти под администратором из `PRODUCTION_ADMIN_EMAIL / PRODUCTION_ADMIN_PASSWORD`.
8. Сразу сменить пароль администратора, если такая функция есть.
9. Если смены пароля ещё нет, считать это обязательной доработкой после деплоя.

Пример локальной сборки:

```bash
docker build -t zabota-web-service:deploy-check .
```

Пример локального запуска:

```bash
docker run --rm \
  -p 4014:4000 \
  -e NODE_ENV=production \
  -e PORT=4000 \
  -e DATABASE_URL=file:/data/zabota.db \
  -e UPLOADS_DIR=/data/uploads \
  -e PAYMENT_PROVIDER=mock \
  -e SEED_DEMO_DATA=false \
  -e PRODUCTION_ADMIN_EMAIL=admin@example.com \
  -e PRODUCTION_ADMIN_PASSWORD=replace-with-initial-admin-password \
  -e PRODUCTION_ADMIN_PHONE=+79000000001 \
  -e CORS_ORIGIN=http://localhost:4014 \
  -e JWT_SECRET=replace-with-long-random-production-secret \
  zabota-web-service:deploy-check
```

## 5. Проверки после деплоя

Проверить:

- `https://zabota-ugorsk.ru/`;
- `https://zabota-ugorsk.ru/prices.html`;
- `https://zabota-ugorsk.ru/app`;
- `https://zabota-ugorsk.ru/legal/privacy`;
- `https://zabota-ugorsk.ru/api/health`;
- регистрацию заказчика;
- регистрацию помощника;
- вход администратора;
- пополнение баланса через mock payment;
- раздел администратора `Платежи`.

## 6. Что не включать на первом запуске

- `PAYMENT_PROVIDER=tbank`;
- `OAUTH_ENABLED=true`;
- `VK_ID_ENABLED=true`;
- `SEED_DEMO_DATA=true`;
- реальные платежи;
- SMS;
- email SMTP;
- онлайн-кассу;
- автоматические возвраты.

## 7. Перед включением Т-Банка

Перед включением `PAYMENT_PROVIDER=tbank` использовать инструкцию `docs/TBANK_PAYMENT_SETUP.md`.

Минимально проверить:

- production домен доступен по HTTPS;
- `TBANK_NOTIFICATION_URL` доступен из интернета;
- тестовый платёж создаёт `PaymentTransaction`;
- успешный webhook начисляет баланс только один раз;
- платёж виден в админке;
- статус виден пользователю в истории пополнений.

### Включение реальной оплаты через Т-Банк

Реальную оплату не включать одновременно с обычным деплоем. Переключение выполняется вручную после отдельной проверки терминала:

1. Проверить HTTPS: `curl -i https://zabota-ugorsk.ru/api/health`.
2. Проверить доступность notification URL: `https://zabota-ugorsk.ru/api/payments/tbank/webhook`. Для неподписанного запроса ожидается безопасный `400`, а не зачисление.
3. Сделать backup `/opt/zabota/repo/.env.production` и `/opt/zabota/data/zabota.db`.
4. Заполнить `TBANK_TERMINAL_KEY`, `TBANK_PASSWORD` и HTTPS URL, затем вручную установить `PAYMENT_PROVIDER=tbank`.
5. Оставить `PAYMENT_RECEIPT_ENABLED=false`.
6. Пересоздать только контейнер приложения, сохранив `-v /opt/zabota/data:/data`.
7. Проверить локальный и публичный health.
8. Создать один тестовый платёж на 150 ₽ через платёжную форму банка.
9. Проверить `PaymentTransaction`: `provider=tbank`, корректные `orderId`, `providerPaymentId`, `status=succeeded`, заполненный `creditedAt`.
10. Проверить связанную `BalanceTransaction` с `idempotencyKey=payment_credit:<paymentId>` и увеличение основного баланса ровно на сумму платежа.
11. Повторно обработать то же notification в тестовом контуре и убедиться, что баланс не увеличился второй раз.
12. Если webhook не пришёл, нажать «Проверить статус» в истории пополнений или «Обновить статус» в админке. Backend выполнит `GetState`.
13. Повторить `GetState` и убедиться, что баланс не увеличился второй раз.
14. Проверить платёж в админке и в истории пополнений пользователя. Только после этого оставить `PAYMENT_PROVIDER=tbank`.

Т-Банк должен отправлять уведомления на `TBANK_NOTIFICATION_URL`. Backend принимает зачисление только после проверки `Token`, `TerminalKey`, `OrderId`, `PaymentId`, `Success=true`, статуса `CONFIRMED` и точной суммы в копейках. Успешно обработанное уведомление получает ответ `200 OK` с телом `OK`.

Webhook остаётся основным источником подтверждения. `GetState` используется только как резервная проверка pending-платежа по запросу владельца или администратора. Оба канала используют один `payment_credit:<paymentId>`.

Фискализацию и чеки нельзя включать без отдельной проверки договора, налогового режима и онлайн-кассы. Реальные платежи включать только после получения и проверки терминала Т-Банка.

## 8. HTTPS через Caddy

Production-схема:

```text
Интернет
  -> Caddy: TCP 80/443, автоматический сертификат и HTTP -> HTTPS
  -> 127.0.0.1:4000
  -> Docker container zabota-web:4000
```

Caddy устанавливается на host-сервер как systemd service. Контейнер приложения не должен занимать внешний порт 80 и запускается только с публикацией:

```bash
-p 127.0.0.1:4000:4000
```

Порядок первого включения:

1. Убедиться, что DNS A-запись `zabota-ugorsk.ru` указывает на `104.171.139.243`.
2. Открыть TCP 80 и 443 в firewall Timeweb и, если используется, в `ufw`.
3. Выполнить обычный production deploy. После него приложение должно отвечать на `http://127.0.0.1:4000`, но ещё не занимать внешний порт 80.
4. На сервере проверить `curl -i http://127.0.0.1:4000/api/health`.
5. Из `/opt/zabota/repo` запустить `bash scripts/setup-https-caddy-timeweb.sh` от root.
6. Проверить `curl -i https://zabota-ugorsk.ru/api/health`.
7. Проверить перенаправление командой `curl -I http://zabota-ugorsk.ru`.
8. Открыть `https://zabota-ugorsk.ru` и `https://zabota-ugorsk.ru/app`.

Скрипт проверяет Linux/root, локальный health, DNS, занятость портов, правила `ufw`, устанавливает официальный пакет Caddy, сохраняет резервную копию существующего Caddyfile, валидирует новую конфигурацию и ждёт успешный HTTPS health. Основной Caddyfile находится в `/etc/caddy/Caddyfile`, сертификаты и служебные данные Caddy обслуживаются системным пакетом.

Важные ограничения:

- не удалять `/opt/zabota/data`;
- не запускать `docker volume prune`;
- не запускать `docker system prune -a --volumes`;
- не публиковать приложение на внешнем порту 80 после включения Caddy;
- не выводить содержимое `/opt/zabota/repo/.env.production` в терминал или логи;
- не включать VK ID и Т-Банк в рамках настройки HTTPS.

## 9. Ручная установка Caddy

Если setup script нельзя использовать, те же действия выполняются вручную на production-сервере:

```bash
apt-get update
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https ca-certificates curl gnupg

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list

chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
chmod o+r /etc/apt/sources.list.d/caddy-stable.list

apt-get update
apt-get install -y caddy

ufw allow 80/tcp
ufw allow 443/tcp

cat > /etc/caddy/Caddyfile <<'EOF'
zabota-ugorsk.ru {
    encode gzip

    reverse_proxy 127.0.0.1:4000

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }
}
EOF

caddy fmt --overwrite /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy
systemctl status caddy --no-pager
```

Пакет и способ установки соответствуют [официальной инструкции Caddy для Debian/Ubuntu](https://caddyserver.com/docs/install#debian-ubuntu-raspbian).

## 10. Проверка HTTPS

```bash
curl -i http://127.0.0.1:4000/api/health
curl -i https://zabota-ugorsk.ru/api/health
curl -I http://zabota-ugorsk.ru
```

Ожидается:

- локальный health возвращает `200` и JSON;
- HTTPS health возвращает `200` и JSON;
- HTTP-запрос возвращает redirect на `https://zabota-ugorsk.ru/`;
- `systemctl status caddy --no-pager` показывает active/running.

При проблемах с сертификатом проверить:

```bash
journalctl -u caddy --no-pager -n 100
getent ahostsv4 zabota-ugorsk.ru
ss -ltnp | grep -E ':80|:443|:4000'
```

## 11. Временный откат

Если HTTPS сломался и требуется временно восстановить HTTP-доступ:

```bash
systemctl stop caddy

docker rm -f zabota-web

docker run -d \
  --name zabota-web \
  --restart unless-stopped \
  --env-file /opt/zabota/repo/.env.production \
  -p 80:4000 \
  -v /opt/zabota/data:/data \
  zabota-web-service

curl -i http://zabota-ugorsk.ru/api/health
```

Этот откат временный. Он не удаляет базу или uploads. После исправления Caddy контейнер нужно снова запустить с `-p 127.0.0.1:4000:4000`, затем включить Caddy:

```bash
systemctl enable --now caddy
```
