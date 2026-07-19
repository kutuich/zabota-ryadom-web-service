# T-Bank Payment Setup

Документ описывает тестовое подключение Т-Банка для пополнения баланса в приложении "Забота Рядом 2.0".

## Выбранный сценарий

Используется сценарий "Платёжная форма банка".

Приложение не собирает и не хранит данные банковских карт. Ввод номера карты, срока действия, CVV/CVC, паролей банковских приложений и кодов из SMS происходит только на стороне платёжной формы банка.

Backend только инициирует платёж через метод `Init` API Т-Банка и получает `PaymentURL`. Frontend перенаправляет пользователя на `PaymentURL`.

Баланс пользователя пополняется только после успешного webhook/notification от платёжного провайдера. Сам `Init` не начисляет баланс.

`PAYMENT_PROVIDER=mock` используется для разработки и локального тестирования.

`PAYMENT_PROVIDER=tbank` используется только после получения тестового или боевого терминала Т-Банка и заполнения всех обязательных env-переменных.

## Env-переменные

Для тестового или боевого подключения укажите:

```bash
PAYMENT_PROVIDER=tbank
PAYMENT_RECEIPT_ENABLED=false
TBANK_TERMINAL_KEY=
TBANK_PASSWORD=
TBANK_API_URL=https://securepay.tinkoff.ru/v2
TBANK_SUCCESS_URL=https://zabota-ugorsk.ru/app/balance/payment-success
TBANK_FAIL_URL=https://zabota-ugorsk.ru/app/balance/payment-fail
TBANK_NOTIFICATION_URL=https://zabota-ugorsk.ru/api/payments/tbank/webhook
```

Для локального тестового env-шаблона используйте `.env.tbank.test.example`.

## Что взять из личного кабинета Т-Банка

- `TerminalKey`.
- `Password`.
- Адрес webhook/notification: `TBANK_NOTIFICATION_URL`.
- Success URL: `TBANK_SUCCESS_URL`.
- Fail URL: `TBANK_FAIL_URL`.
- Доступные способы оплаты в платёжной форме.

## Проверка перед включением tbank

- Приложение запущено по публичному HTTPS-адресу.
- `TBANK_NOTIFICATION_URL` доступен из интернета.
- `PAYMENT_PROVIDER=tbank`.
- `TBANK_TERMINAL_KEY` и `TBANK_PASSWORD` заполнены.
- Test payment создаёт `PaymentTransaction`.
- После оплаты приходит webhook/notification.
- Баланс пополняется только один раз.
- В админке "Платежи" виден платёж.
- В истории пополнений пользователя виден статус платежа.

## Что пока не включено

- Онлайн-касса / фискализация.
- Автоматические возвраты на карту.
- Своя платёжная форма.
- Хранение банковских карт.
- Рекуррентные платежи.

## Важные ограничения

Не включайте `PAYMENT_PROVIDER=tbank` без заполненных `TBANK_TERMINAL_KEY` и `TBANK_PASSWORD`.

Не запускайте реальные платежи без тестового терминала и проверки webhook на публичном HTTPS-адресе.

`PAYMENT_RECEIPT_ENABLED=false` оставлен явно: фискализация будет подключаться отдельной итерацией после согласования реквизитов, налогового режима и требований онлайн-кассы.
