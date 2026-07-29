import type { PaymentTransaction, Prisma } from "@prisma/client";
import { Router, type Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { authenticate, requireAdmin } from "../middleware/auth";
import { getBalanceSummary } from "../services/balanceService";
import { requireFeatureConsent } from "../services/legalService";
import {
  createTopUpPayment,
  getPaymentAdapter,
  PaymentInitError,
  PaymentStateError,
  type PaymentStatus
} from "../services/paymentAdapter";
import { generateTopUpOrderId } from "../services/paymentOrderId";
import { creditPaymentToBalance, getPaymentBalanceSummary } from "../services/paymentService";
import { refundPayment } from "../services/refundService";
import { writeAudit } from "../services/auditService";
import { createManualBankRefund } from "../services/manualBankRefundService";
import { syncTbankPaymentStatus } from "../services/tbankPaymentSyncService";
import { verifyTbankToken } from "../services/tbankToken";
import { asyncHandler, HttpError } from "../utils/http";

export const paymentsRouter = Router();
export const adminPaymentsRouter = Router();

const topUpSchema = z.object({
  amount: z.number().int().positive().max(1_000_000)
});

const refundSchema = z.object({
  amount: z.number().int().positive().max(1_000_000).optional(),
  reason: z.string().trim().min(3).max(500)
});

const manualBankRefundSchema = z.object({
  amount: z.number().int().positive().max(1_000_000),
  bankRefundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.enum(["customer_request", "test_refund", "service_cancelled", "duplicate_payment", "other"]),
  comment: z.string().trim().min(3).max(1000),
  bankReference: z.string().trim().max(300).optional().nullable()
});

paymentsRouter.post(
  "/top-up/init",
  authenticate,
  requireFeatureConsent("top_up_balance"),
  asyncHandler(async (req, res) => {
    const input = topUpSchema.parse(req.body);
    const summary = await getBalanceSummary(req.user!.id);
    if (input.amount < summary.minTopUpAmount) {
      throw new HttpError(400, `Минимальное пополнение ${summary.minTopUpAmount} ₽`, "min_top_up");
    }

    const orderId = generateTopUpOrderId(req.user!.id);
    const baseSuccessUrl = env.tbankSuccessUrl;
    const baseFailUrl = env.tbankFailUrl;
    const notificationUrl = env.tbankNotificationUrl;
    const metadata = {
      userId: req.user!.id,
      source: "top_up_init",
      terminalMode: env.paymentProvider === "tbank" ? env.tbankTerminalMode : null
    };
    const description = "Пополнение баланса";

    const createdPayment = await prisma.paymentTransaction.create({
      data: {
        userId: req.user!.id,
        provider: env.paymentProvider,
        terminalMode: env.paymentProvider === "tbank" ? env.tbankTerminalMode : null,
        orderId,
        amount: input.amount,
        status: "created",
        description,
        successUrl: baseSuccessUrl,
        failUrl: baseFailUrl,
        notificationUrl,
        metadataJson: JSON.stringify(metadata)
      }
    });
    const successUrl = appendPaymentReference(baseSuccessUrl, createdPayment.id, orderId);
    const failUrl = appendPaymentReference(baseFailUrl, createdPayment.id, orderId);
    const initInput = {
      userId: req.user!.id,
      amount: input.amount,
      orderId,
      description,
      successUrl,
      failUrl,
      notificationUrl,
      metadata
    };

    let initResult: Awaited<ReturnType<typeof createTopUpPayment>>;
    try {
      initResult = await createTopUpPayment(initInput);
    } catch (error) {
      if (error instanceof PaymentInitError) {
        const failedPayment = await prisma.paymentTransaction.update({
          where: { id: createdPayment.id },
          data: {
            provider: error.provider,
            providerPaymentId: error.providerPaymentId,
            status: error.status,
            rawInitRequestJson: error.rawRequestJson,
            rawInitResponseJson: error.rawResponseJson,
            failedAt: error.status === "failed" ? new Date() : null
          }
        });
        await writeAudit(req.user!.id, "payment.top_up_init_failed", "payment", failedPayment.id, {
          orderId,
          amount: input.amount,
          provider: failedPayment.provider,
          status: failedPayment.status
        });
        throw new HttpError(502, "Не удалось создать платёж", "payment_init_failed");
      }
      const failedPayment = await prisma.paymentTransaction.update({
        where: { id: createdPayment.id },
        data: { status: "failed", failedAt: new Date() }
      });
      await writeAudit(req.user!.id, "payment.top_up_init_failed", "payment", failedPayment.id, {
        orderId,
        amount: input.amount,
        provider: failedPayment.provider,
        status: failedPayment.status
      });
      if (error instanceof Error && error.message === "Платёжный провайдер не настроен") {
        throw new HttpError(503, "Платёжный провайдер не настроен", "payment_provider_not_configured");
      }
      throw new HttpError(502, "Не удалось создать платёж", "payment_init_failed");
    }

    const payment = await prisma.paymentTransaction.update({
      where: { id: createdPayment.id },
      data: {
        provider: initResult.provider,
        providerPaymentId: initResult.providerPaymentId,
        status: initResult.status,
        paymentUrl: initResult.paymentUrl,
        successUrl,
        failUrl,
        rawInitRequestJson: initResult.rawRequestJson,
        rawInitResponseJson: initResult.rawResponseJson
      }
    });

    await writeAudit(req.user!.id, "payment.top_up_init", "payment", payment.id, {
      orderId,
      amount: input.amount,
      provider: payment.provider,
      status: payment.status
    });

    res.status(201).json(serializePaymentSummary(payment));
  })
);

paymentsRouter.get(
  "/my",
  authenticate,
  asyncHandler(async (req, res) => {
    const rows = await prisma.paymentTransaction.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    res.json(rows.map((payment) => serializePayment(payment)));
  })
);

paymentsRouter.post(
  "/:id/refresh-status",
  authenticate,
  asyncHandler(async (req, res) => {
    const payment = await prisma.paymentTransaction.findUnique({ where: { id: req.params.id } });
    if (!payment) {
      throw new HttpError(404, "Платёж не найден", "payment_not_found");
    }

    const realRole = req.user!.realRole;
    if (realRole === "manager") {
      throw new HttpError(403, "Менеджер может только просматривать платежи", "manager_permission_denied");
    }
    const isAdmin = ["admin", "superadmin"].includes(realRole);
    if (!isAdmin && payment.userId !== req.user!.id) {
      throw new HttpError(403, "Нет доступа к платежу", "forbidden");
    }

    if (payment.provider === "mock") {
      return res.json(serializePaymentRefresh(payment, refreshMessage(payment.status)));
    }
    if (payment.provider !== "tbank") {
      throw new HttpError(400, "Проверка статуса для этого провайдера недоступна", "payment_provider_mismatch");
    }

    const adapter = getPaymentAdapter("tbank");
    if (!adapter.getState) {
      throw new HttpError(503, "Проверка статуса платежа не настроена", "payment_state_not_configured");
    }

    let providerState: Awaited<ReturnType<NonNullable<typeof adapter.getState>>>;
    try {
      providerState = await adapter.getState(payment);
    } catch (error) {
      if (error instanceof PaymentStateError) {
        if (error.requiresManualReview) {
          const updated = await prisma.paymentTransaction.update({
            where: { id: payment.id },
            data: payment.creditedAt || payment.balanceTransactionId
              ? { rawStateResponseJson: error.rawResponseJson }
              : { status: "manual_review", rawStateResponseJson: error.rawResponseJson }
          });
          await writeAudit(req.user!.id, "payment.tbank_get_state_manual_review", "payment", payment.id, {
            orderId: payment.orderId,
            providerPaymentId: payment.providerPaymentId,
            reasonCode: error.reasonCode
          });
          return res.json(serializePaymentRefresh(updated, "Платёж передан на ручную проверку."));
        }
        await writeAudit(req.user!.id, "payment.tbank_get_state_failed", "payment", payment.id, {
          orderId: payment.orderId,
          providerPaymentId: payment.providerPaymentId,
          reasonCode: error.reasonCode
        });
        if (error.reasonCode === "provider_not_configured") {
          throw new HttpError(503, "Платёжный провайдер не настроен", "payment_provider_not_configured");
        }
      }
      throw new HttpError(502, "Не удалось проверить статус платежа", "payment_state_failed");
    }

    const normalizedStatus = normalizeTbankStatus(providerState.providerStatus, providerState.success);
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.paymentTransaction.findUnique({ where: { id: payment.id } });
      if (!current) throw new HttpError(404, "Платёж не найден", "payment_not_found");
      if (current.creditedAt || current.balanceTransactionId || current.status === "manual_review") {
        return tx.paymentTransaction.update({
          where: { id: current.id },
          data: { rawStateResponseJson: providerState.rawResponseJson }
        });
      }
      const nextStatus: PaymentStatus = isTerminalPaymentStatus(current.status) && normalizedStatus === "pending"
        ? current.status as PaymentStatus
        : normalizedStatus;
      const now = new Date();
      const row = await tx.paymentTransaction.update({
        where: { id: current.id },
        data: {
          status: nextStatus,
          rawStateResponseJson: providerState.rawResponseJson,
          ...statusDatePatch(nextStatus, now)
        }
      });
      await writeAudit(req.user!.id, "payment.tbank_get_state", "payment", row.id, {
        orderId: row.orderId,
        providerPaymentId: row.providerPaymentId,
        providerStatus: providerState.providerStatus,
        status: nextStatus
      }, tx);
      return row;
    });

    const finalPayment = updated.status === "succeeded"
      ? (await creditPaymentToBalance(updated.id, {
          reason: "Пополнение баланса через платёжную форму Т-Банка",
          comment: updated.orderId
        })).payment
      : updated;

    res.json(serializePaymentRefresh(finalPayment, refreshMessage(finalPayment.status)));
  })
);

