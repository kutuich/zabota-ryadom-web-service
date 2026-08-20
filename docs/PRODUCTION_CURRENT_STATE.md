# Текущее production-состояние

> Статус: OPERATIONAL SNAPSHOT  
> Последняя актуализация документа: 2026-07-30  
> Значения payment mode зафиксированы по утверждённому решению пользователя; секреты и production env в рамках аудита не читались.

## Архитектура

- домен: `https://zabota-ugorsk.ru`;
- reverse proxy: Caddy, host TCP 80/443, automatic HTTPS;
- container: `zabota-web`;
- host binding приложения: `127.0.0.1:4000`;
- volume: `/opt/zabota/data:/data`;
- SQLite host path: `/opt/zabota/data/zabota.db`;
- uploads host path: `/opt/zabota/data/uploads`;
- env path: `/opt/zabota/repo/.env.production` (содержимое не документируется).

## Заявленные flags

```text
PAYMENT_PROVIDER=tbank
TBANK_TERMINAL_MODE=live
PAYMENT_RECEIPT_ENABLED=false
ALLOW_LEGACY_MOCK_TOP_UP=false
SEED_DEMO_DATA=false
VISIT_RECONCILIATION_ENABLED=true
VISIT_RECONCILIATION_INTERVAL_MINUTES=15
VISIT_RECONCILIATION_RUN_ON_STARTUP=true
```

Статус VK ID здесь не утверждается: его следует проверять без вывода `VK_ID_CLIENT_SECRET` через разрешённый UI/start endpoint и наличие безопасных boolean flags.

## Backup

- DB и uploads резервируются до каждого deploy/schema change;
- env backup создаётся без вывода содержимого;
- восстановление проверяется на отдельном пути;
- container/image можно заменить без удаления `/opt/zabota/data`.

## Read-only проверки

```bash
curl -i https://zabota-ugorsk.ru/api/health
curl -I http://zabota-ugorsk.ru
docker ps --filter name=zabota-web
ss -ltnp
systemctl status caddy --no-pager
```

Команды не должны печатать env, logs с персональными данными или credentials.

## Ограничения

- receipt/online касса выключены;
- partial bank refund требует manual review;
- SQLite рассчитан на один пишущий production-инстанс;
- scheduler reconciliation использует in-process lock и также рассчитан на один application instance;
- изменение финализированного графика с финансовой дельтой не реализовано;
- agreement schedule остаётся technical draft до юридического утверждения.

## PostgreSQL transition

Репозиторий подготовлен к локальной PostgreSQL-репетиции, но этот факт не меняет production автоматически. Production по-прежнему использует `/opt/zabota/data/zabota.db`. Версию с PostgreSQL Prisma provider нельзя разворачивать обычным deploy до отдельного backup, rehearsal на production-копии, provision PostgreSQL, controlled cutover и проверенного rollback.

Deploy procedure: [DEPLOY_TIMEWEB.md](DEPLOY_TIMEWEB.md). Checklist: [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md).
# User Management & Security v1.0

Целевая модель ролей: Суперадминистратор, Менеджер, Заказчик, Помощник. `admin` оставлен deprecated только на уровне совместимости. Реализованы версионный отзыв JWT, административный временный пароль с TTL, обязательная смена, самостоятельная смена пароля и никнейма. Таблица отдельных устройств/refresh-сессий не реализована.
# Не активировано автоматически

Schema v3 и черновики реализованы в коде. Отдельный v3 seed создаёт draft-версии и не переключает production effective structure. Production env, БД и deploy этим этапом не изменяются.
