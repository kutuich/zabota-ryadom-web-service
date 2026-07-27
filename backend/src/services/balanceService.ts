import type { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { HttpError } from "../utils/http";
import { writeAudit } from "./auditService";
import { mockPaymentAdapter } from "./paymentAdapter";

type Tx = Prisma.TransactionClient;

export const FIXED_SERVICE_FEE_AMOUNT = 50;
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
  comment?: string,
  bonusExpiresAt?: Date | null
) {
  if (amount <= 0) {
    throw new HttpError(400, "Сумма должна быть больше нуля", "amount_invalid");
  }
  if (!reason.trim()) {
    throw new HttpError(400, "Укажите причину начисления", "reason_required");
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
        comment,
        balanceBefore,
        balanceAfter,
        bonusExpiresAt: bonusExpiresAt ?? undefined,
        createdByAdminId: adminId
      }
    });
    await writeAudit(adminId, "balance.admin_bonus", "user", userId, {
      amount,
      reason,
      comment,
      balanceBefore,
      balanceAfter,
      bonusExpiresAt
    }, tx);
  });

  return getBalanceSummary(userId);
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

  if (bonusCharge > 0) {
    await tx.balanceTransaction.create({
      data: {
        userId: payerUserId,
        type: options.type ?? "commission_charge",
        amount: -bonusCharge,
        balanceKind: "bonus",
        reason,
        comment: options.comment ?? "Автоматическое списание после двойного подтверждения условий",
        balanceBefore: payer.bonusBalance,
        balanceAfter: payer.bonusBalance - bonusCharge,
        relatedRequestId
      }
    });
  }

  if (realCharge > 0) {
    await tx.balanceTransaction.create({
      data: {
        userId: payerUserId,
        type: options.type ?? "commission_charge",
        amount: -realCharge,
        balanceKind: "real",
        reason,
        comment: options.comment ?? "Автоматическое списание после двойного подтверждения условий",
        balanceBefore: payer.balance,
        balanceAfter: payer.balance - realCharge,
        relatedRequestId
      }
    });
  }

  await writeAudit(actorUserId, "balance.commission_charge", "request", relatedRequestId, {
    payerUserId,
    amount,
    bonusCharge,
    realCharge
  }, tx);

  return { bonusCharge, realCharge };
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