paymentsRouter.post(
  "/mock/:id/succeed",
  authenticate,
  asyncHandler(async (req, res) => {
    ensureMockEndpointAllowed();
    const payment = await prisma.paymentTransaction.findUnique({ where: { id: req.params.id } });
    if (!payment) {
      throw new HttpError(404, "Платёж не найден", "payment_not_found");
    }
    assertPaymentOwner(payment.userId, req.user!.id);
    if (payment.provider !== "mock") {
      throw new HttpError(400, "Тестовое подтверждение доступно только для mock-платежей", "payment_provider_mismatch");
    }

    await prisma.paymentTransaction.updateMany({
      where: { id: payment.id, status: { in: ["created", "pending"] }, creditedAt: null },
      data: { status: "succeeded", paidAt: new Date() }
    });

    const credit = await creditPaymentToBalance(payment.id, {
      reason: "Пополнение баланса через тестовую платёжную форму",
      comment: payment.orderId
    });
    if (credit.credited) {
      await writeAudit(req.user!.id, "payment.mock_succeed", "payment", payment.id, {
        orderId: payment.orderId,
        amount: payment.amount,
        balanceTransactionId: credit.balanceTransaction?.id
      });
    }

    res.json({
      payment: serializePayment(credit.payment, ["admin", "superadmin"].includes(req.user!.role)),
      balance: await getPaymentBalanceSummary(credit.payment.userId)
    });
  })
);

