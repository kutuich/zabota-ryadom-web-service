import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma";
import { writeAudit } from "./auditService";
import { HttpError } from "../utils/http";

type Db = PrismaClient | Prisma.TransactionClient;

export async function reconcileDueVisits(client: Db = prisma, now = new Date()) {
  const skippedDisputed = await client.requestVisit.count({
    where: { autoCloseAt: { lte: now }, OR: [{ status: "disputed" }, { disputes: { some: { status: "open" } } }] }
  });
  const due = await client.requestVisit.findMany({
    where: { status: { in: ["scheduled", "in_work"] }, autoCloseAt: { lte: now }, disputes: { none: { status: "open" } } },
    select: { id: true }
  });
  let closed = 0;
  for (const item of due) {
    const execute = async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.requestVisit.updateMany({
        where: { id: item.id, status: { in: ["scheduled", "in_work"] }, autoCloseAt: { lte: now }, disputes: { none: { status: "open" } } },
        data: { status: "completed", closedAt: now }
      });
      if (!claimed.count) return false;
      await tx.serviceFeeVisitAllocation.updateMany({ where: { visitId: item.id, status: "reserved" }, data: { status: "released", releasedAt: now } });
      await writeAudit(null, "request_visit.auto_close", "requestVisit", item.id, { closedAt: now, note: "Визит автоматически закрыт для внутреннего учёта, поскольку по нему не зафиксировано отмены или спора." }, tx);
      return true;
    };
    const result = "$transaction" in client
      ? await (client as PrismaClient).$transaction(execute)
      : await execute(client as Prisma.TransactionClient);
    if (result) closed += 1;
  }
  return { checked: due.length, closed, skippedDisputed };
}

export async function reserveSummary(client: Db = prisma) {
  const allocations = await client.serviceFeeVisitAllocation.findMany({ select: { status: true, mainBalanceAmount: true, bonusBalanceAmount: true, feeAmount: true } });
  const totals = { charged: 0, mainFunded: 0, bonusFunded: 0, reserved: 0, disputed: 0, released: 0, refunded: 0, compensated: 0 };
  for (const row of allocations) {
    totals.charged += row.feeAmount;
    totals.mainFunded += row.mainBalanceAmount;
    totals.bonusFunded += row.bonusBalanceAmount;
    if (row.status in totals) (totals as any)[row.status] += row.feeAmount;
  }
  return {
    ...totals,
    moneyReserve: allocations.filter((row) => ["reserved", "disputed"].includes(row.status)).reduce((sum, row) => sum + row.mainBalanceAmount, 0),
    bonusObligations: allocations.filter((row) => ["reserved", "disputed"].includes(row.status)).reduce((sum, row) => sum + row.bonusBalanceAmount, 0),
    operationalRisk: allocations.filter((row) => ["reserved", "disputed"].includes(row.status)).reduce((sum, row) => sum + row.feeAmount, 0)
  };
}

export async function openVisitDispute(visitId: string, actor: { id: string; role: string }, reason: string, description?: string | null) {
  return prisma.$transaction(async (tx) => {
    const visit = await tx.requestVisit.findUnique({ where: { id: visitId }, include: { request: { select: { clientId: true, selectedPerformerId: true } } } });
    if (!visit) throw new HttpError(404, "Визит не найден", "visit_not_found");
    const isParticipant = visit.request.clientId === actor.id || visit.request.selectedPerformerId === actor.id;
    if (!isParticipant && !["admin", "superadmin"].includes(actor.role)) throw new HttpError(403, "Нет доступа к визиту", "forbidden");
    if (["cancelled"].includes(visit.status)) throw new HttpError(400, "По отменённому визиту нельзя открыть спор", "visit_dispute_unavailable");
    const existing = await tx.requestVisitDispute.findFirst({ where: { visitId, status: "open" } });
    if (existing) return existing;
    const dispute = await tx.requestVisitDispute.create({ data: { requestId: visit.requestId, visitId, openedByUserId: actor.id, reason, description: description?.trim() || null } });
    await tx.requestVisit.update({ where: { id: visitId }, data: { status: "disputed", disputedAt: new Date() } });
    await tx.serviceFeeVisitAllocation.updateMany({ where: { visitId, status: { in: ["reserved", "released"] } }, data: { status: "disputed", disputedAt: new Date() } });
    await writeAudit(actor.id, "request_visit.dispute_open", "requestVisitDispute", dispute.id, { visitId, reason }, tx);
    return dispute;
  });
}

