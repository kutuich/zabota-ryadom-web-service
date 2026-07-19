import { Router } from "express";
import { z } from "zod";
import { authenticate, requireAdmin } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { writeAudit } from "../services/auditService";
import { asyncHandler, HttpError } from "../utils/http";

export const complaintsRouter = Router();

complaintsRouter.use(authenticate);

complaintsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const where = ["admin", "superadmin"].includes(req.user!.role)
      ? {}
      : { OR: [{ fromUserId: req.user!.id }, { againstUserId: req.user!.id }] };

    const complaints = await prisma.complaint.findMany({
      where,
      include: {
        request: { select: { id: true, publicNumber: true, title: true, status: true } },
        chat: { select: { id: true, status: true } },
        fromUser: { select: { id: true, displayName: true, role: true } },
        againstUser: { select: { id: true, displayName: true, role: true } }
      },
      orderBy: { createdAt: "desc" }
    });

    res.json(complaints);
  })
);

complaintsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = z.object({
      type: z.enum([
        "message",
        "question",
        "complaint",
        "suggestion",
        "payment_problem",
        "request_problem",
        "client_problem",
        "performer_problem",
        "technical_problem",
        "other"
      ]).default("complaint"),
      requestId: z.string().optional(),
      chatId: z.string().optional(),
      againstUserId: z.string().optional(),
      reason: z.string().min(3).max(200),
      description: z.string().max(2000).optional()
    }).parse(req.body);

    if (input.type === "complaint" && !input.requestId && !input.chatId) {
      throw new HttpError(400, "Жалобу лучше связать с заявкой или чатом", "complaint_target_required");
    }

    const complaint = await prisma.$transaction(async (tx) => {
      const publicNumber = await nextSupportPublicNumber(tx);
      return tx.complaint.create({
        data: {
          publicNumber,
          type: input.type,
          requestId: input.requestId,
          chatId: input.chatId,
          fromUserId: req.user!.id,
          againstUserId: input.againstUserId,
          reason: input.reason,
          description: input.description,
          status: "new"
        }
      });
    });

    await writeAudit(req.user!.id, "complaint.create", "complaint", complaint.id, input);
    res.status(201).json(complaint);
  })
);

async function nextSupportPublicNumber(tx: any) {
  const year = new Date().getFullYear();
  const prefix = `SUP-${year}-`;
  const rows = await tx.complaint.findMany({
    where: { publicNumber: { startsWith: prefix } },
    select: { publicNumber: true }
  });
  const max = rows.reduce((current: number, row: { publicNumber: string | null }) => {
    const number = Number(row.publicNumber?.slice(prefix.length));
    return Number.isFinite(number) ? Math.max(current, number) : current;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

complaintsRouter.patch(
  "/:id/resolve",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = z.object({
      status: z.enum(["resolved", "rejected", "in_review", "awaiting_user"]),
      adminComment: z.string().max(2000).optional(),
      adminResponse: z.string().max(2000).optional()
    }).parse(req.body);

    const complaint = await prisma.complaint.update({
      where: { id: req.params.id },
      data: {
        status: input.status,
        resolvedAt: input.status === "resolved" ? new Date() : null,
        adminComment: input.adminComment,
        adminResponse: input.adminResponse
      }
    });

    await writeAudit(req.user!.id, "complaint.resolve", "complaint", complaint.id, input);
    res.json(complaint);
  })
);
