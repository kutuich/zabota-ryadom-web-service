# Забота Рядом 2.0 Web Service

Локальное web-приложение для сервиса помощи семье, дому и близким. Публичное позиционирование: локальный сервис помощи. Внутри заложена платформа заявок, откликов, чата по заявке, баланса, сервисных сборов, доверительных статусов и админского контроля.

Единственный актуальный источник требований: [`ZABOTA_RYADOM_CURRENT_SOURCE_OF_TRUTH.md`](./ZABOTA_RYADOM_CURRENT_SOURCE_OF_TRUTH.md).

Старый сайт, VK, Bitrix24-интеграции и старые папки проекта в этой итерации не используются и не меняются.

## Стек

- Frontend: React, TypeScript, Vite, plain CSS.
- Backend: Node.js, Express, TypeScript.
- Database: SQLite для локального запуска.
- ORM: Prisma.
- Auth: JWT Bearer token.
- Maps: на текущем этапе используются внешние ссылки на Яндекс.Карты через поисковый URL; встроенная карта и API не подключены.
- Payments: mock payment и внутренний баланс. Тестовое подключение Т-Банка описано в `docs/TBANK_PAYMENT_SETUP.md`.

## Быстрый запуск

```bash
cd "/Users/konstantinkutuev/Desktop/Проект забота рядом/web-service"
cp .env.example .env
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

После запуска:

- frontend: http://localhost:5173
- backend health: http://localhost:4000/api/health

## Тестовые пользователи

Пароль у всех: `password123`.

- `admin@zabota.local` - superadmin.
- `client@zabota.local` - заказчик.
- `performer@zabota.local` - помощник в Югорске.

Для чистой демо-базы используйте `npm run db:reset-demo`: команда оставляет только эти три аккаунта и пересоздаёт сценарии для визуального аудита.

## Env

Основной файл: `.env`.

```bash
DATABASE_URL="file:./dev.db"
PORT=4000
JWT_SECRET="replace-with-a-long-random-secret"
CORS_ORIGIN="http://localhost:5173"
YANDEX_MAPS_API_KEY=""
VITE_YANDEX_MAPS_API_KEY=""
DEFAULT_SERVICE_FEE_AMOUNT=50
DEFAULT_MIN_TOP_UP_AMOUNT=150
PAYMENT_PROVIDER=mock
PAYMENT_RECEIPT_ENABLED=false
TBANK_TERMINAL_KEY=
TBANK_PASSWORD=
TBANK_API_URL=https://securepay.tinkoff.ru/v2
TBANK_SUCCESS_URL=http://localhost:4000/app/balance/payment-success
TBANK_FAIL_URL=http://localhost:4000/app/balance/payment-fail
TBANK_NOTIFICATION_URL=http://localhost:4000/api/payments/tbank/webhook
SEED_DEMO_DATA=true
OAUTH_ENABLED=false
VK_ID_ENABLED=false
VK_ID_CLIENT_ID=
VK_ID_CLIENT_SECRET=
VK_ID_REDIRECT_URI=http://localhost:4000/api/auth/oauth/vk/callback
VK_ID_SUCCESS_REDIRECT_PATH=/app/oauth/complete
VK_ID_FAIL_REDIRECT_PATH=/app/login?oauthError=vk
```

Для Яндекс.Карт добавьте ключ в `YANDEX_MAPS_API_KEY` и, если карта будет рендериться на заказчике, в `VITE_YANDEX_MAPS_API_KEY`.
Для разработки платёжный модуль работает с `PAYMENT_PROVIDER=mock`. Реальный сценарий Т-Банка должен вести пользователя на платёжную форму банка, без ввода карты в приложении.
Для тестового подключения Т-Банка используйте инструкцию `docs/TBANK_PAYMENT_SETUP.md` и шаблон `.env.tbank.test.example`.
Вход через VK ID настраивается по инструкции `docs/vk-id-auth.md`. По умолчанию он выключен и не влияет на обычный вход.

Backend загружает env из корневого `.env`. Prisma-команды запускаются из корня с явным `--schema backend/prisma/schema.prisma`, поэтому отдельный `backend/.env` не нужен.

## Проверки

```bash
npm run check
npm test
npm run build
```

В этой среде локальные порты могут требовать разрешения sandbox. На обычной машине `npm run dev` поднимает frontend и backend сразу.

## Юридические документы и согласия

В preview-версии добавлен юридический контур:

- публичный список документов: `http://localhost:4000/legal`;
- отдельные документы: `/legal/privacy`, `/legal/personal-data-consent`, `/legal/customer-agreement`, `/legal/helper-terms`, `/legal/service-notifications-consent`, `/legal/marketing-notifications-consent`, `/legal/helper-documents-consent`, `/legal/service-rules`;
- профиль заказчика и помощника содержит раздел “Согласия и документы”;
- администратор управляет версиями и экспортами в разделе `/admin/legal`.

