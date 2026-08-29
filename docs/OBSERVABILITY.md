# Production observability

> Статус: active  
> Актуализировано: 2026-08-23

## Границы реализации

Backend использует минимальный observability foundation: структурированные JSON-логи, correlation context, dependency readiness и опциональный Sentry error tracking. OpenTelemetry, tracing/APM, Prometheus, Grafana, Redis и BullMQ намеренно не реализованы.

## JSON logs

Единый logger построен на Pino `10.3.1` и подключён как NestJS `LoggerService`. Каждая запись содержит:

- `timestamp`, `level`, `msg` и стабильный `event`;
- `service=zabota-ryadom-backend` и `environment`;
- `correlationId` и, где применимо, `requestId` либо `jobId`/`jobName`;
- для завершённого HTTP request: `method`, безопасный path без query, `statusCode`, `durationMs`;
- для ошибки: только очищенные `name` и `message`, без сериализации request/response body.

Уровень задаётся `LOG_LEVEL`, default — `info`. В test environment logger по умолчанию silent; тесты используют явный memory stream.

## HTTP correlation

Backend переиспользует один существующий header `X-Request-Id`:

- клиентский ID принимается только при длине до 128 символов и составе `A-Z`, `a-z`, цифры, `.`, `_`, `:`, `-`;
- отсутствующий или недопустимый ID заменяется `crypto.randomUUID()`;
- итоговый ID возвращается в `X-Request-Id` response header;
- AsyncLocalStorage делает correlation context доступным сервисному logger и exception filter;
- request и response bodies, query string и headers по умолчанию не логируются.

## Background jobs

Каждый запуск visit reconciliation получает отдельный случайный `jobId`. События `started`, `completed`, `audit_failed` и `failed` имеют общий `correlationId`, `jobId` и `jobName=visit-reconciliation`. Результат содержит только технические counters и duration. Scheduler и его Nest lifecycle не изменены.

## Redaction

Централизованная policy очищает чувствительные keys и распространённые секреты внутри строк. В логи и Sentry не должны попадать:

- password/password hash, JWT, refresh token, Authorization и Cookie;
- OAuth/T-Bank/S3 credentials, DSN и connection passwords;
- телефоны, email, адреса, банковские/card fields;
- полные request/response bodies и содержимое файлов/binary buffers.

При добавлении нового логируемого поля необходимо передавать только минимальные технические identifiers/counters и расширять тестируемую policy, если появляется новый вид секрета.

## Liveness и readiness

- `GET /api/health` — liveness процесса. Его существующий `200` contract не изменён.
- `GET /api/ready` — readiness критических dependencies. PostgreSQL проверяется безопасным `SELECT 1`. При `STORAGE_PROVIDER=s3` bucket проверяется через `HeadBucket`, без чтения, записи или перечисления пользовательских objects. Для local storage check отмечен как `skipped`.

Readiness возвращает `200` со статусом `ready` либо `503` со статусом `not_ready`; детали ошибок и credentials не возвращаются. Timeout одной проверки задаётся `READINESS_TIMEOUT_MS`, default — 3000 ms. Production Compose использует readiness endpoint для container healthcheck; временная неготовность dependency не завершает процесс приложения.

## Sentry

Используется официальный `@sentry/nestjs` `10.70.0` как опциональный adapter:

- без `SENTRY_DSN` adapter выключен и startup не блокируется;
- `SENTRY_ENABLED=false` явно выключает отправку;
- `SENTRY_ENVIRONMENT` и `SENTRY_RELEASE` задают технический контекст;
- `sendDefaultPii=false`, default integrations выключены, `tracesSampleRate=0`;
- auto instrumentation, tracing/APM, profiling, replay и attachments не используются;
- `beforeSend` повторно применяет redaction, удаляет user, request headers/cookies/data и query string;
- expected 4xx validation/auth errors не отправляются;
- unexpected 5xx, reconciliation failures и ошибки записи job audit отправляются с request/job correlation ID.

`SENTRY_DSN` является секретом: он не хранится в Git и не выводится в логи. Перед включением в production должны быть отдельно настроены retention, доступы и alert routing в выбранном Sentry project.
