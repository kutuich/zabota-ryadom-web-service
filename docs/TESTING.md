# Тестирование

> Статус: ACTIVE TECHNICAL DOCUMENT.

Утверждённые требования к тестированию находятся в разделе архитектуры проекта в Notion. Этот документ фиксирует текущую локальную реализацию тестового контура.

## Текущий baseline

- основной runner backend и frontend: Vitest;
- backend regression-suite сохранён целиком в `backend/src/tests/business.test.ts`;
- backend suite выполняется последовательно, так как characterization-сценарии используют общую тестовую базу;
- frontend suite проверяет маршруты, роли, тексты и статические UI-контракты;
- Playwright выполняет отдельный critical E2E suite и не заменяет Vitest.
- `backend/src/tests/nestBootstrap.test.ts` поднимает реальное NestJS HTTP-приложение на случайном локальном порту и проверяет health, readiness, legal, login, balance, admin/file guards, безопасный отключённый VK path, все 224 API registrations и отсутствие duplicate routes;
- закрытие NestJS application проверяет единый shutdown path для Prisma и одноинстансового scheduler.

Команды:

```bash
npm test
npm run test -w backend
npm run test -w frontend
npm run test:e2e
```

Перед полным backend regression-suite база должна иметь актуальную schema и системные/demo-данные, а `frontend/dist` должен быть собран для static routing tests.

## Изолированная база

Backend characterization suite выполняется на отдельной PostgreSQL-базе. `TEST_DATABASE_URL` переопределяет `DATABASE_URL` только внутри тестового процесса:

```bash
nvm use
docker compose -f compose.postgres-rehearsal.yml up -d
DATABASE_URL='postgresql://zabota_local:zabota_local_only@127.0.0.1:55432/zabota_test?schema=public' npm run db:migrate:deploy
DATABASE_URL='postgresql://zabota_local:zabota_local_only@127.0.0.1:55432/zabota_test?schema=public' npm run db:seed
TEST_DATABASE_URL='postgresql://zabota_local:zabota_local_only@127.0.0.1:55432/zabota_test?schema=public' npm run test -w backend
```

Перед повторным полным прогоном test schema нужно очистить, повторно применить migration history и seed. Не направлять suite на rehearsal, development или production database.

## Critical Playwright E2E

`playwright.config.ts` запускает production frontend build и реальный NestJS backend на `127.0.0.1:4400`, но использует test-only cookie mode, mock payments, local object storage, disabled VK/Sentry/scheduler и отдельную PostgreSQL database. `scripts/prepare-e2e.mjs` откажется reset-ить удалённую базу или базу, имя которой не заканчивается `_e2e`.

```bash
nvm use 22
docker compose -f compose.postgres-rehearsal.yml up -d --wait
# Один раз создать отдельную локальную zabota_e2e, если её ещё нет.
npx playwright install chromium
npm run test:e2e
```

Suite проверяет public/app/static delivery, регистрацию/legal consent, login/reload/refresh/logout, отсутствие auth secrets в Web Storage, role/admin denial, request→response→chat→terms→double confirmation→`in_work`, отсутствие раннего fee, mock top-up success UI и protected file ownership. Complex request fixture создаётся через публичный API; пользовательские переходы/состояния проверяются браузером. Live T-Bank/VK и production secrets не используются.

## Characterization coverage

Текущий regression-suite фиксирует существующие контракты:

- аутентификация, роли, ownership guards и ограничения VK/OAuth;
- создание заявки, отклик, чат, двойное подтверждение и идемпотентная финализация;
- фиксированный сервисный сбор, порядок bonus/main, ledger и возврат в исходный кошелёк;
- график, визиты, allocations, immutable agreement snapshot и dispute/reconciliation;
- версии legal-документов, proof согласия и hash;
- защищённые документы, адреса и контакты;
- идемпотентность фонового reconciliation.

Это characterization baseline текущего поведения, а не заявление о завершённой миграции на целевой стек.

## NestJS migration checks

`createNestApplication({ startScheduler: false })` используется только интеграционным тестом, чтобы interval scheduler не влиял на детерминированность suite. Обычный `backend/src/index.ts` запускает scheduler через NestJS lifecycle с текущими env-настройками. Express characterization baseline сохранён как API parity baseline, хотя runtime bridge больше нет.
