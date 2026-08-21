# OpenAPI фактического HTTP API

> Статус: active  
> Актуализировано: 2026-08-21

## Назначение

OpenAPI 3 генерируется из фактического NestJS application graph. Текущие URL не версионируются: префикс `/api/v1` на этом этапе не вводится. HTTPS завершается на production boundary (Caddy), а приложение сохраняет существующий REST/JSON contract.

Генератор включает только runtime API paths с префиксом `/api/`; static delivery и Swagger infrastructure не входят в API inventory. Contract test сопоставляет OpenAPI с зарегистрированными NestJS routes и запрещает пропущенные либо дублирующиеся пары `method + path`.

## Локальный доступ

- Swagger UI: `/api/docs`;
- OpenAPI JSON: `/api/openapi.json`;
- `SWAGGER_UI_ENABLED=true|false` управляет UI;
- `OPENAPI_JSON_ENABLED=true|false` управляет JSON endpoint.

Оба флага по умолчанию включены вне production и выключены при `NODE_ENV=production`. Production-публикация требует явного значения соответствующего флага. Bearer token не сохраняется Swagger UI между перезагрузками. Spec не содержит JWT, OAuth client secret, T-Bank password/token/signature и примеры credentials.

## Генерация артефакта

```bash
npm run api:openapi
```

Команда создаёт `backend/generated/openapi.json` с правами `0600`. Каталог `backend/generated/` исключён из Git: JSON генерируется в build/CI или локально и не является второй вручную редактируемой копией контракта. В Git хранятся генератор, Zod schemas и contract tests.

## Как документировать новый endpoint

1. Добавить route в штатный NestJS controller и сохранить runtime validation в Zod/Nest validation contract.
2. Для body/response, у которых нужна структурная схема, экспортировать используемую Zod schema и применить `ApiZodBody(schema)` / `ApiZodResponse(status, schema)`. Декоратор конвертирует ту же schema, которая выполняет runtime parsing; копировать поля вручную нельзя.
3. Применить `NestJwtAuthGuard` для защищённого endpoint. Генератор выставит `bearerAuth`; refresh/logout документируются схемой `refreshSession`, публичные операции получают явный пустой `security`.
4. Для download сохранить реальный streaming response и `Content-Disposition`; генератор описывает его как binary. Фактический upload документов сейчас принимает JSON с base64, а не `multipart/form-data`, и так же отражён в точной схеме.
5. Запустить `npm run api:openapi` и `openApiContract.test.ts`. Runtime endpoint без OpenAPI representation или duplicate `method + path` делает тест красным.

## Текущее покрытие

На 2026-08-21 документ содержит 199 paths и 223 операции: 207 защищённых Bearer JWT, 2 refresh-cookie операции и 14 публичных. У 83 операций есть request body. Для регистрации, login, создания заявки, payment init и upload документа body описан точной схемой, построенной из того же Zod contract. Health и payment init имеют точную структурную success schema. Остальные JSON success responses сохраняют status/content type и временно представлены общим `JsonValue`.

Download endpoints представлены binary response и сохраняют authentication metadata. VK OAuth описан без credentials. Payment init/status, webhook/refund/admin surfaces входят в общий inventory; секретные подписи и реальные платёжные примеры не публикуются.

## Известные отклонения точности схем

- 78 из 83 body endpoints всё ещё разбирают `req.body` локальными Zod expressions внутри legacy-style controller methods. Они представлены как JSON object с extension `x-schema-precision: runtime-zod-generic-openapi`; фактическая runtime Zod validation не изменялась. Для полной field-level точности эти схемы следует последовательно вынести в переиспользуемые exports и связать через `ApiZodBody`, не создавая ручную копию.
- Структурные success schemas формализованы для двух representative responses. Остальные обработчики используют явный `Response` и доменные serializers, поэтому документируется корректный status/content type, но JSON shape пока общий. Это отдельный contract-hardening backlog, а не основание менять response shape.
- Исторически основной error shape — объект с `error`, опциональными `code` и `details`, но отдельные Nest/redirect/provider paths имеют иной ответ. OpenAPI использует совместимую расширяемую `ApiError`; унификация ошибок намеренно не выполнялась, поскольку изменила бы публичное поведение.
- Query parameters, извлекаемые существующими legacy-style handlers, отражены без ужесточения required/min/max там, где controller metadata пока этого не содержит. Runtime validation остаётся источником фактического поведения.

Маршрутов, полностью отсутствующих в OpenAPI, нет. Перечисленные пункты относятся к точности field-level schemas и должны устраняться отдельными малыми доменными пакетами.
