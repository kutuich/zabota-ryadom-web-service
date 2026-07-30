# T-Bank payment setup

> Статус: ACTIVE TECHNICAL/OPERATIONAL DOCUMENT. Не содержит credentials.

## Контуры

| Контур | Provider | Mode | NPD register | Назначение |
|---|---|---|---|---|
| Local | mock | test | нет | UI/backend development |
| T-Bank test | tbank | test | нет | Init/webhook/GetState/refund tests |
| Production | tbank | live | да, только bank operations | реальные пополнения и возвраты |

Во всех контурах receipt выключен. Текущий production mode зафиксирован как live по решению от 2026-07-30; этот документ не читает production env.

## Payment flow

Backend создаёт `PaymentTransaction`, вызывает T-Bank `Init` с `PayType=O` и возвращает `PaymentURL`. Карточные данные вводятся только на форме банка. `Init` не начисляет баланс.

Подписанный webhook со `Success=true`, `Status=CONFIRMED` и совпадающими TerminalKey, PaymentId, OrderId и amount запускает атомарное зачисление. Idempotency key: `payment_credit:<paymentTransactionId>`. `AUTHORIZED` остаётся pending. Failed/cancelled/expired/manual_review не зачисляются.

Webhook — основной источник. `GetState` используется для ручного refresh/sync и проходит те же проверки/idempotency. Raw secrets не сохраняются и не логируются.

## Env names

```env
PAYMENT_PROVIDER=tbank
TBANK_TERMINAL_MODE=test_or_live
PAYMENT_RECEIPT_ENABLED=false
TBANK_TERMINAL_KEY=
TBANK_PASSWORD=
TBANK_API_URL=https://securepay.tinkoff.ru/v2
TBANK_SUCCESS_URL=https://zabota-ugorsk.ru/app/balance/payment-success
TBANK_FAIL_URL=https://zabota-ugorsk.ru/app/balance/payment-fail
TBANK_NOTIFICATION_URL=https://zabota-ugorsk.ru/api/payments/tbank/webhook
```

`test` используется только с demo terminal, `live` — только с боевым. Значения должны соответствовать одному терминалу.

## Refunds

- App refund вызывает `/Cancel`, создаёт `RefundTransaction` и отрицательный main-balance ledger один раз.
- Refund из кабинета банка обнаруживается admin-командой sync/GetState и не вызывает повторный `/Cancel`.
- Manual bank refund — резервный live-only сценарий по подтверждающим документам.
- Partial refund и недостаточный main balance переходят в manual review.
- Спор по `RequestVisit` не является банковским refund и никогда автоматически не вызывает `/Cancel`.

## NPD и внутренние операции

NPD register включает только live T-Bank top-ups и реальные live bank refunds. Test/mock, trial/bonus, admin adjustments, списания сервисного сбора и reserve allocations не включаются. Реестр не отправляет данные в ФНС автоматически.

Сервисный fee ledger — внутренняя операция. Reserve — аналитический показатель. Они не создают нового банковского поступления.

## Receipt

`PAYMENT_RECEIPT_ENABLED=false`. Чек «Мой налог» формируется вручную и может быть отправлен пользователю сервисным сообщением. Онлайн-касса, Receipt payload и автоматическая фискализация не включаются без отдельной юридической/технической проверки.

## Проверка

Полный test-terminal сценарий: [PAYMENT_TEST_CHECKLIST.md](PAYMENT_TEST_CHECKLIST.md). На действующем live terminal его нельзя выполнять в рамках обычного аудита. Workflow v2 fee tests выполняются локально на внутренних балансах без T-Bank Init.
