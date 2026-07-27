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
- `TBANK_PASSWORD` - заполнять только перед включением Т-Банка.
- `TBANK_API_URL=https://securepay.tinkoff.ru/v2` - API URL Т-Банка.
- `TBANK_SUCCESS_URL=https://zabota-ugorsk.ru/app/balance/payment-success` - URL успешного возврата.
- `TBANK_FAIL_URL=https://zabota-ugorsk.ru/app/balance/payment-fail` - URL неуспешного возврата.
- `TBANK_NOTIFICATION_URL=https://zabota-ugorsk.ru/api/payments/tbank/webhook` - webhook/notification URL.
- `UPLOADS_DIR=/data/uploads` - целевой путь для persistent uploads.

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
