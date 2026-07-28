import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma";
import { HttpError } from "../utils/http";
import { writeAudit } from "./auditService";

export const USER_ARCHIVE_WAIT_DAYS = 60;
export const OAUTH_PENDING_CANCEL_ARCHIVE_REASON = "Незавершённая VK-регистрация отменена администратором";

const ACTIVE_REQUEST_STATUSES = [
  "draft",
  "published",
  "waiting_for_responses",
  "has_responses",
  "open",
  "responded",
  "chatting",
  "discussion",
  "terms_confirmed_by_customer",
  "accepted_by_helper",
  "waiting_client_balance",
  "waiting_performer_balance",
  "in_work",
  "in_progress",
  "disputed",
  "dispute",
  "blocked"
];

const ACTIVE_CHAT_STATUSES = [
  "open",
  "waiting_client_confirmation",
  "waiting_performer_confirmation",
  "waiting_client_balance",
  "waiting_performer_balance",
  "in_work",
  "dispute"
];

const PENDING_PAYMENT_STATUSES = ["created", "pending", "manual_review"];

type DbClient = PrismaClient | Prisma.TransactionClient;

export type UserArchiveSafety = {
  canArchive: boolean;
  reasons: string[];
  balance: number;
  bonusBalance: number;
  activeRequestsCount: number;
  activeChatsCount: number;
  pendingPaymentsCount: number;
  openComplaintsCount: number;
  daysSinceBlockedOrRequested: number | null;
  requiredWaitDays: number;
};

export type OAuthPendingCancellationSafety = {
  canCancel: boolean;
  reasons: string[];
  counts: {
    requests: number;
    responses: number;
    chats: number;
    chatMessages: number;
    payments: number;
    balanceTransactions: number;
    consents: number;
    legalConsents: number;
    complaints: number;
    documents: number;
    reviews: number;
    profileRecords: number;
  };
};

export type OAuthPendingRestoreSafety = {
  canRestore: boolean;
  reasons: string[];
  counts: OAuthPendingCancellationSafety["counts"] & { riskFlags: number };
};

export async function getUserArchiveSafety(userId: string, client: DbClient = prisma): Promise<UserArchiveSafety> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      balance: true,
      bonusBalance: true,
      blockedAt: true,
      archiveRequestedAt: true
    }
  });
  if (!user) throw new Error("user_not_found");

  const [activeRequestsCount, activeChatsCount, pendingPaymentsCount, openComplaintsCount] = await Promise.all([
    client.clientRequest.count({
      where: {
        status: { in: ACTIVE_REQUEST_STATUSES },
        OR: [
          { clientId: userId },
          { selectedPerformerId: userId },
          { responses: { some: { performerId: userId } } }
        ]
      }
    }),
    client.chat.count({
      where: {
        status: { in: ACTIVE_CHAT_STATUSES },
        OR: [{ clientId: userId }, { performerId: userId }]
      }
    }),
    client.paymentTransaction.count({
      where: {
        userId,
        OR: [
          { status: { in: PENDING_PAYMENT_STATUSES } },
          { status: "succeeded", creditedAt: null }
        ]
      }
    }),
    client.complaint.count({
      where: {
        status: { notIn: ["resolved", "rejected"] },
        OR: [{ fromUserId: userId }, { againstUserId: userId }]
      }
    })
  ]);

  const waitStartedAt = latestDate(user.blockedAt, user.archiveRequestedAt);
  const daysSinceBlockedOrRequested = waitStartedAt
    ? Math.floor((Date.now() - waitStartedAt.getTime()) / 86_400_000)
    : null;
  const reasons: string[] = [];

  if (user.balance !== 0) reasons.push("У пользователя есть остаток на основном балансе.");
  if (user.bonusBalance !== 0) reasons.push("У пользователя есть остаток на бонусном балансе.");
  if (activeRequestsCount > 0) reasons.push(`Есть активные заявки: ${activeRequestsCount}.`);
  if (activeChatsCount > 0) reasons.push(`Есть активные чаты: ${activeChatsCount}.`);
  if (pendingPaymentsCount > 0) reasons.push(`Есть незавершённые платежи: ${pendingPaymentsCount}.`);
  if (openComplaintsCount > 0) reasons.push(`Есть открытые обращения или споры: ${openComplaintsCount}.`);
  if (daysSinceBlockedOrRequested === null || daysSinceBlockedOrRequested < USER_ARCHIVE_WAIT_DAYS) {
    reasons.push("Архивирование возможно не ранее чем через 60 дней после блокировки или запроса на архивирование.");
  }

  return {
    canArchive: reasons.length === 0,
    reasons,
    balance: user.balance,
    bonusBalance: user.bonusBalance,
    activeRequestsCount,
    activeChatsCount,
    pendingPaymentsCount,
    openComplaintsCount,
    daysSinceBlockedOrRequested,
    requiredWaitDays: USER_ARCHIVE_WAIT_DAYS
  };
}

