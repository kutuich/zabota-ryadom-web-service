import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { HttpError } from "../utils/http";
import { writeAudit } from "./auditService";
import {
  getPaymentAdapter,
  PaymentStateError,
  type GetPaymentStateResult
} from "./paymentAdapter";
import { ensureRefundNpdEntryTx } from "./npdTaxRegisterService";

const NO_REFUND_MESSAGE = "Статус T-Bank обновлён. Возврат по этому платежу не обнаружен.";
const REFUND_ACCOUNTED_MESSAGE = "Обнаружен возврат в T-Bank. Сумма списана с баланса пользователя.";
const ALREADY_ACCOUNTED_MESSAGE = "Возврат уже был учтён ранее. Повторное списание не выполнено.";
const PARTIAL_REFUND_MESSAGE = "Обнаружен частичный возврат. Требуется ручная обработка.";
const INSUFFICIENT_BALANCE_MESSAGE =
  "T-Bank показывает возврат, но на основном балансе пользователя недостаточно средств для списания. Требуется ручная проверка.";
const PAYMENT_NOT_CREDITED_MESSAGE =
  "T-Bank показывает возврат, но исходное зачисление не найдено в истории баланса. Требуется ручная проверка.";
const BALANCE_REASON = "Возврат T-Bank: возврат сервисного платежа за использование сервиса «Забота Рядом»";

export const tbankSyncRefundIdempotencyKey = (paymentId: string) => `tbank_sync_refund:${paymentId}`;

type RefundState = {
  kind: "none" | "partial" | "full";
  amount: number | null;
};

export type TbankPaymentSyncResult = {
  synced: true;
  refundDetected: boolean;
  alreadyAccounted?: boolean;
  partialRefund?: boolean;
  manualReview?: boolean;
  message: string;
};