При регистрации сохраняется доказательная запись в `UserConsent`: документ, версия, заголовок, `contentHash`, дата принятия, IP, user agent и источник. Опубликованный документ не редактируется напрямую: для изменения создаётся новая версия, после публикации пользователям нужно принять актуальную версию.

Backend блокирует действия с кодом `MISSING_REQUIRED_CONSENT`, если не приняты обязательные документы для функции. Обращения к администратору остаются доступными.

Экспорты администратора:

- `zabota-user-consents-USERID-YYYY-MM-DD.xlsx`;
- `zabota-all-consents-YYYY-MM-DD.xlsx`;
- `zabota-legal-archive-YYYY-MM-DD.zip`.

Перед production-запуском пройдите [SECURITY_PRODUCTION_CHECKLIST.md](/Users/konstantinkutuev/Desktop/Проект%20забота%20рядом/web-service/SECURITY_PRODUCTION_CHECKLIST.md).

## Демо-база

Для безопасного полного сброса локальной демо-базы:

```bash
npm run db:reset-demo
```

Команда очищает тестовые заявки, чаты, отклики, обращения, документы, операции баланса и лишних пользователей. После выполнения в базе остаются:

- `admin@zabota.local`;
- `client@zabota.local`;
- `performer@zabota.local`.

Для повторного создания демо-сценариев без удаления лишних пользователей:

```bash
npm run db:seed-demo
```

Обе команды идемпотентны и выводят количество пользователей, заявок, чатов, обращений и операций баланса.

## Запуск двойным кликом на macOS

В корне проекта есть два файла:

- `start-zabota-local.command` - собирает Docker-образ, запускает контейнер на `http://localhost:4000` и открывает браузер.
- `stop-zabota-local.command` - останавливает локальный контейнер `zabota-ryadom-local`.

Если macOS блокирует запуск файла, выполните один раз:

```bash
chmod +x start-zabota-local.command stop-zabota-local.command
```

Для запуска Docker Desktop должен быть установлен и открыт. Если порт `4000` занят, стартовый скрипт покажет сообщение и не будет запускать контейнер поверх чужого процесса.

## Визуальный аудит

Автоматический визуальный аудит проходит публичные экраны и кабинеты заказчика, помощника и администратора через Playwright. Перед запуском приложение должно уже отвечать на `http://localhost:4000`.

Запустите приложение одним из способов:

```bash
npm run dev
```

или Docker/production-режим:

```bash
docker run --rm -p 4000:4000 --env-file .env.preview zabota-web-service
```

Затем выполните:

```bash
npm run visual:audit
```

Если браузер Playwright ещё не установлен в локальном окружении:

```bash
npx playwright install chromium
```

Артефакты аудита:

- скриншоты: `visual-audit/screenshots`;
- отчёт: `visual-audit/VISUAL_AUDIT_REPORT.md`;
- ошибки консоли: `visual-audit/console-errors.json`;
- сетевые ошибки и failed requests: `visual-audit/network-errors.json`.

По умолчанию аудит использует `http://localhost:4000`. Для другого адреса:

```bash
VISUAL_AUDIT_BASE_URL=https://your-preview-url npm run visual:audit
```

## Docker preview

Docker-конфигурация предназначена для временного preview-деплоя. В контейнере backend отдаёт API и собранный frontend с одного порта.

Подготовьте env-файл:

```bash
cp .env.preview.example .env.preview
```

Обязательно замените `JWT_SECRET` на длинное случайное значение. Для локального Docker-запуска можно оставить:

```bash
DATABASE_URL=file:/data/zabota.db
PORT=4000
CORS_ORIGIN=http://localhost:4000
PAYMENT_PROVIDER=mock
PAYMENT_RECEIPT_ENABLED=false
TBANK_TERMINAL_KEY=
TBANK_PASSWORD=
TBANK_API_URL=https://securepay.tinkoff.ru/v2
TBANK_SUCCESS_URL=http://localhost:4000/app/balance/payment-success
TBANK_FAIL_URL=http://localhost:4000/app/balance/payment-fail
TBANK_NOTIFICATION_URL=http://localhost:4000/api/payments/tbank/webhook
```

Сборка образа:

```bash
docker build -t zabota-web-service .
```

Запуск контейнера локально:

```bash
docker run --rm -p 4000:4000 --env-file .env.preview zabota-web-service
```

После запуска доступны:

- frontend: http://localhost:4000
- backend health: http://localhost:4000/api/health

