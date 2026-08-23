# Release readiness и production cutover runbook

> Статус: OPERATIONAL. Снимок локальной реализации от 2026-08-23. Документ не разрешает production access, deploy или live payment operations.

## Итог локального аудита

Локальная реализация готова перейти в контролируемую production phase: обязательный MVP-стек реализован, critical Playwright suite работает на отдельной PostgreSQL E2E-базе, а известных локальных `BLOCKER_BEFORE_RELEASE` после исправления production static routing нет. Это не означает готовность немедленно принимать production-записи: все пункты `PRODUCTION_CONFIGURATION_REQUIRED` ниже являются release gates.

Классификации: `ALIGNED` — реализация присутствует и проверяется; `PARTIAL_BUT_RELEASE_ACCEPTABLE` — ограниченная граница не блокирует одноинстансовый MVP; `PRODUCTION_CONFIGURATION_REQUIRED` — код готов, но нужны production inventory/configuration/rehearsal; `BLOCKER_BEFORE_RELEASE` — выпуск запрещён; `DEFERRED_BY_ARCHITECTURE` — архитектура разрешает отложить.

| Обязательный элемент | Статус | Фактическое основание / release gate |
|---|---|---|
| Node.js LTS / Node 22 | ALIGNED | `.nvmrc`, `engines`, Docker и CI используют Node 22. |
| TypeScript | ALIGNED | Backend и frontend компилируются строгим TypeScript check. |
| NestJS | ALIGNED | Все API endpoints принадлежат NestJS; adapter выровнен с NestJS 11 на Express 5.2. |
| React / TypeScript / Vite | ALIGNED | Production build и critical browser flows зелёные. |
| PostgreSQL | PRODUCTION_CONFIGURATION_REQUIRED | Локальные migrations/rehearsal/E2E доказаны; live SQLite требует отдельного cutover. |
| Prisma controlled migrations | ALIGNED | Только one-shot `prisma migrate deploy`; CLI отсутствует в application runner. |
| REST / JSON / OpenAPI | ALIGNED | Spec генерируется из Nest app; runtime inventory и duplicate check автоматизированы. |
| S3-compatible storage | PRODUCTION_CONFIGURATION_REQUIRED | Private S3 adapter и migration verifier готовы; production bucket/mapping не включены. |
| Authentication / rotating sessions | ALIGNED | Short JWT in memory, HttpOnly refresh-session, rotation/replay/revocation/logout и guards покрыты. |
| Argon2id | PRODUCTION_CONFIGURATION_REQUIRED | Active runtime использует Argon2id; production inventory/reset legacy hashes обязателен. |
| OAuth adapter model | PRODUCTION_CONFIGURATION_REQUIRED | VK adapter/PKCE и session handoff реализованы; callback/credentials/enable flag требуют проверки. |
| Docker / Docker Compose | ALIGNED | Separate migration/runner targets, health dependencies и persistent data boundaries описаны. |
| Caddy / HTTPS boundary | PRODUCTION_CONFIGURATION_REQUIRED | Loopback proxy и базовые headers заданы; DNS, certificate, actual config и headers проверяются на cutover. |
| Git / GitHub / GitHub Actions | ALIGNED | Release workflow, quality, Docker, security policy и отдельный Playwright job определены. |
| Vitest / backend API integration | ALIGNED | Unit, characterization, Nest bootstrap и PostgreSQL/API contracts сохранены. |
| Playwright | ALIGNED | Пять critical scenarios, clean `_e2e` DB, Chromium CI gate. |
| Structured JSON logs / correlation | ALIGNED | Pino, centralized redaction, `X-Request-Id`, AsyncLocalStorage и scheduler job IDs. |
| Sentry/error tracking | PRODUCTION_CONFIGURATION_REQUIRED | Adapter/scrubbing готовы; DSN, retention, access и alerts не настроены в production. |
| Environment/secrets model | PRODUCTION_CONFIGURATION_REQUIRED | Secrets исключены из Git/CI; production values и access policy должны быть provisioned. |
| Single-instance scheduler | ALIGNED | Nest lifecycle reconciliation сохраняет idempotency. |
| Redis / BullMQ | DEFERRED_BY_ARCHITECTURE | Нужны только при масштабировании. |
| OpenTelemetry / Prometheus / Grafana | DEFERRED_BY_ARCHITECTURE | Отложены до роста operational needs. |
| Mobile applications | DEFERRED_BY_ARCHITECTURE | Не входят в обязательный MVP. |

## Security release audit

| Граница | Статус | Проверка перед release |
|---|---|---|
| Auth/session/revocation и admin authorization | ALIGNED | Browser/API tests плюс существующий auth regression suite. |
| Secrets не в Git | ALIGNED | Tracked files не содержат env/private keys; нужен history/host inventory без вывода значений. |
| Logging/Sentry redaction | ALIGNED | Unit/integration tests; bodies/credentials/PII не отправляются по умолчанию. |
| Protected files и private S3 | ALIGNED | Backend authorization precedes read; owner/foreign-user E2E; public URLs отсутствуют. |
| Legal consent/immutability | ALIGNED | Required consent и public documents покрыты; published versions immutable. |
| Financial/payment idempotency | ALIGNED | Characterization covers fee/refund/webhook signature/idempotency; E2E uses mock only. |
| Production npm baseline | PARTIAL_BUT_RELEASE_ACCEPTABLE | 3 high entries only in isolated Prisma CLI chain; CI rejects drift, runner excludes chain. |
| Prisma CLI in application runtime | ALIGNED | Docker CI доказывает отсутствие `prisma`, `@prisma/config`, `deepmerge-ts`. |
| Swagger/OpenAPI defaults | ALIGNED | UI/JSON disabled by default in production. |
| Readiness | ALIGNED | PostgreSQL always checked; S3 `HeadBucket` when selected. |
| Docker non-root | ALIGNED | Runner uses `USER node`; backend port is loopback-only. |
| Caddy/HTTPS/security headers | PARTIAL_BUT_RELEASE_ACCEPTABLE | Automatic HTTPS plus nosniff/frame/referrer policy; TLS/header scan and HSTS decision remain cutover checks. |
| Backup/restore | PRODUCTION_CONFIGURATION_REQUIRED | Destinations, encryption/access, retention and restore rehearsal must be approved. |

