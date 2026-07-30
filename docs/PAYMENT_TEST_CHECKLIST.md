# Checklist тестового терминала T-Bank

> Статус: OPERATIONAL. Выполнять только с `TBANK_TERMINAL_MODE=test`. Не запускать на действующем live terminal в рамках обычного аудита.

## Подготовка

- [ ] Выделен отдельный test environment и test terminal.
- [ ] HTTPS и notification URL доступны.
- [ ] Созданы DB/env backups без вывода secrets.
- [ ] `PAYMENT_PROVIDER=tbank`, `TBANK_TERMINAL_MODE=test`, receipt=false, mock top-up=false.
- [ ] Используется отдельный тестовый пользователь.

## Пополнение 150 ₽

- [ ] Init вернул PaymentURL и pending `PaymentTransaction`.
- [ ] CONFIRMED webhook прошёл подпись и amount reconciliation.
- [ ] Payment стал succeeded, заполнены paidAt/creditedAt/balanceTransactionId.
- [ ] Ledger `payment_credit:<paymentId>` равен +150 main.
- [ ] Повтор webhook и GetState не меняют баланс повторно.
- [ ] Test operation не появилась в NPD register.

## Возврат

- [ ] Admin refund создал один `RefundTransaction` и отрицательный main ledger.
- [ ] Повтор refund не списал баланс второй раз.
- [ ] Manager и обычный пользователь получили 403.
- [ ] Refund из bank dashboard обнаружен sync/GetState и учтён один раз.
- [ ] Test refund не создал NPD entry.
- [ ] Partial refund вернул manual review без автоматического списания.
- [ ] Недостаточный main balance не ушёл в минус.

## История и чек

- [ ] User/admin history показывает top-up/refund, даты, provider и order/reference.
- [ ] Secrets и raw provider errors отсутствуют в API/UI.
- [ ] Receipt не отправляется в T-Bank API.
- [ ] Зафиксирован ручной процесс чека «Мой налог»; test operation не считается реальным доходом.

## Отдельно от банка

Workflow v2 проверяется на локальной SQLite и внутренних балансах без Init/Cancel:

- [ ] 15 визитов дают сбор 750 ₽ с каждой стороны;
- [ ] первое подтверждение не списывает;
- [ ] второе списывает атомарно;
- [ ] повтор не дублирует ledger;
- [ ] reserve/dispute не создают bank transaction или NPD entry.

Production live включается/остаётся включённым только после документированного ручного решения и успешного checklist. Этот файл не является командой менять production env.
