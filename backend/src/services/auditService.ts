import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

type AuditClient = Prisma.TransactionClient | typeof prisma;

export async function writeAudit(
  actorUserId: string | null,
  action: string,
  entityType: string,
  entityId?: string | null,
  payload?: unknown,
  client: AuditClient = prisma
) {
  await client.auditLog.create({
    data: {
      actorUserId,
      action,
      entityType,
      entityId: entityId ?? null,
      payloadJson: payload ? JSON.stringify(payload) : null
    }
  });
}
