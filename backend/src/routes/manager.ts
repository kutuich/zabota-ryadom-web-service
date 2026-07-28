import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { writeAudit } from "../services/auditService";
import { blockUser, unblockUser } from "../services/userAccessService";
import { serializeAgreedTerms } from "../services/agreementTermsService";

export const managerRouter = Router();

managerRouter.use(authenticate, requireRole("manager"));

managerRouter.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    const [usersTotal, requestsTotal, chatsTotal, complaintsTotal, paymentsTotal, blockedUsersTotal] = await Promise.all([
      prisma.user.count(),
      prisma.clientRequest.count(),
      prisma.chat.count(),
      prisma.complaint.count(),
      prisma.paymentTransaction.count(),
      prisma.user.count({ where: { status: "blocked" } })
    ]);
    res.json({ usersTotal, requestsTotal, chatsTotal, complaintsTotal, paymentsTotal, blockedUsersTotal });
  })
);

managerRouter.get(
  "/users",
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        role: true,
        displayName: true,
        phone: true,
        email: true,
        cityId: true,
        status: true,
        balance: true,
        bonusBalance: true,
        createdAt: true,
        blockedAt: true,
        blockedByAdminId: true,
        blockedByRole: true,
        blockReason: true,
        city: true,
        identities: { select: { provider: true, displayName: true, createdAt: true } },
        riskFlags: { where: { resolvedAt: null }, orderBy: { createdAt: "desc" } }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    res.json(users);
  })
);

managerRouter.get(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        role: true,
        displayName: true,
        phone: true,
        email: true,
        cityId: true,
        status: true,
        balance: true,
        bonusBalance: true,
        createdAt: true,
        blockedAt: true,
        blockedByAdminId: true,
        blockedByRole: true,
        blockReason: true,
        city: true,
        clientProfile: true,
        performerProfile: true,
        identities: { select: { provider: true, displayName: true, createdAt: true } },
        riskFlags: { orderBy: { createdAt: "desc" } }
      }
    });
    if (!user) throw new HttpError(404, "Пользователь не найден", "user_not_found");
    const actionHistory = await prisma.auditLog.findMany({
      where: { OR: [{ actorUserId: user.id }, { entityType: "user", entityId: user.id }] },
      orderBy: { createdAt: "desc" },
      take: 30
    });
    await managerViewAudit(req.user!.id, "manager.user.view", "user", user.id);
    res.json({ ...user, actionHistory });
  })
);

managerRouter.post(
  "/users/:id/block",
  asyncHandler(async (req, res) => {
    const input = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);
    const user = await blockUser({ id: req.user!.id, role: "manager" }, req.params.id, input.reason);
    const { passwordHash: _passwordHash, ...safeUser } = user;
    res.json(safeUser);
  })
);

managerRouter.post(
  "/users/:id/unblock",
  asyncHandler(async (req, res) => {
    const user = await unblockUser({ id: req.user!.id, role: "manager" }, req.params.id);
    const { passwordHash: _passwordHash, ...safeUser } = user;
    res.json(safeUser);
  })
);

managerRouter.get(
  "/requests",
  asyncHandler(async (_req, res) => {
    const requests = await prisma.clientRequest.findMany({
      include: {
        city: true,
        category: true,
        client: { select: { id: true, displayName: true, phone: true } },
        selectedPerformer: { select: { id: true, displayName: true, phone: true } },
        chats: { orderBy: { createdAt: "desc" }, take: 1 }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    res.json(requests.map((request) => ({
      ...request,
      chat: request.chats[0]
        ? { ...request.chats[0], agreedTerms: serializeAgreedTerms(request.chats[0]) }
        : null
    })));
  })
);

managerRouter.get(
  "/requests/:id",
  asyncHandler(async (req, res) => {
    const request = await prisma.clientRequest.findUnique({
      where: { id: req.params.id },
      include: {
        city: true,
        category: true,
        client: { select: { id: true, displayName: true, phone: true, email: true } },
        selectedPerformer: { select: { id: true, displayName: true, phone: true, email: true } },
        responses: { include: { performer: { select: { id: true, displayName: true } } } },
        chats: { orderBy: { createdAt: "desc" } }
      }
    });
    if (!request) throw new HttpError(404, "Заявка не найдена", "request_not_found");
    await managerViewAudit(req.user!.id, "manager.request.view", "request", request.id);
    res.json(request);
  })
);

managerRouter.get(
  "/chats",
  asyncHandler(async (_req, res) => {
    const chats = await prisma.chat.findMany({
      include: {
        request: { select: { id: true, publicNumber: true, title: true, status: true } },
        client: { select: { id: true, displayName: true } },
        performer: { select: { id: true, displayName: true } },
        messages: {
          include: { sender: { select: { id: true, displayName: true, role: true } } },
          orderBy: { createdAt: "desc" },
          take: 20
        }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    res.json(chats.map((chat) => ({ ...chat, agreedTerms: serializeAgreedTerms(chat) })));
  })
);

managerRouter.get(
  "/chats/:id",
  asyncHandler(async (req, res) => {
    const chat = await prisma.chat.findUnique({
      where: { id: req.params.id },
      include: {
        request: true,
        client: { select: { id: true, displayName: true } },
        performer: { select: { id: true, displayName: true } },
        messages: {
          include: { sender: { select: { id: true, displayName: true, role: true } } },
          orderBy: { createdAt: "asc" }
        }
      }
    });
    if (!chat) throw new HttpError(404, "Чат не найден", "chat_not_found");
    await managerViewAudit(req.user!.id, "manager.chat.view", "chat", chat.id);
    res.json({ ...chat, agreedTerms: serializeAgreedTerms(chat) });
  })
);

managerRouter.get(
  "/complaints",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.complaint.findMany({
      include: {
        fromUser: { select: { id: true, displayName: true, role: true } },
        againstUser: { select: { id: true, displayName: true, role: true } },
        request: { select: { id: true, publicNumber: true, title: true } },
        chat: { select: { id: true, status: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    }));
  })
);

managerRouter.get(
  "/complaints/:id",
  asyncHandler(async (req, res) => {
    const complaint = await prisma.complaint.findUnique({
      where: { id: req.params.id },
      include: {
        fromUser: { select: { id: true, displayName: true, role: true, phone: true, email: true } },
        againstUser: { select: { id: true, displayName: true, role: true, phone: true, email: true } },
        request: true,
        chat: true
      }
    });
    if (!complaint) throw new HttpError(404, "Обращение не найдено", "complaint_not_found");
    await managerViewAudit(req.user!.id, "manager.complaint.view", "complaint", complaint.id);
    res.json(complaint);
  })
);

managerRouter.get(
  "/payments",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.paymentTransaction.findMany({
      select: {
        id: true,
        userId: true,
        provider: true,
        providerPaymentId: true,
        orderId: true,
        amount: true,
        currency: true,
        status: true,
        purpose: true,
        createdAt: true,
        paidAt: true,
        creditedAt: true,
        user: { select: { id: true, displayName: true, role: true, phone: true, email: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    }));
  })
);

managerRouter.get(
  "/balance-transactions",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.balanceTransaction.findMany({
      include: { user: { select: { id: true, displayName: true, role: true } } },
      orderBy: { createdAt: "desc" },
      take: 300
    }));
  })
);

async function managerViewAudit(actorUserId: string, action: string, entityType: string, entityId: string) {
  await writeAudit(actorUserId, action, entityType, entityId, {
    actorUserId,
    actorRole: "manager",
    targetUserId: entityType === "user" ? entityId : null,
    source: "manager_panel"
  });
}
