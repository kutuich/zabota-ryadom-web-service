# Вход через VK ID

> Статус: ACTIVE TECHNICAL DOCUMENT. Фактическое включение production определяется env и не подтверждалось чтением production secrets в документационном аудите 2026-07-30.

## Сценарий

«Забота Рядом» использует официальный VK ID OAuth 2.1 Authorization Code Flow. Backend создаёт `state` и PKCE `code_verifier`, проверяет callback, обменивает `code` на токен и получает профиль VK. Client secret и токены VK не передаются во frontend и не сохраняются в базе.

VK ID упрощает первый вход, но не заменяет регистрацию полностью. Перед доступом к кабинету новый пользователь выбирает роль Заказчика или Помощника, указывает подключённый город и телефон и принимает обязательные юридические документы.

Основа протокола и актуальные параметры сверены с [официальным VK ID SDK](https://github.com/VKCOM/vkid-web-sdk) и его [документацией](https://vkcom.github.io/vkid-web-sdk/docs/).

## Переменные окружения

```env
OAUTH_ENABLED=false
VK_ID_ENABLED=false
VK_ID_CLIENT_ID=
VK_ID_CLIENT_SECRET=
VK_ID_REDIRECT_URI=http://localhost:4000/api/auth/oauth/vk/callback
VK_ID_SUCCESS_REDIRECT_PATH=/app/oauth/complete
VK_ID_FAIL_REDIRECT_PATH=/app/login?oauthError=vk
```

Оба флага должны быть `true`, а ID, secret и redirect URI должны быть заполнены. По умолчанию интеграция выключена и обычный вход продолжает работать без изменений.

## Настройка в VK ID

В кабинете VK ID создайте приложение и укажите разрешённый redirect URI:

- production: `https://zabota-ugorsk.ru/api/auth/oauth/vk/callback`
- local: `http://localhost:4000/api/auth/oauth/vk/callback`

Production redirect URI должен использовать HTTPS. Значения Client ID и Client Secret добавляются только в окружение backend.

## Включение и отключение

Для включения задайте `OAUTH_ENABLED=true`, `VK_ID_ENABLED=true`, заполните параметры и перезапустите приложение. Для отключения установите любой из флагов в `false`: VK-кнопка исчезнет, endpoint старта вернёт ошибку доступности, обычная авторизация останется рабочей.

## Ручная проверка

1. Откройте `/app/login` и нажмите «Войти через VK».
2. Завершите вход в VK и убедитесь, что callback возвращает на `/app/oauth/complete`.
3. Для нового профиля выберите роль, город и телефон, примите обязательные документы.
4. Проверьте переход Заказчика на `/app/client/requests`, Помощника на `/app/performer/profile`.
5. Повторите вход тем же VK ID: новая `UserIdentity` не должна создаваться.
6. Проверьте обычный вход по телефону/email и отдельный вход администратора.

После получения одноразовой OAuth-cookie frontend обменивает её на обычную серверную `AuthSession`: короткий access JWT остаётся только в памяти страницы, а rotating refresh credential хранится в `HttpOnly; SameSite=Strict` cookie (`Secure` в production). Logout и session revocation работают одинаково для password и VK ID входа. В базе provider-части хранится только идентификатор VK и безопасная копия полей профиля; access token VK, client secret и PKCE verifier не сохраняются.

См. [production current state](PRODUCTION_CURRENT_STATE.md) и [documentation index](DOCUMENTATION_INDEX.md).