Проверка health endpoint:

```bash
curl http://localhost:4000/api/health
```

Startup внутри контейнера выполняет:

1. создание папки под SQLite-файл;
2. `prisma db push`;
3. seed только если таблица пользователей пустая и явно включён один из режимов:
   `SEED_DEMO_DATA=true` для локального demo preview или `PRODUCTION_ADMIN_EMAIL`,
   `PRODUCTION_ADMIN_PASSWORD`, `PRODUCTION_ADMIN_PHONE` для чистого production bootstrap;
4. запуск backend на `0.0.0.0:$PORT`.

Это защищает preview от бесконечного создания seed-дублей при каждом рестарте контейнера.

## Render preview

Вариант через Docker:

1. Загрузите проект в GitHub/GitLab.
2. В Render создайте `New Web Service`.
3. Выберите репозиторий и окружение Docker, Render найдёт `Dockerfile`.
4. Укажите health check path: `/api/health`.
5. Укажите env-переменные из `.env.preview.example`.
6. Для локального SQLite с сохранением между редеплоями добавьте persistent disk и смонтируйте его в `/data`.
7. Если persistent disk не используется, SQLite-база может сбрасываться при пересборке/редеплое.

Минимальные env-переменные для Render:

```bash
DATABASE_URL=file:/data/zabota.db
PORT=4000
JWT_SECRET=replace-with-a-long-random-preview-secret
CORS_ORIGIN=https://your-service-name.onrender.com
YANDEX_MAPS_API_KEY=
VITE_YANDEX_MAPS_API_KEY=
DEFAULT_SERVICE_FEE_AMOUNT=50
DEFAULT_MIN_TOP_UP_AMOUNT=150
PAYMENT_PROVIDER=mock
PAYMENT_RECEIPT_ENABLED=false
TBANK_TERMINAL_KEY=
TBANK_PASSWORD=
TBANK_API_URL=https://securepay.tinkoff.ru/v2
TBANK_SUCCESS_URL=https://your-service-name.onrender.com/app/balance/payment-success
TBANK_FAIL_URL=https://your-service-name.onrender.com/app/balance/payment-fail
TBANK_NOTIFICATION_URL=https://your-service-name.onrender.com/api/payments/tbank/webhook
```

Render требует, чтобы web service слушал `0.0.0.0` и порт из `PORT`; backend уже настроен так. Если Render задаёт свой `PORT`, оставьте его значение и не хардкодьте порт в коде.

Для Fly.io/Railway логика та же: деплой из `Dockerfile`, env из `.env.preview.example`, публичный HTTP-порт через `PORT`, persistent volume/disk для `/data`, если нужна сохранность SQLite.

Важно: SQLite подходит для временного preview. Для production позже нужно перейти на PostgreSQL, иначе при нескольких инстансах, редеплоях без persistent disk и ограничениях файловой системы возможна потеря данных или проблемы с конкурентной записью.

## Что уже есть

- Мультигородская модель: `City` с сервисным сбором, минимальным пополнением и центром карты.
- В городе есть статус, районы, радиус показа карты и JSON-настройки под локальные правила.
- Роли: `client`, `performer`, `admin`, `superadmin`.
- У пользователя есть `rolesJson` под будущий режим “обе роли”.
- Пользователи, профили заказчика и помощника.
- Прозрачные статусы доверия помощника без обязательного паспорта и селфи.
- Отдельный статус допуска к категории `childcare`.
- Справочник 10 базовых категорий услуг с русскими названиями, инструкциями “что входит/не входит” и медицинскими запретами.
- Расширенная заявка: срочность, пожилой человек, ребёнок, маломобильность, готовка, уборка, прогулка, бытовая гигиеническая помощь, животные, комментарий.
- Блокировка медицинских формулировок в заявках.
- Заявки, отклики, открытие чата по заявке без списания денег, обсуждение условий и двойное подтверждение.
- Человекопонятный номер заявки `ZR-YYYY-0001` используется в заявках, чатах, откликах, жалобах и админке.
- Pricing service считает пакет визита, рекомендуемую оплату помощнику, сервисный сбор заказчика, сервисный сбор помощника и ориентировочные общие расходы.
- Скрытие точного адреса до согласования условий и перехода заявки в работу.
- Телефон не раскрывается по умолчанию.
- Чат с базовой модерацией телефонов, ссылок, карт, 18+ и грубой лексики.
- Внутренний баланс, mock-пополнение, списание сервисного сбора с заказчика и сервисного сбора с помощника только после двойного подтверждения условий.
- Админское начисление бонусного баланса с логированием причины, комментария, срока действия бонуса, баланса до и после.
- Отрицательный баланс блокирует новые рабочие действия до пополнения.
- Документы помощника: самозанятость и справка об отсутствии судимости, без обязательного паспорта и селфи.
- FAQ / база знаний с seed-статьями и админским API.
- Настройки сервиса через `ServiceSetting`.
- Архивирование неактивных пользователей и старых завершённых заявок без удаления истории.
- Жалобы, risk flags, отзывы и рейтинг.
- “Связь с администратором” с публичными номерами обращений `SUP-YYYY-0001`.
- AuditLog для действий по auth, заявкам, чатам, балансу, жалобам и настройкам.
- Страницы-заглушки согласий, Terms/Privacy и правил.