export async function getOAuthPendingCancellationSafety(
  userId: string,
  client: DbClient = prisma
): Promise<OAuthPendingCancellationSafety> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      rolesJson: true,
      status: true,
      cityId: true,
      balance: true,
      bonusBalance: true,
      clientProfile: { select: { userId: true } },
      performerProfile: { select: { userId: true } },
      identities: { where: { provider: "vk" }, select: { id: true } },
      userCities: { select: { id: true } }
    }
  });
  if (!user) throw new Error("user_not_found");

  const [
    requests,
    responses,
    chats,
    chatMessages,
    payments,
    balanceTransactions,
    consents,
    legalConsents,
    complaints,
    documents,
    reviews
  ] = await Promise.all([
    client.clientRequest.count({ where: { OR: [{ clientId: userId }, { selectedPerformerId: userId }] } }),
    client.requestResponse.count({ where: { performerId: userId } }),
    client.chat.count({ where: { OR: [{ clientId: userId }, { performerId: userId }] } }),
    client.chatMessage.count({ where: { senderId: userId } }),
    client.paymentTransaction.count({ where: { userId } }),
    client.balanceTransaction.count({ where: { userId } }),
    client.consent.count({ where: { userId } }),
    client.userConsent.count({ where: { userId } }),
    client.complaint.count({ where: { OR: [{ fromUserId: userId }, { againstUserId: userId }] } }),
    client.performerDocument.count({ where: { performerId: userId } }),
    client.review.count({ where: { OR: [{ fromUserId: userId }, { toUserId: userId }] } })
  ]);
  const profileRecords = Number(Boolean(user.clientProfile)) + Number(Boolean(user.performerProfile)) + user.userCities.length;
  const counts = {
    requests,
    responses,
    chats,
    chatMessages,
    payments,
    balanceTransactions,
    consents,
    legalConsents,
    complaints,
    documents,
    reviews,
    profileRecords
  };
  const reasons: string[] = [];
  if (user.role !== "oauth_pending") reasons.push("Роль пользователя уже выбрана.");
  if (hasStoredRoles(user.rolesJson)) reasons.push("Пользователю уже назначались роли.");
  if (user.status !== "active") reasons.push("Профиль уже не является активной незавершённой регистрацией.");
  if (user.identities.length === 0) reasons.push("Профиль не связан с VK ID.");
  if (user.cityId) reasons.push("У пользователя уже выбран город.");
  if (user.balance !== 0 || user.bonusBalance !== 0) reasons.push("У пользователя есть остаток на балансе.");
  if (Object.values(counts).some((count) => count > 0)) {
    reasons.push("У пользователя уже есть история действий.");
  }

  return { canCancel: reasons.length === 0, reasons, counts };
}

