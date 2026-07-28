import type { PaymentTransaction, Prisma, RefundTransaction } from "@prisma/client";
import { prisma } from "../db/prisma";
import { HttpError } from "../utils/http";
import { writeAudit } from "./auditService";

type Tx = Prisma.TransactionClient;

export const NPD_PAYMENT_COPY_TEXT = "Сервисный платёж за использование сервиса «Забота Рядом»";
export const NPD_REFUND_COPY_TEXT = "Возврат сервисного платежа за использование сервиса «Забота Рядом»";

const PAYMENT_DESCRIPTION = "Пополнение внутреннего баланса сервиса «Забота Рядом» для оплаты сервисных возможностей приложения.";
const REFUND_DESCRIPTION = "Возврат ранее оплаченного сервисного платежа за использование сервиса «Забота Рядом» по заявлению Заказчика.";

export async function ensurePaymentNpdEntryTx(
  tx: Tx,
  payment: PaymentTransaction,
  balanceTransactionId: string | null
) {
  if (!isLiveTbankPayment(payment)) return null;
  return tx.npdTaxRegisterEntry.upsert({
    where: { paymentTransactionId: payment.id },
    create: {
      operationType: "payment",
      paymentTransactionId: payment.id,
      balanceTransactionId,
      userId: payment.userId,
      amount: payment.amount,
      operationDate: payment.paidAt ?? payment.creditedAt ?? new Date(),
      title: "Оплата через T-Bank",
      description: PAYMENT_DESCRIPTION,
      copyText: NPD_PAYMENT_COPY_TEXT,
      refundCopyText: NPD_REFUND_COPY_TEXT,
      source: "tbank",
      isTestOperation: false,
      npdStatus: "pending"
    },
    update: {
      balanceTransactionId: balanceTransactionId ?? undefined
    }
  });
}

export async function ensureRefundNpdEntryTx(
  tx: Tx,
  refund: RefundTransaction,
  payment: PaymentTransaction,
  balanceTransactionId: string | null
) {
  if (!isRealRefundProvider(refund.provider) || !isLiveTbankPayment(payment)) return null;
  const isManualBankRefund = refund.provider === "manual_bank";
  return tx.npdTaxRegisterEntry.upsert({
    where: { refundTransactionId: refund.id },
    create: {
      operationType: "refund",
      paymentTransactionId: null,
      refundTransactionId: refund.id,
      balanceTransactionId,
      userId: payment.userId,
      amount: -refund.amount,
      operationDate: refund.completedAt ?? new Date(),
      title: isManualBankRefund ? "Возврат по банку" : "Возврат через T-Bank",
      description: REFUND_DESCRIPTION,
      copyText: NPD_REFUND_COPY_TEXT,
      source: isManualBankRefund ? "manual_bank" : "tbank",
      isTestOperation: false,
      npdStatus: "needs_review",
      npdComment: isManualBankRefund
        ? "Возврат выполнен вне приложения и зафиксирован администратором. Проверьте аннулирование или корректировку чека в «Мой налог»."
        : "Проверьте аннулирование или корректировку чека в «Мой налог»."
    },
    update: {
      balanceTransactionId: balanceTransactionId ?? undefined
    }
  });
}

export async function listNpdRegister(from?: string, to?: string) {
  await backfillExistingNpdEntries();
  const range = parseDateRange(from, to);
  const entries = await prisma.npdTaxRegisterEntry.findMany({
    where: {
      operationDate: { gte: range.from, lt: range.toExclusive },
      isTestOperation: false,
      source: { in: ["tbank", "manual_bank"] },
      operationType: { in: ["payment", "refund"] },
      OR: [
        {
          operationType: "payment",
          paymentTransaction: { is: { provider: "tbank", terminalMode: "live" } }
        },
        {
          operationType: "refund",
          refundTransaction: {
            is: { payment: { provider: "tbank", terminalMode: "live" } }
          }
        }
      ]
    },
    include: {
      user: { select: { id: true, displayName: true, role: true, phone: true, email: true } },
      npdRecordedByAdmin: { select: { id: true, displayName: true } },
      paymentTransaction: {
        select: {
          id: true,
          orderId: true,
          providerPaymentId: true,
          provider: true,
          status: true,
          amount: true,
          refunds: { select: { id: true, providerRefundId: true, status: true, amount: true } }
        }
      },
      refundTransaction: {
        select: {
          id: true,
          providerRefundId: true,
          status: true,
          amount: true,
          reason: true,
          refundType: true,
          bankRefundDate: true,
          bankReference: true,
          adminComment: true,
          payment: { select: { id: true, orderId: true, providerPaymentId: true, amount: true } }
        }
      },
      balanceTransaction: { select: { id: true, type: true, amount: true } }
    },
    orderBy: [{ operationDate: "desc" }, { createdAt: "desc" }]
  });

  const dayMap = new Map<string, typeof entries>();
  for (const entry of entries) {
    const day = serviceDayKey(entry.operationDate);
    dayMap.set(day, [...(dayMap.get(day) ?? []), entry]);
  }
  const days = Array.from(dayMap.entries()).map(([date, rows]) => ({
    date,
    totals: calculateTotals(rows),
    entries: rows
  }));

  return {
    from: range.fromKey,
    to: range.toKey,
    totals: calculateTotals(entries),
    days
  };
}

