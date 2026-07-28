import { Prisma, type RefundTransaction } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma";
import { HttpError } from "../utils/http";
import { writeAudit } from "./auditService";
import { getPaymentAdapter, PaymentRefundError } from "./paymentAdapter";
import { ensureRefundNpdEntryTx } from "./npdTaxRegisterService";

export const paymentRefundIdempotencyKey = (refundId: string) => `payment_refund:${refundId}`;

type RefundInput = {
  paymentId: string;
  amount?: number;
  reason: string;
  adminUserId: string;
};

export async function refundPayment(input: RefundInput) {
  let prepared = await prepareRefund(input);
  if (prepared.status === "succeeded") {
    await prisma.$transaction(async (tx) => {
      const completed = await tx.refundTransaction.findUniqueOrThrow({
        where: { id: prepared.id },
        include: { payment: true }
      });
      await ensureRefundNpdEntryTx(tx, completed, completed.payment, completed.balanceTransactionId);
    });
    return refundResult(prepared, true);
  }
  if (prepared.status === "provider_succeeded") {
    return finalizeRefund(prepared.id);
  }
  if (prepared.status === "failed") {
    prepared = await prisma.refundTransaction.update({
      where: { id: prepared.id },
      data: { status: "processing", failedAt: null }
    });
  }
  if (prepared.status !== "processing") {
    throw new HttpError(409, "Возврат по этому платежу уже обработан", "payment_refund_already_processed");
  }

  const payment = await prisma.paymentTransaction.findUniqueOrThrow({
    where: { id: prepared.paymentTransactionId }
  });
  if (!payment.providerPaymentId) {
    await markRefundFailed(prepared.id, "provider_payment_id_missing", null, null, false);
    throw new HttpError(409, "У платежа нет идентификатора провайдера", "provider_payment_id_missing");
  }

  try {
    const providerResult = await getPaymentAdapter(payment.provider).refundPayment({
      providerPaymentId: payment.providerPaymentId,
      orderId: payment.orderId,
      amount: prepared.amount,
      externalRequestId: prepared.externalRequestId
    });
    await prisma.refundTransaction.update({
      where: { id: prepared.id },
      data: {
        status: "provider_succeeded",
        providerRefundId: providerResult.providerRefundId,
        rawRequestJson: providerResult.rawRequestJson,
        rawResponseJson: providerResult.rawResponseJson
      }
    });
  } catch (error) {
    const providerError = error instanceof PaymentRefundError ? error : null;
    await markRefundFailed(
      prepared.id,
      providerError?.reasonCode ?? "provider_refund_failed",
      providerError?.rawRequestJson ?? null,
      providerError?.rawResponseJson ?? null,
      providerError?.requiresManualReview ?? false
    );
    throw new HttpError(
      providerError?.requiresManualReview ? 409 : 502,
      providerError?.requiresManualReview
        ? "Возврат требует ручной проверки администратора"
        : "Не удалось выполнить возврат через платёжного провайдера",
      providerError?.requiresManualReview ? "payment_refund_manual_review" : "payment_refund_provider_failed"
    );
  }

  return finalizeRefund(prepared.id);
}

async function prepareRefund(input: RefundInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const payment = await tx.paymentTransaction.findUnique({
        where: { id: input.paymentId },
        include: { refunds: true, user: { select: { id: true, balance: true } } }
      });
      if (!payment) {
        throw new HttpError(404, "Платёж не найден", "payment_not_found");
      }
      const existing = payment.refunds[0];
      if (existing) return existing;
      if (payment.status !== "succeeded" || !payment.creditedAt || !payment.balanceTransactionId) {
        throw new HttpError(409, "Вернуть можно только успешно зачисленный платёж", "payment_not_refundable");
      }
      const amount = input.amount ?? payment.amount;
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > payment.amount) {
        throw new HttpError(400, "Сумма возврата превышает сумму платежа", "payment_refund_amount_invalid");
      }
      if (amount !== payment.amount) {
        throw new HttpError(400, "Сейчас доступен только полный возврат платежа", "partial_refund_not_supported");
      }
      if (payment.user.balance < amount) {
        throw new HttpError(409, "На основном балансе недостаточно средств для возврата", "payment_refund_balance_insufficient");
      }

      return tx.refundTransaction.create({
        data: {
          paymentTransactionId: payment.id,
          provider: payment.provider,
          externalRequestId: randomUUID(),
          amount,
          currency: payment.currency,
          reason: input.reason,
          createdByAdminId: input.adminUserId
        }
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.refundTransaction.findUnique({
        where: { paymentTransactionId: input.paymentId }
      });
      if (existing) return existing;
    }
    throw error;
  }
}