paymentsRouter.post(
  "/mock/:id/fail",
  authenticate,
  asyncHandler(async (req, res) => {
    ensureMockEndpointAllowed();
    const payment = await prisma.paymentTransaction.findUnique({ where: { id: req.params.id } });
    if (!payment) {
      throw new HttpError(404, "Платёж не найден", "payment_not_found");
    }
    assertPaymentOwner(payment.userId, req.user!.id);
    if (payment.provider !== "mock") {
      throw new HttpError(400, "Тестовое отклонение доступно только для mock-платежей", "payment_provider_mismatch");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.paymentTransaction.findUnique({ where: { id: payment.id } });
      if (!current) {
        throw new HttpError(404, "Платёж не найден", "payment_not_found");
      }
      if (current.creditedAt || current.balanceTransactionId || current.status === "succeeded") {
        return current;
      }
      if (!["created", "pending"].includes(current.status)) {
        return current;
      }
      const failed = await tx.paymentTransaction.update({
        where: { id: current.id },
        data: {
          status: "failed",
          failedAt: new Date()
        }
      });
      await writeAudit(req.user!.id, "payment.mock_fail", "payment", current.id, {
        orderId: current.orderId,
        amount: current.amount
      }, tx);
      return failed;
    });

    res.json({
      payment: serializePayment(updated, ["admin", "superadmin"].includes(req.user!.role)),
      balance: await getPaymentBalanceSummary(updated.userId)
    });
  })
);

