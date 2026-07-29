import { RefreshCcw, Search, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import type { AdminPaymentDetails, AdminPaymentFilters, AdminPaymentListItem } from "../types";
import { formatDateTimeRu } from "../utils/dateTime";
import {
  adminPaymentDisplayStatus,
  adminPaymentProviderLabel,
  formatPaymentAge,
  paymentRefreshResultMessage
} from "../utils/paymentDisplay";

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
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [isSyncingTbank, setIsSyncingTbank] = useState(false);
  const [refundPayment, setRefundPayment] = useState<AdminPaymentDetails | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [isRefunding, setIsRefunding] = useState(false);
  const [manualBankRefundPayment, setManualBankRefundPayment] = useState<AdminPaymentDetails | null>(null);
  const [manualBankRefundDate, setManualBankRefundDate] = useState(todayDateKey());
  const [manualBankRefundReason, setManualBankRefundReason] = useState<"customer_request" | "test_refund" | "service_cancelled" | "duplicate_payment" | "other">("customer_request");
  const [manualBankReference, setManualBankReference] = useState("");
  const [manualBankComment, setManualBankComment] = useState("");
  const [isRecordingManualBankRefund, setIsRecordingManualBankRefund] = useState(false);

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

  async function refreshPaymentStatus(id: string) {
    setIsRefreshingStatus(true);
    setDetailsError("");
    try {
      const result = await api.refreshPaymentStatus(id);
      let message = paymentRefreshResultMessage(result.status);
      if (result.status === "refunded") {
        const syncResult = await api.syncAdminTbankPayment(id);
        message = syncResult.message;
      }
      await Promise.all([openPayment(id), loadPayments()]);
      setDetailsError(message);
    } catch {
      setDetailsError("Не удалось проверить статус платежа.");
    } finally {
      setIsRefreshingStatus(false);
    }
  }

  async function syncTbankStatus(id: string) {
    setIsSyncingTbank(true);
    setDetailsError("");
    try {
      const result = await api.syncAdminTbankPayment(id);
      await Promise.all([openPayment(id), loadPayments()]);
      setDetailsError(result.message);
    } catch (syncError) {
      setDetailsError(syncError instanceof Error ? syncError.message : "Не удалось сверить платёж с T-Bank.");
    } finally {
      setIsSyncingTbank(false);
    }
  }

  function resetFilters() {
    setFilters(emptyFilters);
    loadPayments(emptyFilters);
  }

  async function submitRefund() {
    if (!refundPayment || refundReason.trim().length < 3) return;
    setIsRefunding(true);
    setDetailsError("");
    try {
      await api.refundAdminPayment(refundPayment.payment.id, {
        amount: refundPayment.payment.amount,
        reason: refundReason.trim()
      });
      setRefundPayment(null);
      setRefundReason("");
      await Promise.all([openPayment(refundPayment.payment.id), loadPayments()]);
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : "Не удалось выполнить возврат.");
      setRefundPayment(null);
    } finally {
      setIsRefunding(false);
    }
  }

  async function submitManualBankRefund() {
    if (!manualBankRefundPayment || !manualBankRefundDate || manualBankComment.trim().length < 3) return;
    const paymentId = manualBankRefundPayment.payment.id;
    setIsRecordingManualBankRefund(true);
    setDetailsError("");
    try {
      await api.recordManualBankRefund(paymentId, {
        amount: manualBankRefundPayment.payment.amount,
        bankRefundDate: manualBankRefundDate,
        reason: manualBankRefundReason,
        comment: manualBankComment.trim(),
        bankReference: manualBankReference.trim() || undefined
      });
      setManualBankRefundPayment(null);
      await Promise.all([openPayment(paymentId), loadPayments()]);
    } catch (submitError) {
      setDetailsError(submitError instanceof Error ? submitError.message : "Не удалось зафиксировать возврат по банку.");
      setManualBankRefundPayment(null);
    } finally {
      setIsRecordingManualBankRefund(false);
    }
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
            {payments.map((payment) => {
              const displayStatus = adminPaymentDisplayStatus(payment);
              return <div className="data-row" key={payment.id}>
                <span>{formatDateTimeRu(payment.createdAt)}</span>
                <strong>{payment.user?.displayName ?? payment.userId}</strong>
                <span>{userRoleLabel(payment.user?.role ?? payment.userRole ?? "")}</span>
                <strong>{payment.amount} {payment.currency}</strong>
                <span>
                  {payment.provider === "tbank" && payment.terminalMode === "test"
                    ? <StatusBadge tone="warning">Тестовый T-Bank</StatusBadge>
                    : adminPaymentProviderLabel(payment.provider, payment.terminalMode)}
                </span>
                <StatusBadge tone={displayStatus.tone}>{displayStatus.label}</StatusBadge>
                <small className="payment-identifier-value">{payment.orderId}</small>
                <small className="payment-identifier-value">{payment.providerPaymentId ?? "не указан"}</small>
                <button className="secondary-button" type="button" onClick={() => openPayment(payment.id)}>
                  Открыть
                </button>
              </div>;
            })}
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
          {selectedPayment && (
            <PaymentDetails
              details={selectedPayment}
              isRefreshing={isRefreshingStatus}
              isSyncingTbank={isSyncingTbank}
              onRefresh={() => void refreshPaymentStatus(selectedPayment.payment.id)}
              onSyncTbank={() => void syncTbankStatus(selectedPayment.payment.id)}
              onRefund={() => {
                setRefundReason("");
                setRefundPayment(selectedPayment);
              }}
              onManualBankRefund={() => {
                setManualBankRefundDate(todayDateKey());
                setManualBankRefundReason("customer_request");
                setManualBankReference("");
                setManualBankComment("");
                setManualBankRefundPayment(selectedPayment);
              }}
            />
          )}
        </section>
      )}
      {refundPayment && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="refund-payment-title">
          <section className="modal-panel">
            <div className="card__head">
              <div>
                <h2 id="refund-payment-title">Вернуть платёж</h2>
                <p className="privacy-note">Вы возвращаете {refundPayment.payment.amount} ₽.</p>
              </div>
              <button className="secondary-button" type="button" onClick={() => setRefundPayment(null)} disabled={isRefunding}>
                Закрыть
              </button>
            </div>
            <label>
              Причина возврата
              <textarea
                value={refundReason}
                onChange={(event) => setRefundReason(event.target.value)}
                maxLength={500}
                rows={4}
                required
              />
            </label>
            <div className="trust-row">
              <button
                className="primary-button"
                type="button"
                onClick={() => void submitRefund()}
                disabled={isRefunding || refundReason.trim().length < 3}
              >
                <Undo2 size={18} />
                {isRefunding ? "Выполняем возврат" : "Подтвердить"}
              </button>
              <button className="secondary-button" type="button" onClick={() => setRefundPayment(null)} disabled={isRefunding}>
                Отмена
              </button>
            </div>
          </section>
        </div>
      )}
      {manualBankRefundPayment && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="manual-bank-refund-title">
          <section className="modal-panel">
            <div className="card__head">
              <div>
                <h2 id="manual-bank-refund-title">Зафиксировать возврат по банку</h2>
                <p className="privacy-note">Сумма полного возврата: {manualBankRefundPayment.payment.amount} ₽.</p>
              </div>
              <button className="secondary-button" type="button" onClick={() => setManualBankRefundPayment(null)} disabled={isRecordingManualBankRefund}>Закрыть</button>
            </div>
            <p className="notice notice--warning">Используйте, если возврат был выполнен в банке, но автоматическая сверка с T-Bank не обнаружила его. Подтвердите, что деньги уже фактически возвращены Заказчику через банк. После подтверждения операция будет списана с баланса пользователя и попадёт в реестр «Мой налог».</p>
            <div className="form-grid">
              <label>Сумма возврата<input type="number" value={manualBankRefundPayment.payment.amount} readOnly /></label>
              <label>Дата фактического возврата в банке<input type="date" value={manualBankRefundDate} onChange={(event) => setManualBankRefundDate(event.target.value)} required /></label>
              <label>Причина<select value={manualBankRefundReason} onChange={(event) => setManualBankRefundReason(event.target.value as typeof manualBankRefundReason)}>
                <option value="customer_request">По заявлению Заказчика</option>
                <option value="test_refund">Тестовый возврат реального платежа</option>
                <option value="service_cancelled">Услуга отменена</option>
                <option value="duplicate_payment">Дублирующий платёж</option>
                <option value="other">Другая причина</option>
              </select></label>
              <label>Номер операции / комментарий банка<input value={manualBankReference} onChange={(event) => setManualBankReference(event.target.value)} maxLength={300} /></label>
              <label className="span-full">Комментарий администратора<textarea value={manualBankComment} onChange={(event) => setManualBankComment(event.target.value)} maxLength={1000} rows={4} required /></label>
            </div>
            <div className="trust-row">
              <button className="primary-button" type="button" onClick={() => void submitManualBankRefund()} disabled={isRecordingManualBankRefund || !manualBankRefundDate || manualBankComment.trim().length < 3}>
                <Undo2 size={18} />{isRecordingManualBankRefund ? "Фиксируем возврат" : "Зафиксировать возврат"}
              </button>
              <button className="secondary-button" type="button" onClick={() => setManualBankRefundPayment(null)} disabled={isRecordingManualBankRefund}>Отмена</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function PaymentDetails({
  details,
  isRefreshing,
  isSyncingTbank,
  onRefresh,
  onSyncTbank,
  onRefund,
  onManualBankRefund
}: {
  details: AdminPaymentDetails;
  isRefreshing: boolean;
  isSyncingTbank: boolean;
  onRefresh: () => void;
  onSyncTbank: () => void;
  onRefund: () => void;
  onManualBankRefund: () => void;
}) {
  const payment = details.payment;
  const user = details.user ?? payment.user;
  const displayStatus = adminPaymentDisplayStatus(payment);
  return (
    <div className="list">
      <div className="detail-grid">
        <span>Внутренний ID</span><strong>{payment.id}</strong>
        <span>Order ID</span>
        <strong className="payment-identifier-value">
          {payment.orderId}
          <small className="payment-detail-hint">Внутренний номер заказа в сервисе. Формируется приложением и передаётся в T-Bank.</small>
        </strong>
        <span>Provider Payment ID</span>
        <strong className="payment-identifier-value">
          {payment.providerPaymentId ?? "не указан"}
          <small className="payment-detail-hint">Номер платежа в T-Bank. Формируется банком и используется для сверки, статуса и возврата.</small>
        </strong>
        <span>Пользователь</span><strong>{user?.displayName ?? payment.userId}</strong>
        <span>Роль пользователя</span><strong>{userRoleLabel(user?.role ?? "")}</strong>
        <span>Сумма</span><strong>{payment.amount} {payment.currency}</strong>
        <span>Валюта</span><strong>{payment.currency}</strong>
        <span>Провайдер</span><strong>{adminPaymentProviderLabel(payment.provider, payment.terminalMode)}</strong>
        <span>Режим терминала</span><strong>{payment.terminalMode ?? "не указан"}</strong>
        <span>Статус</span><strong><StatusBadge tone={displayStatus.tone}>{displayStatus.label}</StatusBadge></strong>
        <span>Статус T-Bank</span><strong>{payment.providerStatus ?? "не синхронизирован"}</strong>
        <span>Последняя сверка</span><strong>{payment.lastSyncedAt ? formatDateTimeRu(payment.lastSyncedAt) : "не выполнялась"}</strong>
        <span>Назначение</span><strong>{paymentPurposeLabel(payment.purpose)}</strong>
        <span>Дата создания</span><strong>{formatDateTimeRu(payment.createdAt)}</strong>
        <span>Возраст платежа</span><strong>{formatPaymentAge(payment.createdAt)}</strong>
        <span>Дата оплаты</span><strong>{payment.paidAt ? formatDateTimeRu(payment.paidAt) : "не оплачено"}</strong>
        <span>Дата зачисления</span><strong>{payment.creditedAt ? formatDateTimeRu(payment.creditedAt) : "не зачислено"}</strong>
        <span>Связанная операция баланса</span>
        <strong>
          {details.balanceTransaction
            ? `${details.balanceTransaction.amount} ₽ · ${balanceKindLabel(details.balanceTransaction.balanceKind)} · ${details.balanceTransaction.reason}`
            : "нет"}
        </strong>
        <span>ID операции баланса</span><strong>{payment.balanceTransactionId ?? "нет"}</strong>
      </div>
      {displayStatus.isStalePending && (
        <p className="notice notice--neutral">Пользователь открыл форму оплаты, но платёж не был завершён. Деньги не поступили, баланс не зачислен.</p>
      )}
      {payment.provider === "tbank" && ["pending", "waiting_payment", "manual_review"].includes(payment.status.toLowerCase()) && (
        <button className="secondary-button" type="button" onClick={onRefresh} disabled={isRefreshing}>
          <RefreshCcw size={18} />
          {isRefreshing ? "Проверяем" : "Обновить статус"}
        </button>
      )}
      {payment.provider === "tbank" && (
        <button className="secondary-button" type="button" onClick={onSyncTbank} disabled={isSyncingTbank}>
          <RefreshCcw size={18} />
          {isSyncingTbank ? "Сверяем" : "Сверить с T-Bank"}
        </button>
      )}
      {payment.provider === "tbank" && payment.status === "succeeded" && payment.creditedAt && !(details.refunds?.length) && (
        <div className="trust-row">
          <button className="secondary-button" type="button" onClick={onRefund}>
            <Undo2 size={18} />
            Вернуть через T-Bank
          </button>
          {payment.provider === "tbank" && payment.terminalMode === "live" && (
            <button className="secondary-button" type="button" onClick={onManualBankRefund}>
              <Undo2 size={18} />
              Зафиксировать возврат по банку
            </button>
          )}
        </div>
      )}
      {!!details.refunds?.length && (
        <section className="plain-section">
          <h3>Возврат</h3>
          {details.refunds.map((refund) => (
            <div className="detail-grid" key={refund.id}>
              <span>Сумма</span><strong>{refund.amount} {refund.currency}</strong>
              <span>Статус</span><strong>{refundStatusLabel(refund.status)}</strong>
              <span>Причина</span><strong>{refund.reason}</strong>
              {refund.refundType === "bank_refund_manual" && <><span>Источник</span><strong>Возврат по банку</strong></>}
              {refund.bankRefundDate && <><span>Дата возврата в банке</span><strong>{formatDateTimeRu(refund.bankRefundDate)}</strong></>}
              {refund.bankReference && <><span>Номер операции банка</span><strong>{refund.bankReference}</strong></>}
              {refund.adminComment && <><span>Комментарий администратора</span><strong>{refund.adminComment}</strong></>}
              <span>Выполнил</span><strong>{refund.createdByAdmin?.displayName ?? refund.createdByAdminId}</strong>
              <span>Дата</span><strong>{formatDateTimeRu(refund.createdAt)}</strong>
              <span>ID возврата провайдера</span><strong>{refund.providerRefundId ?? "не указан"}</strong>
            </div>
          ))}
        </section>
      )}
      <details className="details-box">
        <summary>Технические данные платежа</summary>
        <div className="list">
          <RawJsonBlock title="Raw init response" value={details.rawInitResponseJson} />
          <RawJsonBlock title="Raw GetState response" value={details.rawStateResponseJson} />
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

function userRoleLabel(role: string) {
  if (role === "client") return "Заказчик";
  if (role === "performer") return "Помощник";
  if (role === "manager") return "Менеджер";
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

function refundStatusLabel(status: string) {
  const labels: Record<string, string> = {
    processing: "В обработке",
    provider_succeeded: "Подтверждён провайдером",
    succeeded: "Возвращён",
    failed: "Не выполнен",
    manual_review: "Требует проверки"
  };
  return labels[status] ?? status;
}

function todayDateKey() {
  const today = new Date();
  const offset = today.getTimezoneOffset() * 60_000;
  return new Date(today.getTime() - offset).toISOString().slice(0, 10);
}
