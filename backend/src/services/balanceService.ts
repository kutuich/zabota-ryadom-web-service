import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { HttpError } from "../utils/http";
import { writeAudit } from "./auditService";
import { mockPaymentAdapter } from "./paymentAdapter";

type Tx = Prisma.TransactionClient;

export const FIXED_SERVICE_FEE_AMOUNT = 50;
export const MAX_ADMIN_BALANCE_ADJUSTMENT = 100_000;
export const FIXED_SERVICE_FEE_SETTING_KEYS = new Set([
  "clientServiceFeeAmount",
  "performerServiceFeeAmount",
  "performerCommissionAmount",
  "serviceCommissionAmount"
]);

export async function ensureFixedServiceFeeSettings() {
  const settings = [
    ["clientServiceFeeAmount", "Сервисный сбор заказчика, ₽"],
    ["performerServiceFeeAmount", "Сервисный сбор помощника, ₽"],
    ["performerCommissionAmount", "Устаревший ключ совместимости: сервисный сбор помощника"],
    ["serviceCommissionAmount", "Устаревший ключ совместимости: сервисный сбор"]
  ] as const;
  await prisma.$transaction(
    settings.map(([key, label]) => prisma.serviceSetting.upsert({
      where: { key },
      update: { valueJson: JSON.stringify(FIXED_SERVICE_FEE_AMOUNT), label, group: "payments" },
      create: { key, valueJson: JSON.stringify(FIXED_SERVICE_FEE_AMOUNT), label, group: "payments" }
    }))
  );
}

export async function getBalanceSummary(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      balance: true,
      bonusBalance: true,
      balanceTransactions: {
        select: {
          id: true,
          type: true,
          source: true,
          amount: true,
          balanceKind: true,
          reason: true,
          comment: true,
          createdByAdminId: true,
          createdByAdmin: { select: { id: true, displayName: true } },
          createdAt: true
        },
        orderBy: { createdAt: "desc" },
        take: 50
      },
      city: {
        select: {
          defaultCommissionAmount: true,
          minTopUpAmount: true
        }
      }
    }
  });

  if (!user) {
    throw new HttpError(404, "Пользователь не найден", "user_not_found");
  }

  const feeSettings = await getServiceFeeSettings();
  const serviceFeeAmount = feeSettings.clientServiceFeeAmount;
  const minTopUpAmount = user.city?.minTopUpAmount ?? env.defaultMinTopUpAmount;

  return {
    realBalance: user.balance,
    bonusBalance: user.bonusBalance,
    totalAvailableBalance: user.balance + user.bonusBalance,
    serviceCommissionAmount: serviceFeeAmount,
    clientServiceFeeAmount: feeSettings.clientServiceFeeAmount,
    performerServiceFeeAmount: feeSettings.performerCommissionAmount,
    performerCommissionAmount: feeSettings.performerCommissionAmount,
    useBonusForCommission: feeSettings.useBonusForCommission,
    chargeBonusFirst: feeSettings.chargeBonusFirst,
    minTopUpAmount,
    transactions: user.balanceTransactions
  };
}

export async function getServiceFeeSettings(tx: Tx | typeof prisma = prisma) {
  const rows = await tx.serviceSetting.findMany({
    where: {
      key: {
        in: [
          "useBonusForCommission",
          "chargeBonusFirst"
        ]
      }
    }
  });
  const values = Object.fromEntries(rows.map((row) => [row.key, parseSetting(row.valueJson)]));
  return {
    clientServiceFeeAmount: FIXED_SERVICE_FEE_AMOUNT,
    performerCommissionAmount: FIXED_SERVICE_FEE_AMOUNT,
    useBonusForCommission: booleanSetting(values.useBonusForCommission, true),
    chargeBonusFirst: booleanSetting(values.chargeBonusFirst, true)
  };
}

