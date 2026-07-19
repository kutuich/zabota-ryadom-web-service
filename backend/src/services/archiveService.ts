import { prisma } from "../db/prisma";
import { writeAudit } from "./auditService";

export async function archiveInactiveUsersOlderThan90Days(actorUserId: string) {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - 90);

  const result = await prisma.user.updateMany({
    where: {
      status: "active",
      archivedAt: null,
      OR: [{ lastSeenAt: { lt: threshold } }, { lastSeenAt: null, createdAt: { lt: threshold } }]
    },
    data: {
      status: "archived",
      archivedAt: new Date()
    }
  });

  await writeAudit(actorUserId, "archive.inactive_users", "user", null, { count: result.count, threshold });
  return result.count;
}

export async function archiveCompletedRequestsOlderThanNdays(actorUserId: string, days = 30) {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - days);

  const result = await prisma.clientRequest.updateMany({
    where: {
      archivedAt: null,
      OR: [
        { status: "completed", completedAt: { lt: threshold } },
        { status: "cancelled", cancelledAt: { lt: threshold } }
      ]
    },
    data: { archivedAt: new Date() }
  });

  await writeAudit(actorUserId, "archive.completed_requests", "request", null, { count: result.count, days });
  return result.count;
}
