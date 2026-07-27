import { prisma } from "../db/prisma";
import { writeAudit } from "./auditService";
import { getUserArchiveSafety } from "./userLifecycleService";

export async function archiveSafePendingUsers(actorUserId: string) {
  const candidates = await prisma.user.findMany({
    where: { status: "pending_archive", archivedAt: null },
    select: { id: true }
  });
  let archivedCount = 0;
  for (const candidate of candidates) {
    const archived = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id: candidate.id }, select: { status: true } });
      if (current?.status !== "pending_archive") return false;
      const safety = await getUserArchiveSafety(candidate.id, tx);
      if (!safety.canArchive) {
        await tx.user.update({
          where: { id: candidate.id },
          data: { archiveBlockedReason: safety.reasons.join(" ") }
        });
        return false;
      }
      await tx.user.update({
        where: { id: candidate.id },
        data: { status: "archived", archivedAt: new Date(), archivedByAdminId: actorUserId, archiveBlockedReason: null }
      });
      await writeAudit(actorUserId, "user.archived", "user", candidate.id, { source: "archive_run", safety }, tx);
      return true;
    });
    if (archived) archivedCount += 1;
  }
  return archivedCount;
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
