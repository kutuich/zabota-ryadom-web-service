import { CreditCard, ExternalLink, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { BalanceSummary, PaymentTransaction } from "../types";
import { formatDateTimeRu } from "../utils/dateTime";

const quickAmounts = [150, 300, 500, 1000];

export function BalancePanel() {
  const [balance, setBalance] = useState<BalanceSummary | null>(null);
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [amount, setAmount] = useState(150);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshingPaymentId, setRefreshingPaymentId] = useState<string | null>(null);

  async function load() {
    const [balancePayload, paymentsPayload] = await Promise.all([
      api.balance(),
      api.getMyPayments()
    ]);
    setBalance(balancePayload);
    setPayments(paymentsPayload);
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message));
  }, []);

  async function startTopUp() {
    const minAmount = balance?.minTopUpAmount ?? 150;
    if (!Number.isSafeInteger(amount) || amount < minAmount) {
      setMessage(`Минимальная сумма пополнения ${minAmount} ₽.`);
      return;
    }

    setIsSubmitting(true);
    setMessage("");
    try {
      const payment = await api.createTopUpPayment(amount);
      if (!payment.paymentUrl) {
        setMessage("Не удалось создать платёж. Попробуйте позже.");
        await load();
        return;
      }
      window.location.href = payment.paymentUrl;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось создать платёж. Попробуйте позже.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function refreshPayment(paymentId: string) {
    setRefreshingPaymentId(paymentId);
    setMessage("");
    try {
      const result = await api.refreshPaymentStatus(paymentId);
      setMessage(result.message);
      await load();
    } catch {
      setMessage("Не удалось проверить статус платежа. Попробуйте позже или обратитесь к администратору.");
    } finally {
      setRefreshingPaymentId(null);
    }
  }

  const minAmount = balance?.minTopUpAmount ?? 150;
  const canSubmitTopUp = Number.isSafeInteger(amount) && amount >= minAmount && amount <= 1_000_000;

  return (
    <section className="panel-grid">
      <div className="metric">
        <CreditCard size={20} />
        <span>Доступно для заявок</span>
        <strong>{balance?.totalAvailableBalance ?? 0} ₽</strong>
      </div>
      <div className="metric">
        <span>Основной баланс</span>
        <strong>{balance?.realBalance ?? 0} ₽</strong>
      </div>
      <div className="metric">
        <span>Бонусный баланс</span>
        <strong>{balance?.bonusBalance ?? 0} ₽</strong>
      </div>
      <section className="plain-section span-2">
        <h2>Пополнить баланс</h2>
        <p className="privacy-note">
          Выберите сумму пополнения. После нажатия кнопки откроется платёжная форма банка или тестовая платёжная форма.
        </p>
        <p className="notice">
          Сервис не хранит данные банковских карт, CVV/CVC-коды, пароли банковских приложений и коды из SMS.
        </p>
        <div className="trust-row">
          {quickAmounts.map((value) => (
            <button
              className={amount === value ? "choice choice--active" : "choice"}
              key={value}
              type="button"
              onClick={() => setAmount(value)}
            >
              {value} ₽
            </button>
          ))}
        </div>
        <div className="form-inline">
          <label>
            Своя сумма
            <input
              type="number"
              min={minAmount}
              max={1_000_000}
              step={1}
              value={amount}
              onChange={(event) => setAmount(Number(event.target.value))}
            />
          </label>
          <button className="primary-button" type="button" onClick={startTopUp} disabled={isSubmitting || !canSubmitTopUp}>
            <ExternalLink size={18} />
            {isSubmitting ? "Создаём платёж" : "Перейти к оплате"}
          </button>
        </div>
        <small>Минимальная сумма: {minAmount} ₽.</small>
      </section>
      {message && <p className="notice span-2">{message}</p>}
      <section className="plain-section span-2">
        <h2>История пополнений</h2>
        {payments.length === 0 ? (
          <p className="empty-text">Пополнений пока нет.</p>
        ) : (
          <div className="transaction-list">
            {payments.slice(0, 10).map((payment) => (
              <div className="transaction-row" key={payment.id}>
                <span>{formatDateTimeRu(payment.createdAt)}</span>
                <strong>{payment.amount} ₽</strong>
                <span>{paymentStatusLabel(payment.status)}</span>
                <span>{paymentProviderLabel(payment.provider)}</span>
                <small>{payment.orderId}</small>
                <small>{payment.description ?? "Пополнение баланса"}</small>
                {payment.status === "pending" && (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void refreshPayment(payment.id)}
                    disabled={refreshingPaymentId === payment.id}
                  >
                    <RefreshCcw size={16} />
                    {refreshingPaymentId === payment.id ? "Проверяем" : "Проверить статус"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="plain-section span-2">
        <h2>История операций баланса</h2>
        {!balance?.transactions.length ? (
          <p className="empty-text">Операций пока нет.</p>
        ) : (
          <div className="transaction-list">
            {balance.transactions.slice(0, 20).map((transaction) => (
              <div className="transaction-row" key={transaction.id}>
                <span>{formatDateTimeRu(transaction.createdAt)}</span>
                <strong>{transaction.amount > 0 ? "+" : ""}{transaction.amount} ₽</strong>
                <span>{transaction.balanceKind === "bonus" ? "Бонусный" : "Основной"}</span>
                <span>{transaction.type === "trial_bonus" ? "Пробный баланс" : transaction.type}</span>
                <small>{transaction.reason}</small>
              </div>
            ))}
          </div>
        )}
      </section>
      <p className="privacy-note span-2">
        Доступно для заявок = основной баланс + бонусный баланс.
        После двойного подтверждения условий списывается сервисный сбор заказчика {balance?.clientServiceFeeAmount ?? 0} ₽
        и сервисный сбор помощника {balance?.performerServiceFeeAmount ?? 0} ₽. Если бонусы включены, сначала используется бонусный баланс.
      </p>
    </section>
  );
}

export function paymentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    created: "Создан",
    pending: "Ожидает оплаты",
    succeeded: "Успешно",
    failed: "Не прошёл",
    cancelled: "Отменён",
    expired: "Истёк срок",
    refunded: "Возврат",
    manual_review: "На проверке"
  };
  return labels[status] ?? status;
}

export function paymentProviderLabel(provider: string) {
  if (provider === "tbank") return "платёжная форма Т-Банка";
  if (provider === "mock") return "тестовая платёжная форма";
  return provider;
}
