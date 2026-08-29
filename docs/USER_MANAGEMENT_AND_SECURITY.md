# User Management & Security

## Роли

Единственные бизнес-роли: `superadmin`, `manager`, `client`, `performer`. Значение `admin` временно сохранено в строковом поле `User.role` только для недеструктивной совместимости старых данных и тестовой инфраструктуры. Оно не назначается через API, не показывается как бизнес-роль и не проходит production authorization. Маршруты `/app/admin` и `/api/admin` являются названиями административного раздела, а не ролью.

В рабочей базе должен быть один активный `superadmin`. Публичная регистрация создаёт только Заказчика или Помощника. Production bootstrap создаёт `superadmin` только в пустой базе. Обычный API не умеет назначать `superadmin`; текущего Суперадминистратора нельзя заблокировать, архивировать, удалить или понизить.

Только Суперадминистратор назначает и снимает менеджеров. При назначении исходная роль сохраняется в `roleBeforeManager`; при снятии она восстанавливается. Обе операции требуют комментарий, пишутся в `AuditLog` и отзывают активные серверные сессии пользователя.

## Пароли и сессии

Клиент хранит короткий access JWT только в памяти процесса страницы и передаёт его как Bearer token. JWT содержит `sessionId` и `tokenVersion`; guard на каждом защищённом запросе проверяет пользователя и активную запись `AuthSession`. Значения access JWT не записываются в `localStorage` или `sessionStorage`.

Долговременная авторизация представлена непрозрачным refresh credential в cookie и серверной записью `AuthSession`. В базе хранится только SHA-256 hash случайного секрета, не сам credential. `POST /api/auth/refresh` атомарно отзывает старую запись и выдаёт новую в той же family. Повторное использование уже ротированного credential отклоняется; replay после короткого окна для параллельного запроса отзывает оставшуюся family и записывает audit event.

Cookie имеет `HttpOnly`, `SameSite=Strict`, `Path=/`; в production дополнительно `Secure` и имя с префиксом `__Host-`. Refresh/logout проверяют `Origin`, если браузер его передал. Cookie не используется как авторизация обычных изменяющих API: они по-прежнему требуют короткий Bearer access token.

Default TTL:

- client/performer: access 10 минут, absolute refresh-session 30 дней, idle 7 дней;
- manager/superadmin: access 5 минут, absolute refresh-session 8 часов, idle 30 минут.

Значения настраиваются `ACCESS_TOKEN_TTL_MINUTES`, `REFRESH_SESSION_DAYS`, `REFRESH_IDLE_DAYS`, `ADMIN_ACCESS_TOKEN_TTL_MINUTES`, `ADMIN_REFRESH_SESSION_HOURS`, `ADMIN_REFRESH_IDLE_MINUTES`. Logout отзывает текущую серверную сессию немедленно. Смена роли, блокировка, административный reset и смена пароля отзывают соответствующие сессии; `authTokenVersion` оставлен как дополнительная глобальная граница инвалидации.

Суперадминистратор может сбросить пароль manager/client/performer. Временный пароль:

- генерируется криптографически стойко и содержит не менее 16 символов;
- хранится только как Argon2id hash;
- возвращается один раз только в успешном ответе reset endpoint;
- не записывается в AuditLog и сервисное сообщение;
- по умолчанию действует 24 часа (`TEMPORARY_PASSWORD_TTL_HOURS`);
- требует обязательной смены до доступа к кабинету.

Пока `mustChangePassword=true`, backend разрешает только `/api/auth/me` и `/api/auth/change-temporary-password`. После смены временного пароля все прежние сессии отзываются и создаётся новая.

Обычный пароль: 12-128 символов, строчная и заглавная буквы, цифра и специальный символ. Пароль не должен содержать телефон, email или никнейм. Все новые hashes создаются централизованно через Argon2id (`m=19456 KiB`, `t=2`, `p=1`, hash length 32).

Bcrypt удалён из active runtime и bootstrap paths. Совместимость входа по bcrypt намеренно не сохранена: такой credential получает `password_reset_required`, без проверки bcrypt и без автоматического rehash. Hash нельзя безопасно конвертировать без исходного пароля. Перед будущим production release необходимо на авторизованной копии БД выполнить `npm run auth:credential-inventory`, сделать backup и организовать контролируемый reset всех `unsupported` credentials. Скрипт выводит только количества и завершает работу с кодом 2 при наличии неподдерживаемых hashes; сами hashes и пользователи не выводятся.

## API

- `GET /api/me/profile` — безопасные данные собственного профиля.
- `PATCH /api/me/profile` — изменение только `displayName` через strict allowlist.
- `POST /api/me/change-password` — самостоятельная смена пароля и отзыв остальных токенов.
- `POST /api/me/sessions/revoke-others` — отзыв старых токенов с перевыдачей текущего.
- `POST /api/auth/change-temporary-password` — обязательная замена временного пароля.
- `POST /api/auth/refresh` — rotation refresh-session и новый короткий access JWT.
- `POST /api/auth/logout` — отзыв текущей refresh-session и очистка cookie.
- `POST /api/admin/users/:id/reset-password` — одноразовый временный пароль, только superadmin.
- `POST /api/admin/users/:id/revoke-sessions` — отзыв всех токенов другого пользователя, только superadmin.
- `POST /api/admin/users/:id/manager/assign` и `/manager/revoke` — управление менеджерами, только superadmin.

## Аудит и сообщения

Security-события: `USER_PASSWORD_RESET_BY_SUPERADMIN`, `USER_TEMPORARY_PASSWORD_LOGIN`, `USER_TEMPORARY_PASSWORD_CHANGED`, `USER_PASSWORD_CHANGED`, `USER_SESSIONS_REVOKED`, `USER_DISPLAY_NAME_CHANGED`, `AUTH_SESSION_LOGOUT`, `AUTH_REFRESH_REPLAY_DETECTED`. Существующие manager/block events сохраняются для обратной совместимости.

Audit payload может содержать actor/target, роль, reasonCode, безопасный комментарий, IP, User-Agent и результат. Пароли, hashes, JWT, cookies и Authorization header не сохраняются. Уведомления о сбросе и смене пароля отправляются через существующие Service Communications без пароля.

## OAuth и ограничения

VK ID после provider callback создаёт ту же `AuthSession` и ту же пару short access/rotating refresh, что и password login. Provider credentials и tokens во frontend не передаются. Отдельный UI списка устройств и отзыв одной выбранной сессии пока не реализованы; доступны logout текущей, revoke others и административный revoke all. Значение `admin` можно физически удалить из типов только отдельной миграцией после проверки исторических данных и fixtures.

## Production checklist

1. Создать backup БД и env.
2. Подтвердить, что существует ровно один active `superadmin`, а реальные сотрудники с legacy `admin` разобраны вручную.
3. На staging-копии применить Prisma migration `AuthSession`; она не изменяет и не удаляет пользователей или hashes.
4. Выполнить `npm run auth:credential-inventory`. При `unsupported > 0` release блокируется до согласованного reset-процесса; production автоматически не очищать и bcrypt fallback не включать.
5. Настроить session TTL и HTTPS, проверить `__Host-zabota_refresh; HttpOnly; Secure; SameSite=Strict`.
6. Проверить login, refresh rotation/replay, logout, revoke others/all, смену и reset пароля, VK ID и отдельный admin TTL.
7. Не записывать пароль, hash, JWT, cookie или Authorization header в тикеты, сообщения и логи.