## Главные файлы

- `backend/prisma/schema.prisma` - основная модель данных.
- `backend/prisma/seed.ts` - города, категории, тестовые пользователи и заявки.
- `backend/src/routes` - API по auth, requests, chats, balance, complaints, admin.
- `backend/src/services/balanceService.ts` - баланс, mock payment, сервисный сбор, бонусы.
- `frontend/src/routes/navigation.ts` - постоянные URL-разделы, ролевые стартовые маршруты и переходы в чаты.
- `Dockerfile` - multi-stage Docker-сборка frontend/backend/Prisma.
- `.dockerignore` - исключения для Docker build context.
- `.env.preview.example` - переменные окружения для Docker preview.
- `scripts/start-preview.mjs` - безопасный Docker startup: `prisma db push`, demo seed только при `SEED_DEMO_DATA=true`, production admin bootstrap из env, запуск backend.
- `scripts/bootstrap-production-admin.mjs` - создание первого production superadmin из `PRODUCTION_ADMIN_*` в пустой базе.
- `backend/src/services/paymentAdapter.ts` - mock payment adapter и основа адаптера под платёжную форму Т-Банка.
- `backend/src/services/pricingService.ts` - расчёт ориентировочной стоимости.
- `backend/src/services/matchingService.ts` - подбор подходящих заявок для помощника.
- `backend/src/services/requestNumberService.ts` - публичные номера заявок.
- `backend/src/services/archiveService.ts` - ручное архивирование.
- `backend/src/services/moderationService.ts` - базовая модерация чата.
- `backend/src/services/requestPolicy.ts` - приватность адреса и запрет медицинских услуг.
- `frontend/src/App.tsx` - переключение кабинетов по ролям.
- `frontend/src/pages` - кабинеты заказчика, помощника, администратора и вход.
- `frontend/src/api/client.ts` - заказчик API.

## Production SPA fallback

Frontend использует BrowserRouter. В production backend отдаёт `frontend/dist` и возвращает `frontend/dist/index.html` для всех не-API путей (`/client/...`, `/performer/...`, `/admin/...`). API остаётся на `/api`.

## API

Основные маршруты:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/public/bootstrap`
- `GET /api/requests`
- `POST /api/requests`
- `POST /api/pricing/quote`
- `PATCH /api/performer-profile/me`
- `POST /api/requests/:id/publish`
- `POST /api/requests/:id/respond`
- `POST /api/requests/responses/:responseId/accept`
- `GET /api/chats`
- `GET /api/chats/:id/messages`
- `POST /api/chats/:id/messages`
- `POST /api/chats/:id/client-confirm`
- `POST /api/chats/:id/performer-confirm`
- `POST /api/chats/:id/not-agreed`
- `POST /api/chats/:id/propose-new-terms`
- `GET /api/balance/me`
- `POST /api/balance/mock-top-up`
- `POST /api/complaints`
- `GET /api/knowledge`
- `GET /api/performer-documents`
- `POST /api/performer-documents`
- `GET /api/admin/summary`
- `GET /api/admin/users`
- `POST /api/admin/users/:id/bonus`
- `GET /api/admin/settings`
- `GET /api/admin/knowledge`
- `POST /api/admin/archive/run`

## Что осталось доделать

- Подключить реальный рендер Яндекс.Карт вместо заглушки.
- Подключить реальную ЮKassa или другой провайдер вместо mock adapter.
- Добавить полноценные юридические тексты Terms/Privacy/consents.
- Расширить e2e-тесты на браузерные сценарии заказчика, помощника и админа.
- Доработать полноценное редактирование заявки с диффом изменений и системными сообщениями по всем полям.
- Развить отдельные обращения к администратору до полноценного threaded support-чата с сообщениями туда-обратно.
- Добавить восстановление пароля и подтверждение телефона/email.
- Доработать редактирование профиля заказчика и добавить более тонкую историю изменений профиля помощника.
- Добавить pagination/search для админских таблиц.
- Для production перейти с SQLite на PostgreSQL и добавить миграционный процесс вместо preview `db push`.