paymentsRouter.post(
  "/tbank/webhook",
  asyncHandler(async (req, res) => {
    const payload = isPlainRecord(req.body) ? req.body : {};
    const rawWebhookJson = JSON.stringify(payload);
    const providerPaymentId = valueAsString(payload.PaymentId ?? payload.PaymentID);
    const orderId = valueAsString(payload.OrderId ?? payload.OrderID);

    if (!env.tbankPassword) {
      await writeAudit(null, "payment.tbank_webhook_provider_not_configured", "payment", null, {
        providerPaymentId,
        orderId
      });
      throw new HttpError(400, "Платёжный провайдер не настроен", "payment_provider_not_configured");
    }

    if (!verifyTbankToken(payload, env.tbankPassword)) {
      await writeAudit(null, "payment.tbank_webhook_invalid_token", "payment", null, {
        providerPaymentId,
        orderId
      });
      throw new HttpError(400, "Некорректная подпись уведомления", "payment_webhook_token_invalid");
    }

    const terminalKey = valueAsString(payload.TerminalKey);
    if (!providerPaymentId || !orderId || !terminalKey || terminalKey !== env.tbankTerminalKey) {
      await writeAudit(null, "payment.tbank_webhook_invalid_payload", "payment", null, {
        providerPaymentId,
        orderId,
        terminalKeyMatches: terminalKey === env.tbankTerminalKey
      });
      throw new HttpError(400, "Некорректные данные уведомления", "payment_webhook_payload_invalid");
    }

    const payment = await findPaymentForWebhook(providerPaymentId, orderId);

    if (!payment) {
      await writeAudit(null, "payment.tbank_webhook_unmatched", "payment", null, {
        providerPaymentId,
        orderId,
        status: valueAsString(payload.Status)
      });
      throw new HttpError(404, "Платёж не найден", "payment_not_found");
    }

    const payloadAmount = Number(payload.Amount);
    if (!Number.isSafeInteger(payloadAmount) || payloadAmount <= 0 || payloadAmount !== payment.amount * 100) {
      const updated = await prisma.paymentTransaction.update({
        where: { id: payment.id },
        data: payment.creditedAt
          ? { rawWebhookJson }
          : {
              providerPaymentId: payment.providerPaymentId ?? providerPaymentId,
              rawWebhookJson,
              status: "manual_review"
            }
      });
      await writeAudit(null, "payment.tbank_webhook_amount_mismatch", "payment", payment.id, {
        orderId: payment.orderId,
        expectedAmount: payment.amount * 100,
        payloadAmount
      });
      return sendTbankOk(res);
    }

    const normalizedStatus = normalizeTbankStatus(valueAsString(payload.Status), payload.Success);

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.paymentTransaction.findUnique({ where: { id: payment.id } });
      if (!current) {
        throw new HttpError(404, "Платёж не найден", "payment_not_found");
      }

      if (current.creditedAt || current.balanceTransactionId) {
        return tx.paymentTransaction.update({
          where: { id: current.id },
          data: { rawWebhookJson }
        });
      }
      if (current.status === "manual_review") {
        return tx.paymentTransaction.update({
          where: { id: current.id },
          data: { rawWebhookJson }
        });
      }

      const now = new Date();
      const statusDates = statusDatePatch(normalizedStatus, now);
      const updated = await tx.paymentTransaction.update({
        where: { id: current.id },
        data: {
          providerPaymentId: current.providerPaymentId ?? providerPaymentId,
          rawWebhookJson,
          status: normalizedStatus,
          ...statusDates
        }
      });

      await writeAudit(null, "payment.tbank_webhook_status", "payment", updated.id, {
        orderId: updated.orderId,
        providerPaymentId,
        status: normalizedStatus
      }, tx);
      return updated;
    });

    if (normalizedStatus === "succeeded") {
      const credit = await creditPaymentToBalance(result.id, {
        reason: "Пополнение баланса через платёжную форму Т-Банка",
        comment: result.orderId
      });
      await writeAudit(null, "payment.tbank_webhook_succeed", "payment", result.id, {
        orderId: result.orderId,
        providerPaymentId,
        credited: credit.credited,
        balanceTransactionId: credit.balanceTransaction?.id ?? credit.payment.balanceTransactionId
      });
      return sendTbankOk(res);
    }

    sendTbankOk(res);
  })
);

