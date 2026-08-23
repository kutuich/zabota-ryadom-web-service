# Репетиция миграции SQLite -> PostgreSQL

> Статус: LOCAL REHEARSAL. Production не мигрирован. Команды переноса принимают только локальный PostgreSQL и не предназначены для автоматического production cutover.

## Целевая модель

- основной Prisma provider: `postgresql`;
- изменения schema применяются через версионные файлы `backend/prisma/migrations` и `prisma migrate deploy`;
- production-style rollout выполняет `prisma migrate deploy` отдельным one-shot migration container до application container; обычный application startup schema не изменяет;
- SQLite-клиент в `backend/prisma/sqlite-source` используется только для чтения явно указанной исходной копии;
- `db push` не является production-механизмом и удалён из основных scripts;
- перенос сохраняет исходные IDs, timestamps, nullable values и скалярные snapshots.

## Локальная инфраструктура

```bash
cp .env.postgres-rehearsal.example .env.postgres-rehearsal
docker compose -f compose.postgres-rehearsal.yml up -d
docker compose -f compose.postgres-rehearsal.yml ps
```

Compose поднимает PostgreSQL 16 только на `127.0.0.1:55432` с отдельными local-only credentials и базами:

- `zabota_rehearsal` для переноса;
- `zabota_test` для characterization suite;
- `zabota_smoke` для запущенного приложения.

## Подготовка schema

```bash
npm run db:generate
DATABASE_URL='postgresql://zabota_local:zabota_local_only@127.0.0.1:55432/zabota_rehearsal?schema=public' npm run db:migrate:deploy
```

Целевая база переноса обязана быть пустой. Инструмент завершится ошибкой, если найдёт хотя бы одну строку.

Для проверки production-style ordering используется `compose.production.yml`: `postgres` должен стать healthy, `migrate` завершиться с exit 0, и только затем `backend` может стартовать. Повторный migration job идемпотентен. Failure job блокирует backend через `service_completed_successfully`; Prisma migration history для моделирования ошибки не изменяется.

## Копия и перенос

Никогда не указывать рабочую production SQLite-базу напрямую. Сначала создать отдельную consistent copy штатным SQLite backup API:

```bash
mkdir -p postgres-rehearsal-reports
sqlite3 backend/prisma/dev.db ".backup 'postgres-rehearsal-reports/sqlite-source-copy.db'"

npm run db:rehearsal:transfer -- \
  --source 'file:/ABSOLUTE/PATH/postgres-rehearsal-reports/sqlite-source-copy.db' \
  --target 'postgresql://zabota_local:zabota_local_only@127.0.0.1:55432/zabota_rehearsal?schema=public' \
  --report postgres-rehearsal-reports/transfer-and-verification.json \
  --confirm-local-rehearsal
```

Защиты инструмента:

- обязательны явные `--source`, `--target` и confirmation flag;
- source должен быть существующим абсолютным `file:` URL;
- target должен быть loopback PostgreSQL с именем базы, содержащим `rehearsal`, `test` или `smoke`;
- target credentials обязательны, password в лог не выводится;
- transfer выполняется одной транзакцией;
- IDs и timestamps не генерируются заново.

## Верификация

```bash
npm run db:rehearsal:verify -- \
  --source 'file:/ABSOLUTE/PATH/postgres-rehearsal-reports/sqlite-source-copy.db' \
  --target 'postgresql://zabota_local:zabota_local_only@127.0.0.1:55432/zabota_rehearsal?schema=public' \
  --report postgres-rehearsal-reports/verification.json \
  --confirm-local-rehearsal
```

Отчёт проверяет все Prisma-модели: counts, primary IDs, digest всех scalar values, nullable counts, unique sets и полноту FK. Отдельные обязательные блоки проверяют:

- balances, ledger aggregates, idempotency keys, payments/refunds/fees;
- legal documents, consents и audit history;
- requests, snapshots, responses, chats, agreements и visits;
- metadata документов и защищённых вложений.

Любое критическое несовпадение возвращает ненулевой exit code. JSON-отчёты создаются с mode `0600` и не коммитятся.

## Tests и HTTP smoke

```bash
DATABASE_URL='postgresql://zabota_local:zabota_local_only@127.0.0.1:55432/zabota_test?schema=public' npm run db:migrate:deploy
DATABASE_URL='postgresql://zabota_local:zabota_local_only@127.0.0.1:55432/zabota_test?schema=public' npm run db:seed
TEST_DATABASE_URL='postgresql://zabota_local:zabota_local_only@127.0.0.1:55432/zabota_test?schema=public' npm test
```

Для HTTP smoke сначала мигрировать и seed `zabota_smoke`, затем запустить backend на порту 4400 с `PAYMENT_PROVIDER=mock` и выполнить:

```bash
DATABASE_URL='postgresql://zabota_local:zabota_local_only@127.0.0.1:55432/zabota_smoke?schema=public' \
PAYMENT_PROVIDER=mock TBANK_TERMINAL_MODE=test \
npm run db:smoke:postgres -- --base-url=http://127.0.0.1:4400
```

Smoke проверяет health, public/legal bootstrap и read/status, регистрацию/login, JWT и admin-role guards, каталог, баланс, mock payment, protected-file denial, заявку, публикацию, отклик, чат, условия, двойное подтверждение и финальный `in_work`.

## Обнаруженные различия

- Prisma schema не использовала native SQLite-only типы, autoincrement, `Decimal`, `BigInt`, enums или raw SQL, поэтому перенос скалярных данных прямой.
- Строковые JSON snapshots сохраняются без преобразования.
- Тесты содержали `findFirst` без стабильного критерия и времязависимые графики. Фикстуры сделаны детерминированными; прикладная бизнес-логика не менялась.
- Файлы не копируются в БД: сверяется их metadata. Отдельный repeatable перенос local uploads в S3-compatible storage и checksum verification описаны в [`OBJECT_STORAGE.md`](OBJECT_STORAGE.md); это не является production cutover.

## Rollback rehearsal

Локальный rollback прост: остановить приложение, удалить только локальный compose volume и повторить репетицию из неизменяемой SQLite-копии. Production rollback не определён этим этапом. До отдельного cutover текущие `/opt/zabota/data/zabota.db`, uploads и env остаются неизменными.