export async function mockTopUp(userId: string, amount: number) {
  const summary = await getBalanceSummary(userId);
  if (amount < summary.minTopUpAmount) {
    throw new HttpError(400, `Минимальное пополнение ${summary.minTopUpAmount} ₽`, "min_top_up");
  }

  const payment = await mockPaymentAdapter.createTopUp(amount, userId);

  await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({
      where: { id: userId },
      select: { balance: true }
    });
    if (!current) {
      throw new HttpError(404, "Пользователь не найден", "user_not_found");
    }

    const balanceBefore = current.balance;
    const balanceAfter = balanceBefore + amount;

    await tx.user.update({
      where: { id: userId },
      data: { balance: { increment: amount } }
    });
    await tx.balanceTransaction.create({
      data: {
        userId,
        type: "top_up",
        amount,
        balanceKind: "real",
        reason: "Тестовое пополнение",
        comment: `Платёжный провайдер работает в mock-режиме: ${payment.providerPaymentId}`,
        balanceBefore,
        balanceAfter
      }
    });
    await writeAudit(userId, "balance.mock_top_up", "user", userId, { amount, balanceBefore, balanceAfter, payment }, tx);
  });

  return getBalanceSummary(userId);
}

export async function grantAdminBonus(
  adminId: string,
  userId: string,
  amount: number,
  reason: string,
  comment: string,
  bonusExpiresAt?: Date | null
) {
  if (amount <= 0) {
    throw new HttpError(400, "Сумма должна быть больше нуля", "amount_invalid");
  }
  if (!reason.trim()) {
    throw new HttpError(400, "Укажите причину начисления", "reason_required");
  }
  if (comment.trim().length < 10) {
    throw new HttpError(400, "Укажите комментарий не короче 10 символов", "comment_required");
  }

  await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({
      where: { id: userId },
      select: { bonusBalance: true }
    });
    if (!current) {
      throw new HttpError(404, "Пользователь не найден", "user_not_found");
    }

    const balanceBefore = current.bonusBalance;
    const balanceAfter = balanceBefore + amount;

    await tx.user.update({
      where: { id: userId },
      data: { bonusBalance: { increment: amount } }
    });
    await tx.balanceTransaction.create({
      data: {
        userId,
        type: "admin_bonus",
        amount,
        balanceKind: "bonus",
        reason,
        comment: comment.trim(),
        balanceBefore,
        balanceAfter,
        bonusExpiresAt: bonusExpiresAt ?? undefined,
        createdByAdminId: adminId
      }
    });
    await writeAudit(adminId, "balance.admin_bonus", "user", userId, {
      amount,
      reason,
      comment: comment.trim(),
      balanceBefore,
      balanceAfter,
      bonusExpiresAt
    }, tx);
  });

  return getBalanceSummary(userId);
}

export type AdminBalanceAdjustmentInput = {
  actorUserId: string;
  actorRole: "admin" | "superadmin";
  targetUserId: string;
  wallet: "main" | "bonus";
  direction: "credit" | "debit";
  amount: number;
  reason: "payment_issue" | "goodwill_bonus" | "manual_correction" | "refund" | "penalty_reversal" | "other";
  comment: string;
  clientRequestId?: string;
};

