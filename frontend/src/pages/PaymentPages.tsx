import { AlertCircle, CheckCircle2, Clock, RefreshCcw, XCircle } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api/client";
import { paymentProviderLabel, paymentStatusLabel } from "../components/BalancePanel";
import { useAuth } from "../context/AuthContext";
import type { PaymentTransaction } from "../types";
import { effectiveRoleForUser } from "../utils/authRole";
import { mockPaymentUiEnabled } from "../utils/runtimeFlags";

export function MockPaymentPage() {
  const { user } = useAuth();
  if (!mockPaymentUiEnabled) {
    return (
      <PaymentShell title="Пополнение временно недоступно" icon={<AlertCircle size={28} />}>
        <p>Пополнение через банк пока не включено.</p>
        <p className="privacy-note">Пополнение баланса выполняется через защищённую платёжную форму банка. Сервис не хранит данные банковских карт.</p>
        <Link className="primary-button" to={balancePathForRole(effectiveRoleForUser(user))}>Вернуться к балансу</Link>
      </PaymentShell>
    );
  }
  return <LocalMockPaymentPage />;
}

function LocalMockPaymentPage() {
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
      navigate(`/app/balance/payment-success?paymentId=${encodeURIComponent(payment.id)}&orderId=${encodeURIComponent(payment.orderId)}`, { replace: true });
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
      navigate(`/app/balance/payment-fail?paymentId=${encodeURIComponent(payment.id)}&orderId=${encodeURIComponent(payment.orderId)}`, { replace: true });
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
      <PaymentStatusRefresh />
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
      <p>Платёж не завершён. Деньги не зачислены на баланс. Попробуйте ещё раз или обратитесь к администратору.</p>
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
      <p>Платёж проверяется. Мы ожидаем подтверждение от платёжного провайдера.</p>
      <PaymentStatusRefresh />
      <Link className="primary-button" to={balancePathForRole(effectiveRoleForUser(user))}>Перейти к балансу</Link>
    </PaymentShell>
  );
}

function PaymentStatusRefresh() {
  const [searchParams] = useSearchParams();
  const [paymentId, setPaymentId] = useState(searchParams.get("paymentId") ?? "");
  const [message, setMessage] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function resolvePaymentId() {
    if (paymentId) return paymentId;
    const orderId = searchParams.get("orderId");
    const payments = await api.getMyPayments();
    const matched = orderId
      ? payments.find((payment) => payment.orderId === orderId)
      : payments.find((payment) => payment.provider === "tbank" && ["created", "pending"].includes(payment.status));
    if (matched) setPaymentId(matched.id);
    return matched?.id ?? "";
  }

  async function refresh() {
    setIsRefreshing(true);
    try {
      const resolvedPaymentId = await resolvePaymentId();
      if (!resolvedPaymentId) {
        setMessage("Платёж не найден.");
        return;
      }
      const result = await api.refreshPaymentStatus(resolvedPaymentId);
      setMessage(result.message);
    } catch {
      setMessage("Не удалось проверить статус платежа. Попробуйте позже или обратитесь к администратору.");
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="list">
      {message && <p className="notice">{message}</p>}
      <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={isRefreshing}>
        <RefreshCcw size={18} />
        {isRefreshing ? "Проверяем" : "Проверить статус платежа"}
      </button>
    </div>
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
  if (role === "manager") return "/app/manager/balances";
  if (role === "admin" || role === "superadmin") return "/app/admin/balances";
  return "/app";
}

function homePathForRole(role?: string) {
  if (role === "client") return "/app/client/requests";
  if (role === "performer") return "/app/performer/requests";
  if (role === "manager") return "/app/manager";
  if (role === "admin" || role === "superadmin") return "/app/admin";
  return "/app";
}

function supportPathForRole(role?: string) {
  if (role === "client") return "/app/client/support";
  if (role === "performer") return "/app/performer/support";
  if (role === "manager") return "/app/manager/support";
  if (role === "admin" || role === "superadmin") return "/app/admin/support";
  return "/app";
}