paymentsRouter.get(
  "/:id",
  authenticate,
  asyncHandler(async (req, res) => {
    const payment = await prisma.paymentTransaction.findUnique({ where: { id: req.params.id } });
    if (!payment) {
      throw new HttpError(404, "Платёж не найден", "payment_not_found");
    }
    const isAdmin = ["admin", "superadmin"].includes(req.user!.role);
    if (!isAdmin && payment.userId !== req.user!.id) {
      throw new HttpError(403, "Нет доступа к платежу", "forbidden");
    }

    res.json(serializePayment(payment, isAdmin));
  })
);

adminPaymentsRouter.use(authenticate, requireAdmin);

adminPaymentsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const where: Prisma.PaymentTransactionWhereInput = {};
    if (typeof req.query.status === "string" && req.query.status) where.status = req.query.status;
    if (typeof req.query.provider === "string" && req.query.provider) where.provider = req.query.provider;
    if (typeof req.query.userId === "string" && req.query.userId) where.userId = req.query.userId;
    const createdAt: Prisma.DateTimeFilter = {};
    if (typeof req.query.dateFrom === "string" && req.query.dateFrom) createdAt.gte = new Date(req.query.dateFrom);
    if (typeof req.query.dateTo === "string" && req.query.dateTo) createdAt.lte = new Date(req.query.dateTo);
    if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

    const rows = await prisma.paymentTransaction.findMany({
      where,
      select: {
        id: true,
        userId: true,
        provider: true,
        terminalMode: true,
        providerStatus: true,
        providerPaymentId: true,
        orderId: true,
        amount: true,
        currency: true,
        status: true,
        purpose: true,
        description: true,
        balanceTransactionId: true,
        createdAt: true,
        updatedAt: true,
        paidAt: true,
        creditedAt: true,
        lastSyncedAt: true,
        failedAt: true,
        cancelledAt: true,
        user: { select: { id: true, displayName: true, role: true, phone: true, email: true } }
      },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    res.json(rows);
  })
);

adminPaymentsRouter.post(
  "/:id/refund",
  asyncHandler(async (req, res) => {
    const input = refundSchema.parse(req.body);
    const result = await refundPayment({
      paymentId: req.params.id,
      amount: input.amount,
      reason: input.reason,
      adminUserId: req.user!.id
    });
    res.json({
      refund: serializeRefund(result.refund),
      idempotent: result.idempotent
    });
  })
);

