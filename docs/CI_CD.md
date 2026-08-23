# CI/CD

> Статус: active  
> Актуализировано: 2026-08-23

## Назначение

Основной workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) проверяет pull request и каждый push в `main`. Этап 9 добавляет только continuous integration: публикации образов, deploy и обращения к production в workflow нет.

Workflow использует Node.js из `.nvmrc` (22 LTS), установку `npm ci` по зафиксированному `package-lock.json` и отдельный чистый PostgreSQL 16 service container. Права GitHub token ограничены `contents: read`, значения окружения являются тестовыми и не требуют repository secrets.

## Обязательные проверки

Job `Node 22 / PostgreSQL` последовательно выполняет:

1. установку locked dependencies и генерацию Prisma clients;
2. `prisma migrate deploy` на чистой базе `zabota_ci` и загрузку test fixtures;
3. `npm run check`;
4. `npm run build`;
5. `npm test`, включая OpenAPI contract inventory и backend/frontend regression suite;
6. `npm run api:openapi` и проверку наличия сгенерированного JSON;
7. `npm run security:audit-ci`;
8. `git diff --check`.

OpenAPI JSON создаётся в `backend/generated/openapi.json`. Это проверяемый, но не коммитируемый артефакт: источником контракта остаётся фактическое NestJS-приложение, а не вручную поддерживаемый JSON.

Отдельный job собирает Docker targets `migration` и `runner`. Runner загружается только локально в GitHub runner и дополнительно проверяется на отсутствие Prisma CLI, `@prisma/config` и `deepmerge-ts`. Образы не публикуются.

## Test-safe configuration

CI использует только локальные для job значения:

- PostgreSQL доступен внутри GitHub runner и не связан с production;
- `PAYMENT_PROVIDER=mock` и `TBANK_TERMINAL_MODE=test` исключают live payment operations;
- OAuth/VK отключены;
- `STORAGE_PROVIDER=local`, файлы пишутся во временный каталог runner;
- JWT secret — явное непроизводственное значение CI.

Production credentials, S3 keys, T-Bank secrets и OAuth credentials в workflow не нужны и не должны туда добавляться.

## Security audit policy

`npm run security:audit-ci` запускает `npm audit --omit=dev --json` и применяет машинно проверяемую политику из `scripts/production-audit-policy.mjs`. CI завершается ошибкой при:

- любом critical advisory;
- новом high advisory;
- новом low/moderate advisory относительно текущего нулевого baseline;
- изменении разрешённой dependency chain;
- перемещении Prisma CLI в runtime dependencies.

Единственное временное исключение — известный high advisory `GHSA-ggr8-5vv4-36mx` в изолированной migration-tooling цепочке `prisma -> @prisma/config -> deepmerge-ts`. Production runner удаляет все три пакета. Исключение нельзя расширять автоматически: исправление upstream или изменение цепочки требует явного пересмотра policy и этого документа.

## Локальное воспроизведение

Используйте Node 22 и отдельную PostgreSQL test database. После задания `DATABASE_URL` и `TEST_DATABASE_URL` на эту базу порядок соответствует CI:

```bash
nvm use 22
npm ci
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
npm run check
npm run build
npm test
npm run api:openapi
npm run security:audit-ci
git diff --check
```

Не направляйте эти команды на production database. Для смены schema необходимо добавить Prisma migration и доказать её на новой пустой PostgreSQL базе; `db push` не является CI или production migration process.

## Правило изменения workflow

- Новый runtime endpoint обязан оставаться покрытым OpenAPI contract inventory.
- Новая runtime dependency должна проходить audit policy без скрытого allowlist.
- Версии actions фиксируются commit SHA с комментарием major release; обновление выполняется осознанно.
- Deploy, публикация образов и production environments требуют отдельного этапа и отдельного решения.