OpenAPI schema precision backlog и отсутствие device-list UI не меняют публичное поведение и не являются blockers. Расширенный penetration test может выполняться отдельно.

## Production cutover: обязательный порядок

Каждый шаг фиксируется с временем, оператором, безопасным результатом и ссылкой на закрытый artifact. Secrets/PII в log не копируются.

1. Создать принятый release commit; не использовать dirty working tree.
2. Выполнить push только после разрешения; дождаться green GitHub Actions, включая Playwright, Docker и security audit.
3. Выполнить read-only production inventory: commit/image/container, SQLite path/size/integrity, uploads count/size, env filename/permissions, Caddy config/status, disk, roles, payment/storage modes. Не выводить env values.
4. Перевести current application в maintenance/read-only и зафиксировать write freeze.
5. Создать timestamped backups: SQLite через `.backup`, весь `/uploads`, current env/config, commit/image identifier и Caddyfile.
6. Проверить backups отдельно: `PRAGMA integrity_check`, counts/checksums uploads, permissions/archive readability и test restore. Копию не использовать как рабочую БД.
7. Provision PostgreSQL с отдельным application user, persistent storage, backup destination и restricted network; проверить empty target/connection.
8. Provision private S3 bucket: anonymous access off, least-privilege credentials, encryption/versioning/backup/lifecycle согласованы.
9. На production-копиях повторить SQLite → PostgreSQL rehearsal и uploads → S3 copy; сохранить verification reports закрыто.
10. Выполнить final SQLite backup после freeze и перенести immutable copy штатным tool.
11. Проверить DB report: critical counts, IDs, relations, legal/audit/ledger/idempotency и migration history. Несовпадение блокирует продолжение.
12. Перенести immutable uploads в S3 без удаления source; проверить size/SHA-256/mapping. Несовпадение блокирует storage cutover.
13. На авторизованной DB-копии выполнить `npm run auth:credential-inventory`; согласовать reset unsupported credentials, ровно одного active `superadmin` и legacy admins.
14. Подготовить production env/secrets; проверить permissions, domain/CORS, provider flags и отсутствие mock/demo settings.
15. Собрать release images; запустить one-shot migration service. Non-zero/pending/unknown migration блокирует deployment.
16. Применить verified object mapping и выбрать единственный production `STORAGE_PROVIDER=s3`; local source оставить rollback-copy.
17. Запустить application image без Prisma CLI/schema changes at startup.
18. Проверить Caddy, loopback backend, DNS, certificate, HTTP→HTTPS, security headers и отсутствие public backend port.
19. Дождаться `/api/ready=200`; проверить health, `/`, `/app`, legal, login/session, role denial, protected file и scheduler.
20. Диагностировать T-Bank config без операции; controlled verification выполнять только по отдельному payment разрешению/checklist.
21. Провести UAT; снять write freeze только после явного go decision.
22. После стабильного cutover создать/проверить PostgreSQL backup и S3 backup/versioning. SQLite/uploads backups хранить до конца rollback window.

## Backup и rollback boundaries

До снятия write freeze rollback прост: новая система не принимает записи, поэтому при ошибке новая stack останавливается, а previous image запускается на неизменённых SQLite + local uploads + previous env/Caddy. Sources не удаляются.

- DB migration/verification failed: новый backend не запускать; сохранить reports; reprovision empty target и повторить только из immutable SQLite backup.
- Files migration failed: не переключать provider/DB mapping; оставаться на local source; partial S3 objects не удалять до manifest review.
- Readiness failed: не направлять Caddy traffic; проверить migrations, PostgreSQL, storage/env; вернуть previous stack пока старые данные authoritative.
- Migration service failed: deployment blocked. Prisma migrations forward-only; ручной down migration запрещён.
- Новая версия уже принимает записи: автоматический rollback к SQLite запрещён. Остановить writes, сделать emergency PostgreSQL/S3 backup и inventory; предпочитать forward fix. Previous image допустим только при доказанной совместимости с новой schema/storage.
- После первой PostgreSQL записи boundary становится forward-only. Restore pre-cutover backup теряет/требует ручного merge новых записей и нуждается в отдельном решении.

## Required production configuration (без значений)

- PostgreSQL: host/port/database/user/password/TLS/network, backup destination/retention/restore owner.
- S3: endpoint/region/bucket/access key/secret/path-style, private policy, encryption/versioning/backup/lifecycle.
- Auth: JWT secret, access/refresh/admin/temporary TTL, legacy credential reset decision.
- VK ID: enable flags, client ID/secret, redirect URI/domain.
- T-Bank: provider/mode, terminal key/password, API/success/fail/webhook URLs, receipt decision, verification owner.
- Sentry: enabled flag, DSN, environment/release, retention/access/alerts.
- Network: domains/base URLs/CORS, DNS, Caddy config/certificate ownership.
- Storage: provider, local rollback path, approved mapping report.
- OpenAPI: JSON/UI flags; safe default disabled.
- Product: service fee, minimum top-up, trial/payment settings; mock/demo disabled.
- Administration: single superadmin bootstrap/reset strategy and manager inventory.

Значения не хранить в Git, CI, tickets, reports или shell history. Для secrets заранее определить owner, rotation/revocation и emergency access.
