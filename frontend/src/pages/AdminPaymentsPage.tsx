import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import type { AdminPaymentDetails, AdminPaymentFilters, AdminPaymentListItem } from "../types";
import { formatDateTimeRu } from "../utils/dateTime";

const emptyFilters: AdminPaymentFilters = {
  status: "",
  provider: "",
  userId: "",
  dateFrom: "",
  dateTo: ""
};

export function AdminPaymentsPage() {
  const [filters, setFilters] = useState<AdminPaymentFilters>(emptyFilters);
  const [payments, setPayments] = useState<AdminPaymentListItem[]>([]);
  const [selectedPayment, setSelectedPayment] = useState<AdminPaymentDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailsError, setDetailsError] = useState("");

  async function loadPayments(nextFilters = filters) {
    setIsLoading(true);
    setError("");
    try {
      setPayments(await api.getAdminPayments(nextFilters));
    } catch {
      setError("Не удалось загрузить платежи.");
      setPayments([]);
    } finally {
      setIsLoading(false);
    }
  }

  async function openPayment(id: string) {
    setIsDetailsLoading(true);
    setDetailsError("");
    try {
      setSelectedPayment(await api.getAdminPayment(id));
    } catch {
      setDetailsError("Не удалось загрузить платёж.");
    } finally {
      setIsDetailsLoading(false);
    }
  }

  function resetFilters() {
    setFilters(emptyFilters);
    loadPayments(emptyFilters);
  }

  useEffect(() => {
    loadPayments(emptyFilters);
  }, []);

  return (
    <div className="list">
      <section className="plain-section">
        <div className="card__head">
          <div>
            <h2>Платежи</h2>
            <p className="privacy-note">Пополнения баланса и статусы платёжных операций.</p>
          </div>
        </div>
        <div className="filter-panel__body">
          <label>
            Статус
            <select value={filters.status ?? ""} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="">Все статусы</option>
              <option value="created">Создан</option>
              <option value="pending">Ожидает оплаты</option>
              <option value="succeeded">Успешно</option>
              <option value="failed">Не прошёл</option>
              <option value="cancelled">Отменён</option>
              <option value="expired">Истёк срок</option>
              <option value="refunded">Возврат</option>
              <option value="manual_review">На проверке</option>
            </select>
          </label>
          <label>
            Провайдер
            <select value={filters.provider ?? ""} onChange={(event) => setFilters({ ...filters, provider: event.target.value })}>
              <option value="">Все провайдеры</option>
              <option value="mock">Тестовая форма</option>
              <option value="tbank">Т-Банк</option>
            </select>
          </label>
          <label>
            Пользователь / userId
            <input
              value={filters.userId ?? ""}
              onChange={(event) => setFilters({ ...filters, userId: event.target.value })}
              placeholder="ID пользователя"
            />
          </label>
          <label>
            Дата с
            <input type="date" value={filters.dateFrom ?? ""} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} />
          </label>
          <label>
            Дата по
            <input type="date" value={filters.dateTo ?? ""} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} />
          </label>
          <div className="trust-row">
            <button className="primary-button" type="button" onClick={() => loadPayments()}>
              <Search size={18} />
              Применить
            </button>
            <button className="secondary-button" type="button" onClick={resetFilters}>
              Сбросить
            </button>
          </div>
        </div>
      </section>

      <section className="plain-section">
        {error && <p className="notice">{error}</p>}
        {isLoading ? (
          <p className="empty-text">Платежи загружаются...</p>
        ) : payments.length === 0 ? (
          <EmptyState title="Платежей пока нет." />
        ) : (
          <div className="data-table data-table--wide">
            <div className="data-row data-row--header">
              <span>Дата</span>
              <span>Пользователь</span>
              <span>Роль</span>
              <span>Сумма</span>
              <span>Провайдер</span>
              <span>Статус</span>
              <span>Order ID</span>
              <span>Provider Payment ID</span>
              <span>Действия</span>
            </div>
            {payments.map((payment) => (
              <div className="data-row" key={payment.id}>
                <span>{formatDateTimeRu(payment.createdAt)}</span>
                <strong>{payment.user?.displayName ?? payment.userId}</strong>
                <span>{userRoleLabel(payment.user?.role ?? payment.userRole ?? "")}</span>
                <strong>{payment.amount} {payment.currency}</strong>
                <span>{paymentProviderLabel(payment.provider)}</span>
                <StatusBadge tone={paymentStatusTone(payment.status)}>{paymentStatusLabel(payment.status)}</StatusBadge>
                <small>{payment.orderId}</small>
                <small>{payment.providerPaymentId ?? "не указан"}</small>
                <button className="secondary-button" type="button" onClick={() => openPayment(payment.id)}>
                  Открыть
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {(selectedPayment || isDetailsLoading || detailsError) && (
        <section className="plain-section">
          <div className="card__head">
            <h2>Карточка платежа</h2>
            <button className="secondary-button" type="button" onClick={() => {
              setSelectedPayment(null);
              setDetailsError("");
            }}>
              Закрыть
            </button>
          </div>
          {detailsError && <p className="notice">{detailsError}</p>}
          {isDetailsLoading && <p className="empty-text">Платёж загружается...</p>}
          {selectedPayment && <PaymentDetails details={selectedPayment} />}
        </section>
      )}
    </div>
  );
}

function PaymentDetails({ details }: { details: AdminPaymentDetails }) {
  const payment = details.payment;
  const user = details.user ?? payment.user;
  return (
    <div className="list">
      <div className="detail-grid">
        <span>Внутренний ID</span><strong>{payment.id}</strong>
        <span>Order ID</span><strong>{payment.orderId}</strong>
        <span>Provider Payment ID</span><strong>{payment.providerPaymentId ?? "не указан"}</strong>
        <span>Пользователь</span><strong>{user?.displayName ?? payment.userId}</strong>
        <span>Роль пользователя</span><strong>{userRoleLabel(user?.role ?? "")}</strong>
        <span>Сумма</span><strong>{payment.amount} {payment.currency}</strong>
        <span>Валюта</span><strong>{payment.currency}</strong>
        <span>Провайдер</span><strong>{paymentProviderLabel(payment.provider)}</strong>
        <span>Статус</span><strong>{paymentStatusLabel(payment.status)}</strong>
        <span>Назначение</span><strong>{paymentPurposeLabel(payment.purpose)}</strong>
        <span>Дата создания</span><strong>{formatDateTimeRu(payment.createdAt)}</strong>
        <span>Дата оплаты</span><strong>{payment.paidAt ? formatDateTimeRu(payment.paidAt) : "не оплачено"}</strong>
        <span>Дата зачисления</span><strong>{payment.creditedAt ? formatDateTimeRu(payment.creditedAt) : "не зачислено"}</strong>
        <span>Связанная операция баланса</span>
        <strong>
          {details.balanceTransaction
            ? `${details.balanceTransaction.amount} ₽ · ${balanceKindLabel(details.balanceTransaction.balanceKind)} · ${details.balanceTransaction.reason}`
            : "нет"}
        </strong>
      </div>
      <details className="details-box">
        <summary>Технические данные платежа</summary>
        <div className="list">
          <RawJsonBlock title="Raw init response" value={details.rawInitResponseJson} />
          <RawJsonBlock title="Raw webhook" value={details.rawWebhookJson} />
        </div>
      </details>
    </div>
  );
}

function RawJsonBlock({ title, value }: { title: string; value?: string | null }) {
  return (
    <article className="card">
      <h3>{title}</h3>
      {value ? <pre>{prettyJson(value)}</pre> : <p className="empty-text">Данных пока нет.</p>}
    </article>
  );
}

function prettyJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function paymentStatusLabel(status: string) {
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

function paymentStatusTone(status: string) {
  if (status === "succeeded") return "success";
  if (["failed", "cancelled", "expired"].includes(status)) return "danger";
  if (["pending", "created", "manual_review"].includes(status)) return "warning";
  return "neutral";
}

function paymentProviderLabel(provider: string) {
  if (provider === "mock") return "Тестовая форма";
  if (provider === "tbank") return "Т-Банк";
  return provider;
}

function userRoleLabel(role: string) {
  if (role === "client") return "Заказчик";
  if (role === "performer") return "Помощник";
  if (role === "superadmin") return "Владелец";
  if (role === "admin") return "Администратор";
  return "не указана";
}

function paymentPurposeLabel(purpose: string) {
  if (purpose === "balance_top_up") return "Пополнение баланса";
  return purpose;
}

function balanceKindLabel(kind: string) {
  if (kind === "bonus") return "Бонусный баланс";
  return "Основной баланс";
}
