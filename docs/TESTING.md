# Тестирование

> Статус: ACTIVE TECHNICAL DOCUMENT.

Утверждённые требования к тестированию находятся в разделе архитектуры проекта в Notion. Этот документ фиксирует текущую локальную реализацию тестового контура.

## Текущий baseline

- основной runner backend и frontend: Vitest;
- backend regression-suite сохранён целиком в `backend/src/tests/business.test.ts`;
- backend suite выполняется последовательно, так как characterization-сценарии используют общую тестовую базу;
- frontend suite проверяет маршруты, роли, тексты и статические UI-контракты;
- Playwright остаётся инструментом visual/E2E-проверок и не заменяется Vitest.

Команды:

```bash
npm test
npm run test -w backend
npm run test -w frontend
```

Перед полным backend regression-suite база должна иметь актуальную schema и системные/demo-данные, а `frontend/dist` должен быть собран для static routing tests.

## Изолированная база

Для локального прогона рекомендуется временная SQLite-база. `TEST_DATABASE_URL` переопределяет `DATABASE_URL` только внутри тестового процесса:

```bash
nvm use
DATABASE_URL='file:./test.db' npm run db:push
DATABASE_URL='file:./test.db' npm run db:seed
TEST_DATABASE_URL='file:./test.db' npm run test -w backend
```

Для Prisma относительный SQLite URL разрешается от `backend/prisma`, поэтому этот пример создаёт `backend/prisma/test.db`. Файл предназначен только для локального тестового запуска и не коммитится.

Текущий Prisma provider остаётся `sqlite`. Наличие `TEST_DATABASE_URL` не означает поддержку PostgreSQL: после отдельной миграции provider и SQL-совместимости тот же вход конфигурации позволит направить suite на изолированную PostgreSQL test database.

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
