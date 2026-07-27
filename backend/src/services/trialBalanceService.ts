import { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { HttpError } from "../utils/http";

export const TRIAL_BALANCE_SETTING_KEY = "trialBalanceSettings";
export const TRIAL_BALANCE_DESCRIPTION = "Пробный баланс для знакомства с сервисом";

export type TrialBalanceSource = "registration" | "oauth_complete" | "admin_bulk" | "admin_manual";

export type TrialBalanceSettings = {
  enabled: boolean;
  amount: number;
  autoGrantNewUsers: boolean;
  lastBulkGrantAt: string | null;
};

export type TrialGrantResult = {
  granted: boolean;
  reason: "granted" | "already_granted" | "disabled" | "invalid_user" | "blocked" | "admin_skipped";
};

export async function getTrialBalanceSettings(): Promise<TrialBalanceSettings> {
  const setting = await prisma.serviceSetting.findUnique({ where: { key: TRIAL_BALANCE_SETTING_KEY } });
  if (!setting) return defaultTrialBalanceSettings();
  return parseTrialBalanceSettings(setting.valueJson);
}

export async function updateTrialBalanceSettings(input: {
  enabled: boolean;
  amount: number;
  autoGrantNewUsers: boolean;
}): Promise<TrialBalanceSettings> {
  if (!Number.isInteger(input.amount) || input.amount !== 100) {
    throw new HttpError(400, "Сумма пробного баланса должна быть 100 ₽", "trial_balance_amount_invalid");
  }
  const current = await getTrialBalanceSettings();
  const next: TrialBalanceSettings = {
    enabled: input.enabled,
    amount: input.amount,
    autoGrantNewUsers: input.autoGrantNewUsers,
    lastBulkGrantAt: current.lastBulkGrantAt
  };
  await saveTrialBalanceSettings(next);
  return next;
}

export async function getTrialBalanceAdminView() {
  const [settings, totalUsers, usersWithTrialBonus, eligibleUsers] = await Promise.all([
    getTrialBalanceSettings(),
    prisma.user.count(),
    prisma.user.count({ where: { balanceTransactions: { some: { type: "trial_bonus" } } } }),
    prisma.user.count({
      where: {
        role: { in: ["client", "performer"] },
        status: "active",
        blockedAt: null,
        balanceTransactions: { none: { type: "trial_bonus" } }
      }
    })
  ]);
  return { ...settings, totals: { totalUsers, usersWithTrialBonus, eligibleUsers } };
}

export async function grantTrialBalanceToUser(
  userId: string,
  source: TrialBalanceSource,
  adminId?: string
): Promise<TrialGrantResult> {
  const settings = await getTrialBalanceSettings();
  const isAutomatic = source === "registration" || source === "oauth_complete";
  if (!settings.enabled || (isAutomatic && !settings.autoGrantNewUsers)) {
    return { granted: false, reason: "disabled" };
  }
  if (!Number.isInteger(settings.amount) || settings.amount <= 0) {
    return { granted: false, reason: "disabled" };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true, status: true, blockedAt: true, bonusBalance: true }
      });
      if (!user) return { granted: false, reason: "invalid_user" } as const;
      if (["admin", "superadmin", "oauth_pending"].includes(user.role)) {
        return { granted: false, reason: "admin_skipped" } as const;
      }
      if (user.status !== "active" || user.blockedAt) {
        return { granted: false, reason: "blocked" } as const;
      }

      const idempotencyKey = trialBalanceIdempotencyKey(userId);
      const existing = await tx.balanceTransaction.findFirst({
        where: { OR: [{ idempotencyKey }, { userId, type: "trial_bonus" }] },
        select: { id: true }
      });
      if (existing) return { granted: false, reason: "already_granted" } as const;

      const balanceBefore = user.bonusBalance;
      const balanceAfter = balanceBefore + settings.amount;
      await tx.balanceTransaction.create({
        data: {
          userId,
          type: "trial_bonus",
          source,
          idempotencyKey,
          amount: settings.amount,
          balanceKind: "bonus",
          reason: TRIAL_BALANCE_DESCRIPTION,
          comment: source,
          balanceBefore,
          balanceAfter,
          createdByAdminId: adminId
        }
      });
      await tx.user.update({ where: { id: userId }, data: { bonusBalance: { increment: settings.amount } } });
      await tx.auditLog.create({
        data: {
          actorUserId: adminId ?? userId,
          action: "balance.trial_bonus",
          entityType: "user",
          entityId: userId,
          payloadJson: JSON.stringify({ amount: settings.amount, source, idempotencyKey })
        }
      });
      return { granted: true, reason: "granted" } as const;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { granted: false, reason: "already_granted" };
    }
    throw error;
  }
}