export async function getArchivedOAuthPendingRestoreSafety(
  userId: string,
  client: DbClient = prisma
): Promise<OAuthPendingRestoreSafety> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      rolesJson: true,
      status: true,
      cityId: true,
      balance: true,
      bonusBalance: true,
      blockedAt: true,
      blockReason: true,
      archiveReason: true,
      clientProfile: { select: { userId: true } },
      performerProfile: { select: { userId: true } },
      identities: { where: { provider: "vk" }, select: { id: true } },
      userCities: { select: { id: true } }
    }
  });
  if (!user) throw new HttpError(404, "Пользователь не найден", "user_not_found");

  const [
    requests,
    responses,
    chats,
    chatMessages,
    payments,
    balanceTransactions,
    consents,
    legalConsents,
    complaints,
    documents,
    reviews,
    riskFlags
  ] = await Promise.all([
    client.clientRequest.count({ where: { OR: [{ clientId: userId }, { selectedPerformerId: userId }] } }),
    client.requestResponse.count({ where: { performerId: userId } }),
    client.chat.count({ where: { OR: [{ clientId: userId }, { performerId: userId }] } }),
    client.chatMessage.count({ where: { senderId: userId } }),
    client.paymentTransaction.count({ where: { userId } }),
    client.balanceTransaction.count({ where: { userId } }),
    client.consent.count({ where: { userId } }),
    client.userConsent.count({ where: { userId } }),
    client.complaint.count({ where: { OR: [{ fromUserId: userId }, { againstUserId: userId }] } }),
    client.performerDocument.count({ where: { performerId: userId } }),
    client.review.count({ where: { OR: [{ fromUserId: userId }, { toUserId: userId }] } }),
    client.userRiskFlag.count({ where: { userId } })
  ]);
  const profileRecords = Number(Boolean(user.clientProfile)) + Number(Boolean(user.performerProfile)) + user.userCities.length;
  const counts = {
    requests,
    responses,
    chats,
    chatMessages,
    payments,
    balanceTransactions,
    consents,
    legalConsents,
    complaints,
    documents,
    reviews,
    profileRecords,
    riskFlags
  };
  const reasons: string[] = [];
  if (user.status !== "archived") reasons.push("Профиль не находится в архиве.");
  if (user.role !== "oauth_pending") reasons.push("Регистрация уже была завершена.");
  if (hasStoredRoles(user.rolesJson)) reasons.push("Пользователю уже назначались роли.");
  if (user.archiveReason !== OAUTH_PENDING_CANCEL_ARCHIVE_REASON) {
    reasons.push("Профиль был архивирован не как отменённая незавершённая VK-регистрация.");
  }
  if (user.identities.length === 0) reasons.push("Профиль не связан с VK ID.");
  if (user.cityId) reasons.push("У пользователя уже выбран город.");
  if (user.blockedAt || user.blockReason) reasons.push("Профиль имеет историю блокировки.");
  if (user.balance !== 0 || user.bonusBalance !== 0) reasons.push("У пользователя есть остаток на балансе.");
  if (Object.values(counts).some((count) => count > 0)) reasons.push("У пользователя уже есть история действий.");

  return { canRestore: reasons.length === 0, reasons, counts };
}

export async function restoreArchivedOAuthPendingUser(input: {
  userId: string;
  actorUserId: string | null;
  source: "vk_callback" | "admin_panel";
  providerUserId?: string;
}, client: DbClient = prisma) {
  const safety = await getArchivedOAuthPendingRestoreSafety(input.userId, client);
  if (!safety.canRestore) {
    throw new HttpError(
      400,
      "Регистрация через VK ранее была остановлена. Обратитесь в поддержку или войдите другим способом.",
      "oauth_pending_restore_not_allowed",
      safety
    );
  }

  const user = await client.user.update({
    where: { id: input.userId },
    data: {
      status: "active",
      archivedAt: null,
      archivedByAdminId: null,
      archiveReason: null,
      archiveRequestedAt: null,
      archiveRequestedByAdminId: null,
      archiveBlockedReason: null
    }
  });
  const action = input.source === "vk_callback"
    ? "auth.oauth_pending.restore_for_retry"
    : "admin.oauth_pending.restore";
  await writeAudit(input.actorUserId, action, "user", user.id, {
    provider: "vk",
    userId: user.id,
    providerUserId: input.providerUserId ?? null,
    source: input.source,
    safety
  }, client);
  return { user, safety };
}

function latestDate(...dates: Array<Date | null>) {
  const timestamps = dates.filter((date): date is Date => Boolean(date)).map((date) => date.getTime());
  return timestamps.length ? new Date(Math.max(...timestamps)) : null;
}

function hasStoredRoles(rolesJson: string) {
  try {
    const roles = JSON.parse(rolesJson);
    return Array.isArray(roles) && roles.length > 0;
  } catch {
    return true;
  }
}