export async function resolveVisitDispute(disputeId: string, adminId: string, resolution: "keep_fee" | "return_to_source", comment: string) {
  return prisma.$transaction(async (tx) => {
    const dispute = await tx.requestVisitDispute.findUnique({ where: { id: disputeId }, include: { visit: { include: { allocations: true } } } });
    if (!dispute) throw new HttpError(404, "Спор не найден", "visit_dispute_not_found");
    if (dispute.status !== "open") return dispute;
    if (resolution === "return_to_source") {
      for (const allocation of dispute.visit.allocations) {
        if (allocation.status === "refunded") continue;
        const ledgerIds: string[] = [];
        if (allocation.mainBalanceAmount > 0) {
          const before = await tx.user.findUniqueOrThrow({ where: { id: allocation.userId }, select: { balance: true } });
          await tx.user.update({ where: { id: allocation.userId }, data: { balance: { increment: allocation.mainBalanceAmount } } });
          const ledger = await tx.balanceTransaction.create({ data: { userId: allocation.userId, type: "service_fee_refund", amount: allocation.mainBalanceAmount, balanceKind: "real", reason: "Возврат сервисного сбора по решению администратора", comment, balanceBefore: before.balance, balanceAfter: before.balance + allocation.mainBalanceAmount, relatedRequestId: dispute.requestId, createdByAdminId: adminId, idempotencyKey: `visit_allocation_refund:${allocation.id}:main` } });
          ledgerIds.push(ledger.id);
        }
        if (allocation.bonusBalanceAmount > 0) {
          const before = await tx.user.findUniqueOrThrow({ where: { id: allocation.userId }, select: { bonusBalance: true } });
          await tx.user.update({ where: { id: allocation.userId }, data: { bonusBalance: { increment: allocation.bonusBalanceAmount } } });
          const ledger = await tx.balanceTransaction.create({ data: { userId: allocation.userId, type: "service_fee_refund", amount: allocation.bonusBalanceAmount, balanceKind: "bonus", reason: "Возврат сервисного сбора по решению администратора", comment, balanceBefore: before.bonusBalance, balanceAfter: before.bonusBalance + allocation.bonusBalanceAmount, relatedRequestId: dispute.requestId, createdByAdminId: adminId, idempotencyKey: `visit_allocation_refund:${allocation.id}:bonus` } });
          ledgerIds.push(ledger.id);
        }
        await tx.serviceFeeVisitAllocation.update({ where: { id: allocation.id }, data: { status: "refunded", refundedAt: new Date(), resolution, resolutionComment: comment, refundLedgerEntriesJson: JSON.stringify(ledgerIds) } });
      }
    } else {
      await tx.serviceFeeVisitAllocation.updateMany({ where: { visitId: dispute.visitId, status: "disputed" }, data: { status: "released", releasedAt: new Date(), resolution, resolutionComment: comment } });
    }
    await tx.requestVisit.update({ where: { id: dispute.visitId }, data: { status: "completed", closedAt: new Date() } });
    const result = await tx.requestVisitDispute.update({ where: { id: dispute.id }, data: { status: "resolved", resolution, resolutionComment: comment, resolvedByAdminId: adminId, resolvedAt: new Date() } });
    await writeAudit(adminId, "request_visit.dispute_resolve", "requestVisitDispute", dispute.id, { resolution, comment }, tx);
    return result;
  });
}