async function backfillExistingNpdEntries() {
  await prisma.$transaction(async (tx) => {
    const [payments, refunds] = await Promise.all([
      tx.paymentTransaction.findMany({
        where: {
          status: { in: ["succeeded", "refunded"] },
          provider: "tbank",
          terminalMode: "live",
          creditedAt: { not: null },
          balanceTransactionId: { not: null }
        }
      }),
      tx.refundTransaction.findMany({
        where: {
          status: "succeeded",
          provider: { in: ["tbank", "manual_bank"] },
          balanceTransactionId: { not: null },
          payment: { provider: "tbank", terminalMode: "live" }
        },
        include: { payment: true }
      })
    ]);
    for (const payment of payments) {
      await ensurePaymentNpdEntryTx(tx, payment, payment.balanceTransactionId);
    }
    for (const refund of refunds) {
      await ensureRefundNpdEntryTx(tx, refund, refund.payment, refund.balanceTransactionId);
    }
  });
}

export async function updateNpdRegisterEntry(input: {
  entryId: string;
  actorUserId: string;
  npdStatus?: "pending" | "recorded" | "not_required" | "needs_review";
  npdComment?: string | null;
}) {
  if (input.npdStatus === undefined && input.npdComment === undefined) {
    throw new HttpError(400, "Укажите статус или комментарий", "npd_register_update_empty");
  }
  if (input.npdComment && input.npdComment.length > 1000) {
    throw new HttpError(400, "Комментарий слишком длинный", "npd_comment_too_long");
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.npdTaxRegisterEntry.findUnique({ where: { id: input.entryId } });
    if (!current) throw new HttpError(404, "Операция реестра не найдена", "npd_register_entry_not_found");
    const nextStatus = input.npdStatus ?? current.npdStatus;
    const updated = await tx.npdTaxRegisterEntry.update({
      where: { id: current.id },
      data: {
        npdStatus: nextStatus,
        npdComment: input.npdComment === undefined ? undefined : input.npdComment?.trim() || null,
        npdRecordedAt: nextStatus === "recorded" ? current.npdRecordedAt ?? new Date() : null,
        npdRecordedByAdminId: nextStatus === "recorded" ? input.actorUserId : null
      },
      include: {
        user: { select: { id: true, displayName: true, role: true, phone: true, email: true } },
        npdRecordedByAdmin: { select: { id: true, displayName: true } },
        paymentTransaction: { select: { id: true, orderId: true, providerPaymentId: true, provider: true, status: true } },
        refundTransaction: { select: { id: true, providerRefundId: true, status: true, paymentTransactionId: true } }
      }
    });
    await writeAudit(input.actorUserId, "admin.npd_register.update", "npd_tax_register_entry", current.id, {
      entryId: current.id,
      operationType: current.operationType,
      previousStatus: current.npdStatus,
      newStatus: nextStatus,
      comment: updated.npdComment,
      actorUserId: input.actorUserId,
      source: "admin_panel"
    }, tx);
    return updated;
  });
}

function isRealRefundProvider(provider: string) {
  return provider === "tbank" || provider === "manual_bank";
}

function isLiveTbankPayment(payment: Pick<PaymentTransaction, "provider" | "terminalMode">) {
  return payment.provider === "tbank" && payment.terminalMode === "live";
}

function calculateTotals(entries: Array<{ operationType: string; amount: number; npdStatus: string }>) {
  const payments = entries.filter((entry) => entry.operationType === "payment");
  const refunds = entries.filter((entry) => entry.operationType === "refund");
  return {
    paymentsCount: payments.length,
    paymentsAmount: payments.reduce((sum, entry) => sum + Math.max(0, entry.amount), 0),
    refundsCount: refunds.length,
    refundsAmount: refunds.reduce((sum, entry) => sum + Math.abs(Math.min(0, entry.amount)), 0),
    netAmount: entries.reduce((sum, entry) => sum + entry.amount, 0),
    pendingCount: entries.filter((entry) => entry.npdStatus === "pending").length,
    recordedCount: entries.filter((entry) => entry.npdStatus === "recorded").length,
    needsReviewCount: entries.filter((entry) => entry.npdStatus === "needs_review").length,
    notRequiredCount: entries.filter((entry) => entry.npdStatus === "not_required").length
  };
}

function parseDateRange(from?: string, to?: string) {
  const today = serviceDayKey(new Date());
  const defaultFrom = shiftDay(today, -6);
  const fromKey = validateDateKey(from) ?? defaultFrom;
  const toKey = validateDateKey(to) ?? today;
  if (fromKey > toKey) throw new HttpError(400, "Дата начала позже даты окончания", "npd_date_range_invalid");
  return {
    fromKey,
    toKey,
    from: new Date(`${fromKey}T00:00:00+05:00`),
    toExclusive: new Date(`${shiftDay(toKey, 1)}T00:00:00+05:00`)
  };
}

function validateDateKey(value?: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    throw new HttpError(400, "Некорректная дата", "npd_date_invalid");
  }
  return value;
}

function serviceDayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function shiftDay(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
