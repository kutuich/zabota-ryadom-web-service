# Объектное хранилище файлов

> Статус: ACTIVE TECHNICAL DOCUMENT. Production cutover в Этап 8 не выполнялся.

## Реализация

Бинарные данные документов Помощника, вложений служебных сообщений и файлов проектов договоров проходят через framework-independent `ObjectStorage`. Доменный код и NestJS controllers не импортируют AWS SDK. Реализованы:

- `LocalObjectStorage` — dev/test и rollback-копия;
- `S3ObjectStorage` на `@aws-sdk/client-s3` — единственный целевой production provider.

`STORAGE_PROVIDER=local` остаётся безопасным default до отдельно утверждённого production cutover. При `s3` приложение проверяет доступность приватного bucket при старте. Скачивание всегда идёт через существующий backend endpoint: сначала JWT/role/entity authorization, затем чтение объекта. Публичные object URL и постоянные signed URL не используются.

## Конфигурация

```dotenv
STORAGE_PROVIDER=local # local | s3
UPLOADS_DIR=backend/uploads
S3_ENDPOINT=
S3_REGION=us-east-1
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false
```

`S3_ENDPOINT` нужен для совместимых providers; для AWS S3 его можно оставить пустым. `S3_FORCE_PATH_STYLE=true` используется только если этого требует provider. Access/secret keys передаются через secret/env management, не добавляются в Compose, Git, логи или отчёты.

Bucket и объекты должны быть private. Bucket policy не должна разрешать anonymous `GetObject`.

## Keys, metadata и целостность

Новые keys имеют вид `<тип>/<random UUID>` и не содержат исходное имя, ФИО, телефон, email или entity/user identifiers. Исходное имя, MIME, размер, SHA-256, владелец/связь и timestamps остаются в PostgreSQL. Original filename используется только после авторизации для `Content-Disposition`.

При записи передаются content type, размер, SHA-256 checksum header и metadata `sha256`. После `PutObject` выполняется `HeadObject` и сверяются размер и собственная SHA-256 metadata. ETag не используется как SHA checksum. При скачивании bytes повторно сверяются с checksum из БД до ответа. Новые объекты создаются с `If-None-Match: *`, поэтому случайная коллизия key не перезапишет существующий объект.

Текущие upload limits остаются прежними: 5 МБ для документа Помощника, 10 МБ на вложение и не более 5 вложений в сообщении. Контроллеры буферизуют один уже ограниченный файл для проверки checksum до отправки; это сознательная граница текущего API.

## Локальный S3 test provider

`compose.storage-test.yml` запускает MinIO только на loopback-портах `59000/59001`, с tmpfs и локальными тестовыми credentials. Образ закреплён digest. Это бесплатный S3-compatible test provider; он не входит в production Compose.

```bash
docker compose -f compose.storage-test.yml up -d --wait
S3_TEST_ENABLED=true \
S3_ENDPOINT=http://127.0.0.1:59000 \
S3_REGION=us-east-1 \
S3_ACCESS_KEY_ID=zabota-local-test \
S3_SECRET_ACCESS_KEY=zabota-local-test-secret \
npm run test -w backend -- --run src/tests/objectStorage.test.ts
docker compose -f compose.storage-test.yml down
```

## Перенос существующих files

Сначала создать read-only inventory из явно выбранной БД:

```bash
npm run storage:inventory -- --output=storage-migration-reports/inventory.json
```

Затем выполнить copy в явно указанные source, endpoint и bucket. Credentials передаются только через env:

```bash
S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... npm run storage:migrate -- \
  --source-root=/explicit/local/uploads \
  --manifest=storage-migration-reports/inventory.json \
  --report=storage-migration-reports/verification.json \
  --target-endpoint=https://explicit-s3-endpoint \
  --target-region=us-east-1 \
  --target-bucket=explicit-private-bucket \
  --force-path-style=false
```

Tool генерирует детерминированный opaque target key из типа и DB record id, сверяет source size/SHA-256, копирует, повторно читает и проверяет target. Повторный запуск помечает совпавший объект `already_verified`. Любое критическое расхождение даёт ненулевой exit code. Report содержит техническое mapping `record -> objectKey`, может раскрывать внутренние identifiers/старые paths и поэтому исключён из Git.

Tool не удаляет source и не меняет БД. Применение mapping к `storagePath`, переключение `STORAGE_PROVIDER=s3` и production запуск являются отдельным cutover. До его принятия source directory остаётся rollback-копией; backup обязан охватывать и БД, и приватный bucket, и локальную rollback-копию на согласованный срок.

## Остаточные границы

- S3 adapter проверен с MinIO; конкретный production provider, bucket policy, encryption, lifecycle/versioning и backup policy должны быть проверены до cutover.
- Автоматического dual-write нет: production должен иметь один выбранный provider.
- Copy report не является cutover: пока mapping не применён к БД, приложение продолжает читать текущий provider.