adminPaymentsRouter.post(
  "/:id/manual-bank-refund",
  asyncHandler(async (req, res) => {
    const input = manualBankRefundSchema.parse(req.body);
    const bankRefundDate = new Date(`${input.bankRefundDate}T12:00:00+05:00`);
    if (Number.isNaN(bankRefundDate.getTime())) {
      throw new HttpError(400, "Укажите корректную дату возврата", "manual_bank_refund_date_invalid");
    }
    const refund = await createManualBankRefund({
      paymentId: req.params.id,
      amount: input.amount,
      bankRefundDate,
      reason: input.reason,
      comment: input.comment,
      bankReference: input.bankReference,
      adminUserId: req.user!.id
    });
    res.status(201).json({ refund: serializeRefund(refund) });
  })
);

adminPaymentsRouter.post(
  "/:id/sync-tbank-status",
  asyncHandler(async (req, res) => {
    res.json(await syncTbankPaymentStatus(req.params.id, req.user!.id));
  })
);

adminPaymentsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const payment = await prisma.paymentTransaction.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, displayName: true, role: true, phone: true, email: true } },
        refunds: {
          include: { createdByAdmin: { select: { id: true, displayName: true } } },
          orderBy: { createdAt: "desc" }
        }
      }
    });
    if (!payment) {
      throw new HttpError(404, "Платёж не найден", "payment_not_found");
    }
    const balanceTransaction = payment.balanceTransactionId
      ? await prisma.balanceTransaction.findUnique({ where: { id: payment.balanceTransactionId } })
      : null;

    res.json({
      payment: serializeAdminPayment(payment),
      user: payment.user,
      balanceTransaction,
      refunds: payment.refunds.map(serializeRefund),
      rawInitResponseJson: redactProviderJson(payment.rawInitResponseJson),
      rawStateResponseJson: redactProviderJson(payment.rawStateResponseJson),
      rawWebhookJson: redactProviderJson(payment.rawWebhookJson)
    });
  })
);

function serializePaymentSummary(payment: PaymentTransaction) {
  return {
    id: payment.id,
    orderId: payment.orderId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    provider: payment.provider,
    terminalMode: payment.terminalMode,
    paymentUrl: payment.paymentUrl
  };
}

function serializePayment(payment: PaymentTransaction, _includeTechnical = false) {
  return {
    id: payment.id,
    userId: payment.userId,
    provider: payment.provider,
    terminalMode: payment.terminalMode,
    providerStatus: payment.providerStatus,
    providerPaymentId: payment.providerPaymentId,
    orderId: payment.orderId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    purpose: payment.purpose,
    description: payment.description,
    paymentUrl: payment.paymentUrl,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    paidAt: payment.paidAt,
    creditedAt: payment.creditedAt,
    failedAt: payment.failedAt,
    cancelledAt: payment.cancelledAt,
    lastSyncedAt: payment.lastSyncedAt
  };
}

function serializeAdminPayment(payment: PaymentTransaction) {
  return {
    ...serializePayment(payment),
    balanceTransactionId: payment.balanceTransactionId
  };
}

function serializeRefund(refund: {
  id: string;
  paymentTransactionId: string;
  provider: string;
  refundType?: string | null;
  userId?: string | null;
  providerRefundId: string | null;
  externalRequestId: string;
  amount: number;
  currency: string;
  status: string;
  reason: string;
  bankRefundDate?: Date | null;
  bankReference?: string | null;
  adminComment?: string | null;
  metadataJson?: string | null;
  balanceTransactionId: string | null;
  createdByAdminId: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  failedAt: Date | null;
  createdByAdmin?: { id: string; displayName: string } | null;
}) {
  return {
    id: refund.id,
    paymentTransactionId: refund.paymentTransactionId,
    provider: refund.provider,
    refundType: refund.refundType,
    userId: refund.userId,
    providerRefundId: refund.providerRefundId,
    externalRequestId: refund.externalRequestId,
    amount: refund.amount,
    currency: refund.currency,
    status: refund.status,
    reason: refund.reason,
    bankRefundDate: refund.bankRefundDate,
    bankReference: refund.bankReference,
    adminComment: refund.adminComment,
    metadataJson: refund.metadataJson,
    balanceTransactionId: refund.balanceTransactionId,
    createdByAdminId: refund.createdByAdminId,
    createdByAdmin: refund.createdByAdmin,
    createdAt: refund.createdAt,
    updatedAt: refund.updatedAt,
    completedAt: refund.completedAt,
    failedAt: refund.failedAt
  };
}

