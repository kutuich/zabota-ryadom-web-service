import type { PaymentTransaction, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { authenticate, requireAdmin } from "../middleware/auth";
import { getBalanceSummary } from "../services/balanceService";
import { requireFeatureConsent } from "../services/legalService";
import { createTopUpPayment, PaymentInitError, type PaymentStatus } from "../services/paymentAdapter";
import { generateTopUpOrderId } from "../services/paymentOrderId";
import { creditPaymentToBalanceTx, getPaymentBalanceSummary } from "../services/paymentService";
import { writeAudit } from "../services/auditService";
import { verifyTbankToken } from "../services/tbankToken";
import { asyncHandler, HttpError } from "../utils/http";

export const paymentsRouter = Router();
export const adminPaymentsRouter = Router();

const topUpSchema = z.object({
  amount: z.number().int().positive()
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
    const successUrl = env.tbankSuccessUrl;
    const failUrl = env.tbankFailUrl;
    const notificationUrl = env.tbankNotificationUrl;
    const metadata = {
      userId: req.user!.id,
      source: "top_up_init"
    };
    const description = "Пополнение баланса";

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

    const initResult = await createTopUpPayment(initInput).catch(async (error) => {
      if (error instanceof PaymentInitError) {
        const failedPayment = await prisma.paymentTransaction.create({
          data: {
            userId: req.user!.id,
            provider: error.provider,
            providerPaymentId: error.providerPaymentId,
            orderId,
            amount: input.amount,
            status: error.status,
            description,
            paymentUrl: null,
            successUrl,
            failUrl,
            notificationUrl,
            rawInitRequestJson: error.rawRequestJson,
            rawInitResponseJson: error.rawResponseJson,
            metadataJson: JSON.stringify(metadata),
            failedAt: new Date()
          }
        });
        await writeAudit(req.user!.id, "payment.top_up_init_failed", "payment", failedPayment.id, {
          orderId,
          amount: input.amount,
          provider: failedPayment.provider,
          status: failedPayment.status
        });
        throw new HttpError(502, error.message, "payment_init_failed");
      }
      if (error instanceof Error && error.message === "Платёжный провайдер не настроен") {
        throw new HttpError(503, error.message, "payment_provider_not_configured");
      }
      throw error;
    });

    const payment = await prisma.paymentTransaction.create({
      data: {
        userId: req.user!.id,
        provider: initResult.provider,
        providerPaymentId: initResult.providerPaymentId,
        orderId,
        amount: input.amount,
        status: initResult.status,
        description,
        paymentUrl: initResult.paymentUrl,
        successUrl,
        failUrl,
        notificationUrl,
        rawInitRequestJson: initResult.rawRequestJson,
        rawInitResponseJson: initResult.rawResponseJson,
        metadataJson: JSON.stringify(metadata)
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
  "/mock/:id/succeed",
  authenticate,
  asyncHandler(async (req, res) => {
    ensureMockEndpointAllowed(req.user!.role);
    const payment = await prisma.paymentTransaction.findUnique({ where: { id: req.params.id } });
    if (!payment) {
      throw new HttpError(404, "Платёж не найден", "payment_not_found");
    }
    if (payment.provider !== "mock") {
      throw new HttpError(400, "Тестовое подтверждение доступно только для mock-платежей", "payment_provider_mismatch");
    }

    const result = await prisma.$transaction(async (tx) => {
      const credit = await creditPaymentToBalanceTx(tx, payment, {
        reason: "Пополнение баланса через тестовую платёжную форму",
        comment: payment.orderId
      });
      if (credit.credited) {
        await writeAudit(req.user!.id, "payment.mock_succeed", "payment", payment.id, {
          orderId: payment.orderId,
          amount: payment.amount,
          balanceTransactionId: credit.balanceTransaction?.id
        }, tx);
      }
      return credit.payment;
    });

    res.json({
      payment: serializePayment(result, ["admin", "superadmin"].includes(req.user!.role)),
      balance: await getPaymentBalanceSummary(result.userId)
    });
  })
);

paymentsRouter.post(
  "/mock/:id/fail",
  authenticate,
  asyncHandler(async (req, res) => {
    ensureMockEndpointAllowed(req.user!.role);
    const payment = await prisma.paymentTransaction.findUnique({ where: { id: req.params.id } });
    if (!payment) {
      throw new HttpError(404, "Платёж не найден", "payment_not_found");
    }
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
    const payload = req.body ?? {};
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

    const payment = await findPaymentForWebhook(providerPaymentId, orderId);

    if (!payment) {
      await writeAudit(null, "payment.tbank_webhook_unmatched", "payment", null, {
        providerPaymentId,
        orderId,
        payload
      });
      return res.json({ ok: true, matched: false });
    }

    const payloadAmount = payload.Amount === undefined ? null : Number(payload.Amount);
    if (payloadAmount !== null && Number.isFinite(payloadAmount) && payloadAmount !== payment.amount * 100) {
      const updated = await prisma.paymentTransaction.update({
        where: { id: payment.id },
        data: {
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
      return res.json({ ok: true, matched: true, status: updated.status });
    }

    const normalizedStatus = normalizeTbankStatus(valueAsString(payload.Status));

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.paymentTransaction.findUnique({ where: { id: payment.id } });
      if (!current) {
        throw new HttpError(404, "Платёж не найден", "payment_not_found");
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

      if (normalizedStatus === "succeeded") {
        const credit = await creditPaymentToBalanceTx(tx, updated, {
          reason: "Пополнение баланса через платёжную форму Т-Банка",
          comment: updated.orderId
        });
        await writeAudit(null, "payment.tbank_webhook_succeed", "payment", updated.id, {
          orderId: updated.orderId,
          providerPaymentId,
          credited: credit.credited,
          balanceTransactionId: credit.balanceTransaction?.id ?? updated.balanceTransactionId
        }, tx);
        return credit.payment;
      }

      await writeAudit(null, "payment.tbank_webhook_status", "payment", updated.id, {
        orderId: updated.orderId,
        providerPaymentId,
        status: normalizedStatus
      }, tx);
      return updated;
    });

    res.json({ ok: true, matched: true, status: result.status });
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
      include: { user: { select: { id: true, displayName: true, role: true, phone: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    res.json(rows);
  })
);

adminPaymentsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const payment = await prisma.paymentTransaction.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { id: true, displayName: true, role: true, phone: true, email: true } } }
    });
    if (!payment) {
      throw new HttpError(404, "Платёж не найден", "payment_not_found");
    }
    const balanceTransaction = payment.balanceTransactionId
      ? await prisma.balanceTransaction.findUnique({ where: { id: payment.balanceTransactionId } })
      : null;

    res.json({
      payment,
      user: payment.user,
      balanceTransaction,
      rawInitResponseJson: payment.rawInitResponseJson,
      rawWebhookJson: payment.rawWebhookJson
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
    paymentUrl: payment.paymentUrl
  };
}

function serializePayment(payment: PaymentTransaction, includeRawWebhook = false) {
  if (includeRawWebhook) return payment;
  const { rawWebhookJson: _rawWebhookJson, ...safePayment } = payment;
  return safePayment;
}

function ensureMockEndpointAllowed(role: string) {
  if (env.nodeEnv !== "production" || env.paymentProvider === "mock" || ["admin", "superadmin"].includes(role)) {
    return;
  }
  throw new HttpError(403, "Тестовая платёжная форма недоступна", "mock_payment_forbidden");
}

function valueAsString(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value);
}

async function findPaymentForWebhook(providerPaymentId: string, orderId: string) {
  const conditions: Prisma.PaymentTransactionWhereInput[] = [];
  if (providerPaymentId) conditions.push({ providerPaymentId });
  if (orderId) conditions.push({ orderId });
  if (conditions.length === 0) return null;
  return prisma.paymentTransaction.findFirst({ where: { OR: conditions } });
}

function normalizeTbankStatus(status: string): PaymentStatus {
  const normalized = status.toUpperCase();
  if (["CONFIRMED", "AUTHORIZED", "SUCCESS", "SUCCEEDED", "COMPLETED"].includes(normalized)) return "succeeded";
  if (["REJECTED", "FAILED"].includes(normalized)) return "failed";
  if (["CANCELED", "CANCELLED"].includes(normalized)) return "cancelled";
  if (normalized === "DEADLINE_EXPIRED" || normalized === "EXPIRED") return "expired";
  if (normalized === "REFUNDED") return "refunded";
  return "manual_review";
}

function statusDatePatch(status: PaymentStatus, date: Date) {
  if (status === "succeeded") return { paidAt: date };
  if (status === "failed") return { failedAt: date };
  if (status === "cancelled") return { cancelledAt: date };
  if (status === "expired") return { failedAt: date };
  return {};
}
