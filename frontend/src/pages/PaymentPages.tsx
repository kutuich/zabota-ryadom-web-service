import { AlertCircle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api/client";
import { paymentProviderLabel, paymentStatusLabel } from "../components/BalancePanel";
import { useAuth } from "../context/AuthContext";
import type { PaymentTransaction } from "../types";
import { effectiveRoleForUser } from "../utils/authRole";

export function MockPaymentPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const orderId = searchParams.get("orderId") ?? "";
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const payment = useMemo(() => payments.find((item) => item.orderId === orderId), [orderId, payments]);

  useEffect(() => {
    api.getMyPayments()
      .then(setPayments)
      .catch((error) => setMessage(error instanceof Error ? error.message : "Не удалось загрузить платёж"))
      .finally(() => setIsLoading(false));
  }, []);

  async function succeed() {
    if (!payment) return;
    setIsSubmitting(true);
    try {
      await api.mockPaymentSucceed(payment.id);
      navigate("/app/balance/payment-success", { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось подтвердить платёж");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function fail() {
    if (!payment) return;
    setIsSubmitting(true);
    try {
      await api.mockPaymentFail(payment.id);
      navigate("/app/balance/payment-fail", { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось отменить платёж");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <PaymentShell title="Тестовая платёжная форма" icon={<CreditIcon />}>
      <p className="privacy-note">
        Это тестовый режим оплаты. Реальные банковские данные не вводятся и не обрабатываются.
      </p>
      {message && <p className="notice">{message}</p>}
      {isLoading ? (
        <p className="empty-text">Платёж загружается...</p>
      ) : !orderId ? (
        <p className="error-text">Не найден номер платежа.</p>
      ) : !payment ? (
        <p className="error-text">Платёж с таким Order ID не найден.</p>
      ) : (
        <>
          <div className="detail-grid detail-grid--compact">
            <span>Order ID</span><strong>{payment.orderId}</strong>
            <span>Сумма платежа</span><strong>{payment.amount} ₽</strong>
            <span>Статус</span><strong>{paymentStatusLabel(payment.status)}</strong>
            <span>Способ оплаты</span><strong>{paymentProviderLabel(payment.provider)}</strong>
          </div>
          <div className="trust-row">
            <button className="primary-button" type="button" onClick={succeed} disabled={isSubmitting || payment.status === "succeeded"}>
              <CheckCircle2 size={18} />
              Оплатить тестово
            </button>
            <button className="secondary-button" type="button" onClick={fail} disabled={isSubmitting || payment.status === "succeeded"}>
              <XCircle size={18} />
              Отменить платёж
            </button>
          </div>
        </>
      )}
      <Link className="secondary-button" to={balancePathForRole(effectiveRoleForUser(user))}>
        Вернуться к балансу
      </Link>
    </PaymentShell>
  );
}

export function PaymentSuccessPage() {
  const { user } = useAuth();
  return (
    <PaymentShell title="Платёж принят" icon={<CheckCircle2 size={28} />}>
      <p>
        Если платёж подтверждён, баланс будет обновлён автоматически. Обновите страницу баланса через несколько секунд.
      </p>
      <div className="trust-row">
        <Link className="primary-button" to={balancePathForRole(effectiveRoleForUser(user))}>Перейти к балансу</Link>
        <Link className="secondary-button" to={homePathForRole(effectiveRoleForUser(user))}>На главную</Link>
      </div>
    </PaymentShell>
  );
}

export function PaymentFailPage() {
  const { user } = useAuth();
  return (
    <PaymentShell title="Платёж не завершён" icon={<AlertCircle size={28} />}>
      <p>Попробуйте ещё раз или обратитесь к администратору через раздел связи с администратором.</p>
      <div className="trust-row">
        <Link className="primary-button" to={balancePathForRole(effectiveRoleForUser(user))}>Вернуться к балансу</Link>
        <Link className="secondary-button" to={supportPathForRole(effectiveRoleForUser(user))}>Связь с администратором</Link>
      </div>
    </PaymentShell>
  );
}

export function PaymentPendingPage() {
  const { user } = useAuth();
  return (
    <PaymentShell title="Платёж проверяется" icon={<Clock size={28} />}>
      <p>Мы ожидаем подтверждение платежа от платёжного провайдера.</p>
      <Link className="primary-button" to={balancePathForRole(effectiveRoleForUser(user))}>Перейти к балансу</Link>
    </PaymentShell>
  );
}

function PaymentShell({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <main className="public-page">
      <section className="plain-section public-page__inner">
        <div className="card__head">
          <div>
            <p className="eyebrow">Пополнение баланса</p>
            <h1>{title}</h1>
          </div>
          {icon}
        </div>
        {children}
      </section>
    </main>
  );
}

function CreditIcon() {
  return <CheckCircle2 size={28} />;
}

function balancePathForRole(role?: string) {
  if (role === "client") return "/app/client/balance";
  if (role === "performer") return "/app/performer/balance";
  if (role === "admin" || role === "superadmin") return "/app/admin/balances";
  return "/app";
}

function homePathForRole(role?: string) {
  if (role === "client") return "/app/client/requests";
  if (role === "performer") return "/app/performer/requests";
  if (role === "admin" || role === "superadmin") return "/app/admin";
  return "/app";
}

function supportPathForRole(role?: string) {
  if (role === "client") return "/app/client/support";
  if (role === "performer") return "/app/performer/support";
  if (role === "admin" || role === "superadmin") return "/app/admin/support";
  return "/app";
}