function serializePaymentRefresh(payment: PaymentTransaction, message: string) {
  return {
    paymentId: payment.id,
    orderId: payment.orderId,
    provider: payment.provider,
    amount: payment.amount,
    status: payment.status,
    creditedAt: payment.creditedAt,
    balanceTransactionId: payment.balanceTransactionId,
    message
  };
}

function ensureMockEndpointAllowed() {
  if (env.nodeEnv === "production") {
    throw new HttpError(403, "Тестовая платёжная форма недоступна", "mock_payment_forbidden");
  }
}

function assertPaymentOwner(paymentUserId: string, authenticatedUserId: string) {
  if (paymentUserId !== authenticatedUserId) {
    throw new HttpError(403, "Нет доступа к платежу", "forbidden");
  }
}

function valueAsString(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value);
}

async function findPaymentForWebhook(providerPaymentId: string, orderId: string) {
  if (!providerPaymentId || !orderId) return null;
  return prisma.paymentTransaction.findFirst({
    where: { provider: "tbank", providerPaymentId, orderId }
  });
}

function normalizeTbankStatus(status: string, success: unknown): PaymentStatus {
  const normalized = status.toUpperCase();
  if (normalized === "CONFIRMED") return isProviderSuccess(success) ? "succeeded" : "manual_review";
  if (["REJECTED", "FAILED"].includes(normalized)) return "failed";
  if (["CANCELED", "CANCELLED"].includes(normalized)) return "cancelled";
  if (normalized === "DEADLINE_EXPIRED" || normalized === "EXPIRED") return "expired";
  if (normalized === "REFUNDED") return "refunded";
  if (["NEW", "FORM_SHOWED", "AUTHORIZING", "3DS_CHECKING", "3DS_CHECKED", "AUTHORIZED", "AUTH_FAIL"].includes(normalized)) return "pending";
  return "manual_review";
}

function isProviderSuccess(value: unknown) {
  return value === true || (typeof value === "string" && value.toLowerCase() === "true");
}

function sendTbankOk(res: Response) {
  return res.status(200).type("text/plain").send("OK");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function redactProviderJson(value: string | null) {
  if (!value) return null;
  try {
    const payload = JSON.parse(value) as unknown;
    if (!isPlainRecord(payload)) return null;
    const redacted = { ...payload };
    for (const key of ["Token", "Password", "access_token", "refresh_token"]) delete redacted[key];
    return JSON.stringify(redacted);
  } catch {
    return null;
  }
}

function statusDatePatch(status: PaymentStatus, date: Date) {
  if (status === "succeeded") return { paidAt: date };
  if (status === "failed") return { failedAt: date };
  if (status === "cancelled") return { cancelledAt: date };
  if (status === "expired") return { failedAt: date };
  return {};
}

function isTerminalPaymentStatus(status: string) {
  return ["succeeded", "failed", "cancelled", "expired", "refunded"].includes(status);
}

function refreshMessage(status: string) {
  if (status === "succeeded") return "Платёж подтверждён. Баланс обновлён.";
  if (["failed", "cancelled", "expired"].includes(status)) return "Платёж не завершён. Деньги не зачислены на баланс.";
  if (status === "manual_review") return "Платёж передан на ручную проверку.";
  return "Платёж пока проверяется. Повторите проверку чуть позже.";
}

function appendPaymentReference(baseUrl: string, paymentId: string, orderId: string) {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("paymentId", paymentId);
    url.searchParams.set("orderId", orderId);
    return url.toString();
  } catch {
    return baseUrl;
  }
}