export async function adjustUserBalanceByAdmin(
  input: AdminBalanceAdjustmentInput,
  dependencies: { auditWriter?: typeof writeAudit } = {}
) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > MAX_ADMIN_BALANCE_ADJUSTMENT) {
    throw new HttpError(400, `Сумма должна быть целым числом от 1 до ${MAX_ADMIN_BALANCE_ADJUSTMENT} ₽`, "amount_invalid");
  }
  const comment = input.comment.trim();
  if (comment.length < 10) {
    throw new HttpError(400, "Укажите комментарий не короче 10 символов", "comment_required");
  }

  const requestId = input.clientRequestId?.trim() || randomUUID();
  const idempotencyKey = `admin_adjustment:${input.targetUserId}:${input.actorUserId}:${requestId}`;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.balanceTransaction.findUnique({
      where: { idempotencyKey },
      include: { createdByAdmin: { select: { id: true, displayName: true } } }
    });
    if (existing) {
      const user = await adjustmentTargetPayload(tx, input.targetUserId);
      if (!user) throw new HttpError(404, "Пользователь не найден", "user_not_found");
      return { user, transaction: existing, idempotent: true };
    }

    const target = await adjustmentTargetPayload(tx, input.targetUserId);
    if (!target) throw new HttpError(404, "Пользователь не найден", "user_not_found");
    if (target.status === "archived") {
      throw new HttpError(409, "Архивному пользователю нельзя корректировать баланс", "archived_user_balance_adjustment_forbidden");
    }
    if (target.role === "oauth_pending") {
      throw new HttpError(409, "Незавершённому профилю нельзя корректировать баланс", "oauth_pending_balance_adjustment_forbidden");
    }
    if (!["client", "performer"].includes(target.role)) {
      throw new HttpError(409, "Баланс можно корректировать только Заказчику или Помощнику", "balance_adjustment_target_forbidden");
    }

    const delta = input.direction === "credit" ? input.amount : -input.amount;
    const walletField = input.wallet === "main" ? "balance" : "bonusBalance";
    const updated = await tx.user.updateMany({
      where: {
        id: target.id,
        ...(input.direction === "debit" ? { [walletField]: { gte: input.amount } } : {})
      },
      data: { [walletField]: { increment: delta } }
    });
    if (updated.count !== 1) {
      throw new HttpError(409, "Недостаточно средств для списания", "insufficient_wallet_balance");
    }

    const user = await adjustmentTargetPayload(tx, target.id);
    if (!user) throw new HttpError(404, "Пользователь не найден", "user_not_found");
    const mainBalanceBefore = input.wallet === "main" ? user.balance - delta : user.balance;
    const bonusBalanceBefore = input.wallet === "bonus" ? user.bonusBalance - delta : user.bonusBalance;
    const metadata = {
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      targetUserId: target.id,
      wallet: input.wallet,
      direction: input.direction,
      amount: input.amount,
      reason: input.reason,
      comment,
      balanceBefore: mainBalanceBefore,
      balanceAfter: user.balance,
      bonusBalanceBefore,
      bonusBalanceAfter: user.bonusBalance,
      source: "admin_panel",
      clientRequestId: requestId
    };
    const transaction = await tx.balanceTransaction.create({
      data: {
        userId: target.id,
        type: adminAdjustmentType(input.wallet, input.direction),
        source: "admin_panel",
        idempotencyKey,
        amount: delta,
        balanceKind: input.wallet === "main" ? "real" : "bonus",
        reason: input.reason,
        comment,
        metadataJson: JSON.stringify(metadata),
        balanceBefore: input.wallet === "main" ? mainBalanceBefore : bonusBalanceBefore,
        balanceAfter: input.wallet === "main" ? user.balance : user.bonusBalance,
        createdByAdminId: input.actorUserId
      },
      include: { createdByAdmin: { select: { id: true, displayName: true } } }
    });
    await (dependencies.auditWriter ?? writeAudit)(
      input.actorUserId,
      "admin.balance.adjust",
      "balance_transaction",
      transaction.id,
      metadata,
      tx
    );
    return { user, transaction, idempotent: false };
  });
}

function adminAdjustmentType(wallet: AdminBalanceAdjustmentInput["wallet"], direction: AdminBalanceAdjustmentInput["direction"]) {
  if (wallet === "main") return direction === "credit" ? "admin_balance_credit" : "admin_balance_debit";
  return direction === "credit" ? "admin_bonus_credit" : "admin_bonus_debit";
}

function adjustmentTargetPayload(tx: Tx, userId: string) {
  return tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      displayName: true,
      role: true,
      status: true,
      balance: true,
      bonusBalance: true,
      cityId: true,
      updatedAt: true
    }
  });
}