async function finalizeRefund(refundId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const refund = await tx.refundTransaction.findUnique({
        where: { id: refundId },
        include: { payment: true }
      });
      if (!refund) throw new HttpError(404, "Возврат не найден", "payment_refund_not_found");
      if (refund.status === "succeeded") {
        await ensureRefundNpdEntryTx(tx, refund, refund.payment, refund.balanceTransactionId);
        return refundResult(refund, true);
      }
      if (refund.status !== "provider_succeeded") {
        throw new HttpError(409, "Возврат ещё не подтверждён провайдером", "payment_refund_not_confirmed");
      }

      const existingLedger = await tx.balanceTransaction.findUnique({
        where: { idempotencyKey: paymentRefundIdempotencyKey(refund.id) }
      });
      if (existingLedger) {
        const completed = await tx.refundTransaction.update({
          where: { id: refund.id },
          data: {
            status: "succeeded",
            completedAt: refund.completedAt ?? new Date(),
            balanceTransactionId: existingLedger.id
          }
        });
        await tx.paymentTransaction.update({
          where: { id: refund.paymentTransactionId },
          data: { status: "refunded" }
        });
        await ensureRefundNpdEntryTx(tx, completed, refund.payment, existingLedger.id);
        return refundResult(completed, true);
      }

      const user = await tx.user.findUniqueOrThrow({
        where: { id: refund.payment.userId },
        select: { balance: true }
      });
      const claimed = await tx.user.updateMany({
        where: { id: refund.payment.userId, balance: { gte: refund.amount } },
        data: { balance: { decrement: refund.amount } }
      });
      if (claimed.count !== 1) {
        throw new RefundBalanceConflict();
      }

      const balanceTransaction = await tx.balanceTransaction.create({
        data: {
          userId: refund.payment.userId,
          type: "refund",
          source: refund.provider,
          idempotencyKey: paymentRefundIdempotencyKey(refund.id),
          amount: -refund.amount,
          balanceKind: "real",
          reason: "Возврат платежа",
          comment: refund.reason,
          metadataJson: JSON.stringify({
            paymentTransactionId: refund.paymentTransactionId,
            refundTransactionId: refund.id,
            orderId: refund.payment.orderId,
            providerRefundId: refund.providerRefundId
          }),
          balanceBefore: user.balance,
          balanceAfter: user.balance - refund.amount,
          createdByAdminId: refund.createdByAdminId
        }
      });
      const completed = await tx.refundTransaction.update({
        where: { id: refund.id },
        data: {
          status: "succeeded",
          completedAt: new Date(),
          balanceTransactionId: balanceTransaction.id
        }
      });
      await tx.paymentTransaction.update({
        where: { id: refund.paymentTransactionId },
        data: { status: "refunded" }
      });
      await ensureRefundNpdEntryTx(tx, completed, refund.payment, balanceTransaction.id);
      await writeAudit(refund.createdByAdminId, "admin.payment.refund", "payment", refund.paymentTransactionId, {
        refundTransactionId: refund.id,
        amount: refund.amount,
        balanceTransactionId: balanceTransaction.id,
        provider: refund.provider,
        reason: refund.reason
      }, tx);
      return refundResult(completed, false);
    });
  } catch (error) {
    if (error instanceof RefundBalanceConflict) {
      const refund = await prisma.refundTransaction.update({
        where: { id: refundId },
        data: { status: "manual_review", failedAt: new Date() },
        select: { createdByAdminId: true }
      });
      await writeAudit(refund.createdByAdminId, "payment.refund_manual_review", "refund", refundId, {
        reason: "balance_changed_after_provider_refund"
      });
      throw new HttpError(409, "Банк подтвердил возврат, но баланс требует ручной проверки", "payment_refund_manual_review");
    }
    throw error;
  }
}

async function markRefundFailed(
  refundId: string,
  reasonCode: string,
  rawRequestJson: string | null,
  rawResponseJson: string | null,
  manualReview: boolean
) {
  const refund = await prisma.refundTransaction.update({
    where: { id: refundId },
    data: {
      status: manualReview ? "manual_review" : "failed",
      rawRequestJson,
      rawResponseJson,
      failedAt: new Date()
    },
    select: { createdByAdminId: true }
  });
  await writeAudit(refund.createdByAdminId, manualReview ? "payment.refund_manual_review" : "payment.refund_failed", "refund", refundId, {
    reasonCode
  });
}

function refundResult(refund: RefundTransaction, idempotent: boolean) {
  return { refund, idempotent };
}

class RefundBalanceConflict extends Error {}
