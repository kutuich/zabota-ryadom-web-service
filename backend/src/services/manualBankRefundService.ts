import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { HttpError } from "../utils/http";
import { writeAudit } from "./auditService";
import { ensureRefundNpdEntryTx } from "./npdTaxRegisterService";

export const manualBankRefundIdempotencyKey = (refundId: string) => `manual_bank_refund:${refundId}`;

export type ManualBankRefundReason =
  | "customer_request"
  | "test_refund"
  | "service_cancelled"
  | "duplicate_payment"
  | "other";

type ManualBankRefundInput = {
  paymentId: string;
  amount: number;
  bankRefundDate: Date;
  reason: ManualBankRefundReason;
  comment: string;
  bankReference?: string | null;
  adminUserId: string;
};

const BALANCE_REASON = "Возврат по банку: возврат сервисного платежа за использование сервиса «Забота Рядом»";
const INSUFFICIENT_BALANCE_MESSAGE =
  "Недостаточно основного баланса для фиксации возврата по банку. Сначала проверьте историю списаний или выполните ручную корректировку с понятным основанием.";

export async function createManualBankRefund(input: ManualBankRefundInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const payment = await tx.paymentTransaction.findUnique({
        where: { id: input.paymentId },
        include: {
          refunds: { select: { id: true } },
          user: { select: { id: true, balance: true } }
        }
      });
      if (!payment) throw new HttpError(404, "Платёж не найден", "payment_not_found");
      if (payment.provider !== "tbank") {
        throw new HttpError(409, "Возврат по банку доступен только для реального платежа T-Bank", "manual_bank_refund_real_payment_required");
      }
      if (payment.terminalMode !== "live") {
        throw new HttpError(409, "Возврат по банку доступен только для live-платежа T-Bank", "manual_bank_refund_live_payment_required");
      }
      if (payment.refunds.length > 0) {
        throw new HttpError(409, "Возврат по этому платежу уже зафиксирован", "manual_bank_refund_already_exists");
      }
      if (payment.status !== "succeeded" || !payment.creditedAt || !payment.balanceTransactionId) {
        throw new HttpError(409, "Зафиксировать можно только возврат успешно зачисленного платежа", "payment_not_refundable");
      }
      if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > payment.amount) {
        throw new HttpError(400, "Сумма возврата превышает сумму платежа", "manual_bank_refund_amount_invalid");
      }
      if (input.amount !== payment.amount) {
        throw new HttpError(400, "Сейчас доступен только полный возврат платежа", "partial_refund_not_supported");
      }

      const refund = await tx.refundTransaction.create({
        data: {
          paymentTransactionId: payment.id,
          userId: payment.userId,
          provider: "manual_bank",
          refundType: "bank_refund_manual",
          externalRequestId: randomUUID(),
          amount: input.amount,
          currency: payment.currency,
          status: "succeeded",
          reason: input.reason,
          bankRefundDate: input.bankRefundDate,
          bankReference: input.bankReference?.trim() || null,
          adminComment: input.comment.trim(),
          createdByAdminId: input.adminUserId,
          completedAt: new Date()
        }
      });

      const debited = await tx.user.updateMany({
        where: { id: payment.userId, balance: { gte: input.amount } },
        data: { balance: { decrement: input.amount } }
      });
      if (debited.count !== 1) {
        throw new HttpError(409, INSUFFICIENT_BALANCE_MESSAGE, "manual_bank_refund_balance_insufficient");
      }

      const balanceTransaction = await tx.balanceTransaction.create({
        data: {
          userId: payment.userId,
          type: "bank_refund",
          source: "manual_bank",
          idempotencyKey: manualBankRefundIdempotencyKey(refund.id),
          amount: -input.amount,
          balanceKind: "real",
          reason: BALANCE_REASON,
          comment: input.comment.trim(),
          metadataJson: JSON.stringify({
            paymentTransactionId: payment.id,
            refundTransactionId: refund.id,
            source: "manual_bank",
            bankRefundDate: input.bankRefundDate.toISOString(),
            bankReference: input.bankReference?.trim() || null,
            reason: input.reason,
            comment: input.comment.trim(),
            actorUserId: input.adminUserId
          }),
          balanceBefore: payment.user.balance,
          balanceAfter: payment.user.balance - input.amount,
          createdByAdminId: input.adminUserId
        }
      });

      const completedRefund = await tx.refundTransaction.update({
        where: { id: refund.id },
        data: { balanceTransactionId: balanceTransaction.id }
      });
      await tx.paymentTransaction.update({
        where: { id: payment.id },
        data: { status: "refunded" }
      });
      await ensureRefundNpdEntryTx(tx, completedRefund, payment, balanceTransaction.id);
      await writeAudit(input.adminUserId, "admin.bank_refund.create", "payment", payment.id, {
        actorUserId: input.adminUserId,
        targetUserId: payment.userId,
        paymentTransactionId: payment.id,
        refundTransactionId: completedRefund.id,
        amount: input.amount,
        bankRefundDate: input.bankRefundDate.toISOString(),
        bankReference: input.bankReference?.trim() || null,
        reason: input.reason,
        comment: input.comment.trim(),
        source: "admin_panel"
      }, tx);

      return tx.refundTransaction.findUniqueOrThrow({
        where: { id: completedRefund.id },
        include: { createdByAdmin: { select: { id: true, displayName: true } } }
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "Возврат по этому платежу уже зафиксирован", "manual_bank_refund_already_exists");
    }
    throw error;
  }
}
