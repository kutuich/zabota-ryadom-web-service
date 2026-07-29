import type { PaymentTransaction } from "../types";

export const PENDING_PAYMENT_ACTIVE_WINDOW_MS = 30 * 60 * 1000;

type PaymentDisplayInput = Pick<PaymentTransaction, "status" | "createdAt">;

export type PaymentDisplayStatus = {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
  isStalePending: boolean;
};

export function adminPaymentDisplayStatus(payment: PaymentDisplayInput, now = new Date()): PaymentDisplayStatus {
  const normalizedStatus = payment.status.trim().toLowerCase();
  if (isPendingPaymentStatus(normalizedStatus) && isPaymentOlderThanActiveWindow(payment.createdAt, now)) {
    return { label: "Не завершён", tone: "neutral", isStalePending: true };
  }

  const labels: Record<string, string> = {
    created: "Создан",
    pending: "Ожидает оплаты",
    waiting_payment: "Ожидает оплаты",
    succeeded: "Успешно",
    failed: "Не прошёл",
    cancelled: "Отменён",
    expired: "Истёк срок",
    refunded: "Возврат",
    manual_review: "На проверке"
  };

  return {
    label: labels[normalizedStatus] ?? payment.status,
    tone: paymentStatusTone(normalizedStatus),
    isStalePending: false
  };
}

export function formatPaymentAge(createdAt: string, now = new Date()) {
  const createdAtMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) return "неизвестен";

  const ageMinutes = Math.max(0, Math.floor((now.getTime() - createdAtMs) / 60_000));
  if (ageMinutes < 1) return "менее минуты";
  if (ageMinutes < 60) return `${ageMinutes} мин`;

  const ageHours = Math.floor(ageMinutes / 60);
  const remainingMinutes = ageMinutes % 60;
  if (ageHours < 24) return remainingMinutes ? `${ageHours} ч ${remainingMinutes} мин` : `${ageHours} ч`;

  const ageDays = Math.floor(ageHours / 24);
  const remainingHours = ageHours % 24;
  return remainingHours ? `${ageDays} дн ${remainingHours} ч` : `${ageDays} дн`;
}

export function paymentRefreshResultMessage(status: string) {
  const normalizedStatus = status.trim().toLowerCase();
  if (normalizedStatus === "succeeded") return "Статус обновлён. Платёж успешно оплачен.";
  if (["failed", "cancelled", "expired"].includes(normalizedStatus)) return "Статус обновлён. Платёж не прошёл.";
  if (normalizedStatus === "refunded") return "Обнаружен возврат в T-Bank.";
  if (normalizedStatus === "manual_review") return "Статус обновлён. Платёж требует ручной проверки.";
  return "Статус обновлён. Оплата не завершена.";
}

export function adminPaymentProviderLabel(provider: string, terminalMode?: string | null) {
  if (provider === "mock") return "Тестовая форма";
  if (provider === "tbank" && terminalMode === "test") return "Тестовый T-Bank";
  if (provider === "tbank") return "Т-Банк";
  return provider;
}

function isPendingPaymentStatus(status: string) {
  return status === "pending" || status === "waiting_payment";
}

function isPaymentOlderThanActiveWindow(createdAt: string, now: Date) {
  const createdAtMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) return false;
  return now.getTime() - createdAtMs >= PENDING_PAYMENT_ACTIVE_WINDOW_MS;
}

function paymentStatusTone(status: string): PaymentDisplayStatus["tone"] {
  if (status === "succeeded") return "success";
  if (["failed", "cancelled", "expired"].includes(status)) return "danger";
  if (["pending", "waiting_payment", "created", "manual_review"].includes(status)) return "warning";
  return "neutral";
}