export async function syncTbankPaymentStatus(paymentId: string, adminUserId: string): Promise<TbankPaymentSyncResult> {
  const payment = await prisma.paymentTransaction.findUnique({ where: { id: paymentId } });
  if (!payment) throw new HttpError(404, "Платёж не найден", "payment_not_found");
  if (payment.provider !== "tbank") {
    throw new HttpError(400, "Сверка доступна только для платежей T-Bank", "payment_not_tbank");
  }

  const adapter = getPaymentAdapter("tbank");
  if (!adapter.getState) {
    throw new HttpError(503, "Проверка статуса T-Bank не настроена", "payment_state_not_configured");
  }

  let state: GetPaymentStateResult;
  try {
    state = await adapter.getState(payment);
  } catch (error) {
    if (error instanceof PaymentStateError) {
      await writeAudit(adminUserId, "admin.payment.tbank_sync_failed", "payment", payment.id, {
        providerPaymentId: payment.providerPaymentId,
        reasonCode: error.reasonCode
      });
      if (error.reasonCode === "provider_not_configured") {
        throw new HttpError(503, "Платёжный провайдер не настроен", "payment_provider_not_configured");
      }
    }
    throw new HttpError(502, "Не удалось сверить платёж с T-Bank", "payment_state_failed");
  }

  const refundState = classifyRefundState(state, payment.amount);
  const syncedAt = new Date();
  const safeState = safeProviderState(state);
  const metadataJson = mergeMetadata(payment.metadataJson, {
    lastTbankSync: { ...safeState, syncedAt: syncedAt.toISOString(), actorUserId: adminUserId }
  });

  if (refundState.kind === "none") {
    await prisma.$transaction(async (tx) => {
      await tx.paymentTransaction.update({
        where: { id: payment.id },
        data: {
          providerStatus: state.providerStatus,
          lastSyncedAt: syncedAt,
          rawStateResponseJson: state.rawResponseJson,
          metadataJson
        }
      });
      await writeAudit(adminUserId, "admin.payment.tbank_sync", "payment", payment.id, {
        providerStatus: state.providerStatus,
        refundDetected: false
      }, tx);
    });
    return { synced: true, refundDetected: false, message: NO_REFUND_MESSAGE };
  }

  if (refundState.kind === "partial") {
    await recordManualReview({ paymentId: payment.id, adminUserId, state, syncedAt, metadataJson, amount: refundState.amount });
    return {
      synced: true,
      refundDetected: true,
      partialRefund: true,
      manualReview: true,
      message: PARTIAL_REFUND_MESSAGE
    };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.paymentTransaction.findUnique({
        where: { id: payment.id },
        include: { refunds: true, user: { select: { id: true, balance: true } } }
      });
      if (!current) throw new HttpError(404, "Платёж не найден", "payment_not_found");

      const existingRefund = current.refunds[0] ?? null;
      const existingLedger = await tx.balanceTransaction.findUnique({
        where: { idempotencyKey: tbankSyncRefundIdempotencyKey(current.id) }
      });
      if (existingLedger || (existingRefund?.status === "succeeded" && existingRefund.balanceTransactionId)) {
        await tx.paymentTransaction.update({
          where: { id: current.id },
          data: { providerStatus: state.providerStatus, lastSyncedAt: syncedAt, rawStateResponseJson: state.rawResponseJson, metadataJson }
        });
        return {
          synced: true,
          refundDetected: true,
          alreadyAccounted: true,
          message: ALREADY_ACCOUNTED_MESSAGE
        };
      }
      if (existingRefund && existingRefund.refundType !== "tbank_sync_detected") {
        return {
          synced: true,
          refundDetected: true,
          alreadyAccounted: true,
          message: ALREADY_ACCOUNTED_MESSAGE
        };
      }

      if (!current.creditedAt || !current.balanceTransactionId) {
        await upsertSyncReviewRefund(tx, current, existingRefund, adminUserId, state, metadataJson, "tbank_sync_payment_not_credited");
        await tx.paymentTransaction.update({
          where: { id: current.id },
          data: {
            status: "manual_review",
            providerStatus: state.providerStatus,
            lastSyncedAt: syncedAt,
            rawStateResponseJson: state.rawResponseJson,
            metadataJson
          }
        });
        await writeAudit(adminUserId, "admin.payment.tbank_sync_manual_review", "payment", current.id, {
          reason: "original_credit_missing"
        }, tx);
        return {
          synced: true,
          refundDetected: true,
          manualReview: true,
          message: PAYMENT_NOT_CREDITED_MESSAGE
        };
      }

      if (current.user.balance < current.amount) {
        await upsertSyncReviewRefund(tx, current, existingRefund, adminUserId, state, metadataJson, "tbank_sync_balance_insufficient");
        await tx.paymentTransaction.update({
          where: { id: current.id },
          data: {
            status: "manual_review",
            providerStatus: state.providerStatus,
            lastSyncedAt: syncedAt,
            rawStateResponseJson: state.rawResponseJson,
            metadataJson
          }
        });
        await writeAudit(adminUserId, "admin.payment.tbank_sync_manual_review", "payment", current.id, {
          reason: "insufficient_main_balance",
          expectedDebit: current.amount,
          mainBalance: current.user.balance
        }, tx);
        return {
          synced: true,
          refundDetected: true,
          manualReview: true,
          message: INSUFFICIENT_BALANCE_MESSAGE
        };
      }

      const refund = existingRefund
        ? await tx.refundTransaction.update({
            where: { id: existingRefund.id },
            data: completedRefundData(current.amount, state, metadataJson)
          })
        : await tx.refundTransaction.create({
            data: {
              paymentTransactionId: current.id,
              userId: current.userId,
              provider: "tbank",
              refundType: "tbank_sync_detected",
              externalRequestId: randomUUID(),
              amount: current.amount,
              currency: current.currency,
              status: "succeeded",
              reason: "tbank_sync_full_refund",
              providerRefundId: state.providerRefundId,
              rawResponseJson: JSON.stringify(safeState),
              metadataJson,
              createdByAdminId: adminUserId,
              completedAt: syncedAt,
              failedAt: null
            }
          });

      const debited = await tx.user.updateMany({
        where: { id: current.userId, balance: { gte: current.amount } },
        data: { balance: { decrement: current.amount } }
      });
      if (debited.count !== 1) {
        throw new HttpError(409, INSUFFICIENT_BALANCE_MESSAGE, "tbank_sync_refund_balance_insufficient");
      }

      const balanceTransaction = await tx.balanceTransaction.create({
        data: {
          userId: current.userId,
          type: "bank_refund",
          source: "tbank_sync",
          idempotencyKey: tbankSyncRefundIdempotencyKey(current.id),
          amount: -current.amount,
          balanceKind: "real",
          reason: BALANCE_REASON,
          comment: "Возврат обнаружен при сверке с T-Bank",
          metadataJson: JSON.stringify({
            paymentTransactionId: current.id,
            refundTransactionId: refund.id,
            provider: "tbank",
            source: "tbank_sync",
            terminalMode: current.terminalMode,
            actorUserId: adminUserId
          }),
          balanceBefore: current.user.balance,
          balanceAfter: current.user.balance - current.amount,
          createdByAdminId: adminUserId
        }
      });

      const completedRefund = await tx.refundTransaction.update({
        where: { id: refund.id },
        data: { balanceTransactionId: balanceTransaction.id }
      });
      await tx.paymentTransaction.update({
        where: { id: current.id },
        data: {
          status: "refunded",
          providerStatus: state.providerStatus,
          lastSyncedAt: syncedAt,
          rawStateResponseJson: state.rawResponseJson,
          metadataJson
        }
      });
      await ensureRefundNpdEntryTx(tx, completedRefund, current, balanceTransaction.id);
      await writeAudit(adminUserId, "admin.payment.tbank_sync_refund", "payment", current.id, {
        paymentTransactionId: current.id,
        refundTransactionId: completedRefund.id,
        balanceTransactionId: balanceTransaction.id,
        amount: current.amount,
        terminalMode: current.terminalMode,
        source: "tbank_sync"
      }, tx);

      return { synced: true, refundDetected: true, message: REFUND_ACCOUNTED_MESSAGE };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { synced: true, refundDetected: true, alreadyAccounted: true, message: ALREADY_ACCOUNTED_MESSAGE };
    }
    throw error;
  }
}