export async function chargeAvailableBalanceTx(
  tx: Tx,
  payerUserId: string,
  relatedRequestId: string,
  amount: number,
  actorUserId: string | null,
  reason = "Сервисный сбор за согласованный визит",
  options: {
    type?: string;
    comment?: string;
    useBonus?: boolean;
    chargeBonusFirst?: boolean;
    idempotencyKeyPrefix?: string;
  } = {}
) {
  const payer = await tx.user.findUnique({
    where: { id: payerUserId },
    select: { id: true, balance: true, bonusBalance: true }
  });

  if (!payer) {
    throw new HttpError(404, "Плательщик не найден", "payer_not_found");
  }

  const useBonus = options.useBonus ?? true;
  const chargeBonusFirst = options.chargeBonusFirst ?? true;
  const availableBefore = useBonus ? payer.balance + payer.bonusBalance : payer.balance;
  const totalBefore = payer.balance + payer.bonusBalance;

  if (totalBefore < 0) {
    throw new HttpError(
      402,
      "Баланс отрицательный. Пополните баланс сервиса, чтобы открывать новые рабочие чаты.",
      "negative_balance",
      { totalAvailableBalance: totalBefore }
    );
  }

  if (availableBefore < amount) {
    throw new HttpError(
      402,
      "Недостаточно средств на балансе сервиса для согласованного визита",
      "balance_required",
      { requiredAmount: amount, totalAvailableBalance: availableBefore }
    );
  }

  let bonusCharge = 0;
  let realCharge = amount;
  if (useBonus && chargeBonusFirst) {
    bonusCharge = Math.min(Math.max(payer.bonusBalance, 0), amount);
    realCharge = amount - bonusCharge;
  } else if (useBonus) {
    realCharge = Math.min(Math.max(payer.balance, 0), amount);
    bonusCharge = amount - realCharge;
  }

  await tx.user.update({
    where: { id: payerUserId },
    data: {
      bonusBalance: { decrement: bonusCharge },
      balance: { decrement: realCharge }
    }
  });

  const sourceLedgerEntryIds: string[] = [];
  if (bonusCharge > 0) {
    const entry = await tx.balanceTransaction.create({
      data: {
        userId: payerUserId,
        type: options.type ?? "commission_charge",
        amount: -bonusCharge,
        balanceKind: "bonus",
        reason,
        comment: options.comment ?? "Автоматическое списание после двойного подтверждения условий",
        balanceBefore: payer.bonusBalance,
        balanceAfter: payer.bonusBalance - bonusCharge,
        relatedRequestId,
        idempotencyKey: options.idempotencyKeyPrefix ? `${options.idempotencyKeyPrefix}:bonus` : undefined
      }
    });
    sourceLedgerEntryIds.push(entry.id);
  }

  if (realCharge > 0) {
    const entry = await tx.balanceTransaction.create({
      data: {
        userId: payerUserId,
        type: options.type ?? "commission_charge",
        amount: -realCharge,
        balanceKind: "real",
        reason,
        comment: options.comment ?? "Автоматическое списание после двойного подтверждения условий",
        balanceBefore: payer.balance,
        balanceAfter: payer.balance - realCharge,
        relatedRequestId,
        idempotencyKey: options.idempotencyKeyPrefix ? `${options.idempotencyKeyPrefix}:main` : undefined
      }
    });
    sourceLedgerEntryIds.push(entry.id);
  }

  await writeAudit(actorUserId, "balance.commission_charge", "request", relatedRequestId, {
    payerUserId,
    amount,
    bonusCharge,
    realCharge
  }, tx);

  return { bonusCharge, realCharge, sourceLedgerEntryIds };
}

export async function chargeAgreementFeesTx(
  tx: Tx,
  input: {
    requestId: string;
    clientId: string;
    performerId: string;
    actorUserId: string | null;
  }
) {
  const settings = await getServiceFeeSettings(tx);
  await chargeAvailableBalanceTx(
    tx,
    input.clientId,
    input.requestId,
    settings.clientServiceFeeAmount,
    input.actorUserId,
    "Сервисный сбор «Забота Рядом» за согласованный визит",
    {
      type: "client_service_fee",
      useBonus: true,
      chargeBonusFirst: true
    }
  );
  await chargeAvailableBalanceTx(
    tx,
    input.performerId,
    input.requestId,
    settings.performerCommissionAmount,
    input.actorUserId,
    "Сервисный сбор помощника за согласованный визит",
    {
      type: "performer_service_fee",
      useBonus: true,
      chargeBonusFirst: true
    }
  );
  return settings;
}

export function hasAvailableBalance(
  user: { balance: number; bonusBalance: number },
  amount: number,
  useBonus = true
) {
  const available = useBonus ? user.balance + user.bonusBalance : user.balance;
  return available >= amount;
}

export async function ensureNonNegativeBalance(userId: string) {
  const summary = await getBalanceSummary(userId);
  if (summary.totalAvailableBalance < 0) {
    throw new HttpError(
      402,
      "Баланс отрицательный. Новые рабочие действия недоступны до пополнения.",
      "negative_balance",
      { totalAvailableBalance: summary.totalAvailableBalance }
    );
  }
  return summary;
}

function parseSetting(valueJson: string) {
  try {
    return JSON.parse(valueJson);
  } catch {
    return valueJson;
  }
}

function numberSetting(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanSetting(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}
