import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma";

export const USER_ARCHIVE_WAIT_DAYS = 60;

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

function latestDate(...dates: Array<Date | null>) {
  const timestamps = dates.filter((date): date is Date => Boolean(date)).map((date) => date.getTime());
  return timestamps.length ? new Date(Math.max(...timestamps)) : null;
}