function classifyRefundState(state: GetPaymentStateResult, paymentAmount: number): RefundState {
  const status = state.providerStatus.trim().toUpperCase();
  if (status === "REFUNDED") return { kind: "full", amount: paymentAmount };
  if (status === "PARTIAL_REFUNDED") {
    return { kind: "partial", amount: kopecksToRubles(state.refundedAmountKopecks) };
  }
  return { kind: "none", amount: null };
}

async function recordManualReview(input: {
  paymentId: string;
  adminUserId: string;
  state: GetPaymentStateResult;
  syncedAt: Date;
  metadataJson: string;
  amount: number | null;
}) {
  await prisma.$transaction(async (tx) => {
    const payment = await tx.paymentTransaction.findUnique({
      where: { id: input.paymentId },
      include: { refunds: true }
    });
    if (!payment) throw new HttpError(404, "Платёж не найден", "payment_not_found");
    if (payment.refunds.length === 0) {
      await tx.refundTransaction.create({
        data: {
          paymentTransactionId: payment.id,
          userId: payment.userId,
          provider: "tbank",
          refundType: "tbank_sync_detected",
          providerRefundId: input.state.providerRefundId,
          externalRequestId: randomUUID(),
          amount: input.amount ?? 0,
          currency: payment.currency,
          status: "manual_review",
          reason: "tbank_sync_partial_refund",
          rawResponseJson: JSON.stringify(safeProviderState(input.state)),
          metadataJson: input.metadataJson,
          createdByAdminId: input.adminUserId
        }
      });
    }
    await tx.paymentTransaction.update({
      where: { id: payment.id },
      data: {
        status: "manual_review",
        providerStatus: input.state.providerStatus,
        lastSyncedAt: input.syncedAt,
        rawStateResponseJson: input.state.rawResponseJson,
        metadataJson: input.metadataJson
      }
    });
    await writeAudit(input.adminUserId, "admin.payment.tbank_sync_manual_review", "payment", payment.id, {
      reason: "partial_refund",
      refundedAmount: input.amount
    }, tx);
  });
}

async function upsertSyncReviewRefund(
  tx: Prisma.TransactionClient,
  payment: { id: string; userId: string; amount: number; currency: string },
  existingRefund: { id: string } | null,
  adminUserId: string,
  state: GetPaymentStateResult,
  metadataJson: string,
  reason: string
) {
  const data = {
    providerRefundId: state.providerRefundId,
    amount: payment.amount,
    status: "manual_review",
    reason,
    rawResponseJson: JSON.stringify(safeProviderState(state)),
    metadataJson,
    failedAt: new Date()
  };
  if (existingRefund) return tx.refundTransaction.update({ where: { id: existingRefund.id }, data });
  return tx.refundTransaction.create({
    data: {
      paymentTransactionId: payment.id,
      userId: payment.userId,
      provider: "tbank",
      refundType: "tbank_sync_detected",
      externalRequestId: randomUUID(),
      currency: payment.currency,
      createdByAdminId: adminUserId,
      ...data
    }
  });
}

function completedRefundData(amount: number, state: GetPaymentStateResult, metadataJson: string) {
  return {
    providerRefundId: state.providerRefundId,
    amount,
    status: "succeeded",
    reason: "tbank_sync_full_refund",
    rawResponseJson: JSON.stringify(safeProviderState(state)),
    metadataJson,
    completedAt: new Date(),
    failedAt: null
  };
}

function safeProviderState(state: GetPaymentStateResult) {
  return {
    providerPaymentId: state.providerPaymentId,
    providerRefundId: state.providerRefundId,
    orderId: state.orderId,
    providerStatus: state.providerStatus,
    amountKopecks: state.amountKopecks,
    originalAmountKopecks: state.originalAmountKopecks,
    newAmountKopecks: state.newAmountKopecks,
    refundedAmountKopecks: state.refundedAmountKopecks
  };
}

function mergeMetadata(current: string | null, patch: Record<string, unknown>) {
  let base: Record<string, unknown> = {};
  try {
    const parsed = current ? JSON.parse(current) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) base = parsed;
  } catch {
    base = {};
  }
  return JSON.stringify({ ...base, ...patch });
}

function kopecksToRubles(value: number | null) {
  if (value === null || !Number.isSafeInteger(value) || value <= 0) return null;
  return Math.max(1, Math.round(value / 100));
}
