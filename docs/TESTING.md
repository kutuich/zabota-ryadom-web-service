# Тестирование

> Статус: ACTIVE TECHNICAL DOCUMENT.

Утверждённые требования к тестированию находятся в разделе архитектуры проекта в Notion. Этот документ фиксирует текущую локальную реализацию тестового контура.

## Текущий baseline

- основной runner backend и frontend: Vitest;
- backend regression-suite сохранён целиком в `backend/src/tests/business.test.ts`;
- backend suite выполняется последовательно, так как characterization-сценарии используют общую тестовую базу;
- frontend suite проверяет маршруты, роли, тексты и статические UI-контракты;
- Playwright остаётся инструментом visual/E2E-проверок и не заменяется Vitest.
- `backend/src/tests/nestBootstrap.test.ts` поднимает реальное NestJS HTTP-приложение на случайном локальном порту и проверяет health, legal, login, balance, admin/file guards, безопасный отключённый VK path, все 221 API registrations и отсутствие duplicate routes;
- закрытие NestJS application проверяет единый shutdown path для Prisma и одноинстансового scheduler.

Команды:

```bash
npm test
npm run test -w backend
npm run test -w frontend
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