export async function grantTrialBalanceToEligibleUsers(adminId: string) {
  const settings = await getTrialBalanceSettings();
  if (!settings.enabled) {
    throw new HttpError(409, "Сначала включите пробный период", "trial_balance_disabled");
  }

  const users = await prisma.user.findMany({
    select: { id: true, role: true, status: true, blockedAt: true },
    orderBy: { createdAt: "asc" }
  });
  const summary = {
    checked: users.length,
    granted: 0,
    skippedAlreadyGranted: 0,
    skippedBlocked: 0,
    skippedAdmin: 0,
    errors: [] as Array<{ userId: string; message: string }>
  };

  for (const user of users) {
    if (["admin", "superadmin", "oauth_pending"].includes(user.role)) {
      summary.skippedAdmin += 1;
      continue;
    }
    if (user.status !== "active" || user.blockedAt) {
      summary.skippedBlocked += 1;
      continue;
    }
    try {
      const result = await grantTrialBalanceToUser(user.id, "admin_bulk", adminId);
      if (result.granted) summary.granted += 1;
      else if (result.reason === "already_granted") summary.skippedAlreadyGranted += 1;
      else if (result.reason === "blocked") summary.skippedBlocked += 1;
      else summary.errors.push({ userId: user.id, message: result.reason });
    } catch (error) {
      summary.errors.push({ userId: user.id, message: error instanceof Error ? error.message : "unknown_error" });
    }
  }

  await saveTrialBalanceSettings({ ...settings, lastBulkGrantAt: new Date().toISOString() });
  return summary;
}

export function trialBalanceIdempotencyKey(userId: string) {
  return `trial_bonus:${userId}`;
}

function defaultTrialBalanceSettings(): TrialBalanceSettings {
  const amount = Number.isInteger(env.trialBalanceAmount) && env.trialBalanceAmount > 0 ? env.trialBalanceAmount : 100;
  return {
    enabled: env.trialBalanceEnabled,
    amount,
    autoGrantNewUsers: env.trialBalanceEnabled,
    lastBulkGrantAt: null
  };
}

function parseTrialBalanceSettings(valueJson: string): TrialBalanceSettings {
  try {
    const parsed = JSON.parse(valueJson) as Partial<TrialBalanceSettings>;
    const defaults = defaultTrialBalanceSettings();
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : defaults.enabled,
      amount: Number.isInteger(parsed.amount) && Number(parsed.amount) > 0 ? Number(parsed.amount) : defaults.amount,
      autoGrantNewUsers: typeof parsed.autoGrantNewUsers === "boolean" ? parsed.autoGrantNewUsers : defaults.autoGrantNewUsers,
      lastBulkGrantAt: typeof parsed.lastBulkGrantAt === "string" ? parsed.lastBulkGrantAt : null
    };
  } catch {
    return defaultTrialBalanceSettings();
  }
}

function saveTrialBalanceSettings(settings: TrialBalanceSettings) {
  return prisma.serviceSetting.upsert({
    where: { key: TRIAL_BALANCE_SETTING_KEY },
    create: {
      key: TRIAL_BALANCE_SETTING_KEY,
      valueJson: JSON.stringify(settings),
      label: "Пробный период",
      group: "balance"
    },
    update: {
      valueJson: JSON.stringify(settings),
      label: "Пробный период",
      group: "balance"
    }
  });
}
