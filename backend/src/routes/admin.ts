import { Router } from "express";
import { z } from "zod";
import { authenticate, requireAdmin } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { grantAdminBonus } from "../services/balanceService";
import { archiveCompletedRequestsOlderThanNdays, archiveInactiveUsersOlderThan90Days } from "../services/archiveService";
import { writeAudit } from "../services/auditService";
import {
  buildAllConsentsExport,
  buildLegalArchiveExport,
  buildUserConsentsExport,
  buildUserLegalArchiveExport,
  calculateLegalDocumentHash,
  getConsentStatuses,
  publishLegalDocument
} from "../services/legalService";
import type { UserRole } from "../types/domain";
import { asyncHandler, HttpError } from "../utils/http";

export const adminRouter = Router();

adminRouter.use(authenticate, requireAdmin);

adminRouter.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    const [
      usersTotal,
      performersTotal,
      clientsTotal,
      requestsTotal,
      chatsTotal,
      complaintsTotal,
      balanceRows,
      riskFlagsTotal
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: "performer" } }),
      prisma.user.count({ where: { role: "client" } }),
      prisma.clientRequest.count(),
      prisma.chat.count(),
      prisma.complaint.count(),
      prisma.user.aggregate({ _sum: { balance: true, bonusBalance: true } }),
      prisma.userRiskFlag.count({ where: { resolvedAt: null } })
    ]);
    const balanceTotal = (balanceRows._sum.balance ?? 0) + (balanceRows._sum.bonusBalance ?? 0);

    res.json({
      usersTotal,
      clientsTotal,
      performersTotal,
      requestsTotal,
      chatsTotal,
      complaintsTotal,
      balanceTotal,
      riskFlagsTotal
    });
  })
);

adminRouter.get(
  "/users",
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      include: {
        city: true,
        clientProfile: true,
        performerProfile: true,
        performerDocuments: { orderBy: { uploadedAt: "desc" } },
        riskFlags: { where: { resolvedAt: null }, orderBy: { createdAt: "desc" } }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    });

    res.json(users.map(({ passwordHash: _passwordHash, ...user }) => user));
  })
);

adminRouter.patch(
  "/users/:id/block",
  asyncHandler(async (req, res) => {
    const input = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        status: "blocked",
        blockedAt: new Date(),
        blockReason: input.reason
      }
    });

    await writeAudit(req.user!.id, "user.block", "user", user.id, input);
    const { passwordHash: _passwordHash, ...safeUser } = user;
    res.json(safeUser);
  })
);

adminRouter.patch(
  "/users/:id/unblock",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        status: "active",
        blockedAt: null,
        blockReason: null
      }
    });

    await writeAudit(req.user!.id, "user.unblock", "user", user.id);
    const { passwordHash: _passwordHash, ...safeUser } = user;
    res.json(safeUser);
  })
);

adminRouter.delete(
  "/users/:id",
  asyncHandler(async (req, res) => {
    if (req.user!.role !== "superadmin") {
      throw new HttpError(403, "Удаление доступно только superadmin", "superadmin_required");
    }
    if (req.user!.id === req.params.id) {
      throw new HttpError(400, "Нельзя удалить текущую учётную запись", "cannot_delete_self");
    }
    const userId = req.params.id;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw new HttpError(404, "Пользователь не найден", "user_not_found");
    }

    const result = await prisma.$transaction(async (tx) => {
      const clientRequests = await tx.clientRequest.findMany({ where: { clientId: userId }, select: { id: true } });
      const requestIds = clientRequests.map((request) => request.id);
      const requestChats = requestIds.length > 0
        ? await tx.chat.findMany({ where: { requestId: { in: requestIds } }, select: { id: true } })
        : [];
      const participantChats = await tx.chat.findMany({
        where: { OR: [{ clientId: userId }, { performerId: userId }] },
        select: { id: true }
      });
      const chatIds = Array.from(new Set([...requestChats, ...participantChats].map((chat) => chat.id)));

      await tx.complaint.deleteMany({
        where: {
          OR: [
            { fromUserId: userId },
            { againstUserId: userId },
            ...(requestIds.length ? [{ requestId: { in: requestIds } }] : []),
            ...(chatIds.length ? [{ chatId: { in: chatIds } }] : [])
          ]
        }
      });
      await tx.balanceTransaction.deleteMany({
        where: {
          OR: [
            { userId },
            { createdByAdminId: userId },
            ...(requestIds.length ? [{ relatedRequestId: { in: requestIds } }] : [])
          ]
        }
      });
      await tx.review.deleteMany({
        where: {
          OR: [
            { fromUserId: userId },
            { toUserId: userId },
            ...(requestIds.length ? [{ requestId: { in: requestIds } }] : [])
          ]
        }
      });
      await tx.chatMessage.deleteMany({
        where: {
          OR: [
            { senderId: userId },
            ...(chatIds.length ? [{ chatId: { in: chatIds } }] : [])
          ]
        }
      });
      if (chatIds.length) {
        await tx.chat.deleteMany({ where: { id: { in: chatIds } } });
      }
      await tx.requestResponse.deleteMany({
        where: {
          OR: [
            { performerId: userId },
            ...(requestIds.length ? [{ requestId: { in: requestIds } }] : [])
          ]
        }
      });
      await tx.clientRequest.updateMany({
        where: { selectedPerformerId: userId },
        data: { selectedPerformerId: null, status: "published" }
      });
      if (requestIds.length) {
        await tx.clientRequest.deleteMany({ where: { id: { in: requestIds } } });
      }
      await tx.auditLog.deleteMany({
        where: {
          OR: [
            { actorUserId: userId },
            { entityType: "user", entityId: userId }
          ]
        }
      });
      await tx.user.delete({ where: { id: userId } });
      await writeAudit(req.user!.id, "user.delete_physical", "user", userId, {
        removedRequests: requestIds.length,
        removedChats: chatIds.length
      }, tx);
      return { removedRequests: requestIds.length, removedChats: chatIds.length };
    });

    return res.json({ mode: "deleted", ...result });
  })
);

adminRouter.post(
  "/users/:id/bonus",
  asyncHandler(async (req, res) => {
    const input = z.object({
      amount: z.number().int().positive(),
      reason: z.string().min(3).max(500),
      comment: z.string().max(1000).optional(),
      bonusExpiresAt: z.string().optional()
    }).parse(req.body);

    res.json(
      await grantAdminBonus(
        req.user!.id,
        req.params.id,
        input.amount,
        input.reason,
        input.comment,
        input.bonusExpiresAt ? new Date(input.bonusExpiresAt) : null
      )
    );
  })
);

adminRouter.patch(
  "/performers/:userId/verification",
  asyncHandler(async (req, res) => {
    const input = z.object({
      verificationStatuses: z.array(z.string()).optional(),
      selfEmployedStatus: z.string().optional(),
      criminalRecordCertificateStatus: z.string().optional(),
      trustLevel: z.enum([
        "new_profile",
        "phone_verified",
        "profile_completed",
        "documents_optional",
        "trusted_by_reviews",
        "manual_verified",
        "not_verified",
        "limited"
      ]).optional(),
      childcareApprovalStatus: z.enum(["not_requested", "pending", "approved", "rejected", "missing_criminal_record"]).optional()
    }).parse(req.body);

    const profile = await prisma.performerProfile.update({
      where: { userId: req.params.userId },
      data: {
        verificationStatuses: input.verificationStatuses ? JSON.stringify(input.verificationStatuses) : undefined,
        selfEmployedStatus: input.selfEmployedStatus,
        criminalRecordCertificateStatus: input.criminalRecordCertificateStatus,
        trustLevel: input.trustLevel,
        childcareApprovalStatus: input.childcareApprovalStatus
      }
    });

    await writeAudit(req.user!.id, "performer.verification_update", "user", req.params.userId, input);
    res.json(profile);
  })
);

adminRouter.get(
  "/requests",
  asyncHandler(async (_req, res) => {
    const requests = await prisma.clientRequest.findMany({
      include: {
        city: true,
        category: true,
        client: { select: { id: true, displayName: true, phone: true } },
        selectedPerformer: { select: { id: true, displayName: true } },
        responses: {
          include: {
            performer: { select: { id: true, displayName: true, city: true, performerProfile: true } }
          },
          orderBy: { createdAt: "desc" }
        },
        chats: { select: { id: true, status: true, performerId: true, archivedAt: true }, orderBy: { createdAt: "desc" } }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    res.json(requests.map((request) => ({ ...request, chat: request.chats[0] ?? null })));
  })
);

adminRouter.patch(
  "/requests/:id/moderation",
  asyncHandler(async (req, res) => {
    const input = z.object({
      visibilityStatus: z.enum(["city_visible", "hidden_by_admin", "blocked"]).optional(),
      status: z.enum(["blocked", "dispute", "cancelled", "published", "waiting_for_responses"]).optional()
    }).parse(req.body);

    const request = await prisma.clientRequest.update({
      where: { id: req.params.id },
      data: input
    });
    await writeAudit(req.user!.id, "request.moderation_update", "request", request.id, input);
    res.json(request);
  })
);

adminRouter.get(
  "/chats",
  asyncHandler(async (_req, res) => {
    const chats = await prisma.chat.findMany({
      include: {
        request: { select: { id: true, publicNumber: true, title: true, status: true, cityId: true, categoryId: true, date: true, timeFrom: true, timeTo: true, priceEstimateAmount: true } },
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
    res.json(chats);
  })
);

adminRouter.get(
  "/complaints",
  asyncHandler(async (_req, res) => {
    const complaints = await prisma.complaint.findMany({
      include: {
        fromUser: { select: { id: true, displayName: true, role: true } },
        againstUser: { select: { id: true, displayName: true, role: true } },
        request: { select: { id: true, publicNumber: true, title: true } },
        chat: { select: { id: true, status: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    res.json(complaints);
  })
);

adminRouter.get(
  "/cities",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.city.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }));
  })
);

adminRouter.post(
  "/cities",
  asyncHandler(async (req, res) => {
    const input = citySchema.parse(req.body);
    const city = await prisma.city.create({ data: input });
    await writeAudit(req.user!.id, "city.create", "city", city.id, input);
    res.status(201).json(city);
  })
);

adminRouter.patch(
  "/cities/:id",
  asyncHandler(async (req, res) => {
    const input = citySchema.partial().parse(req.body);
    const city = await prisma.city.update({ where: { id: req.params.id }, data: input });
    await writeAudit(req.user!.id, "city.update", "city", city.id, input);
    res.json(city);
  })
);

adminRouter.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.serviceCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }));
  })
);

adminRouter.post(
  "/categories",
  asyncHandler(async (req, res) => {
    const input = categorySchema.parse(req.body);
    const category = await prisma.serviceCategory.create({ data: input });
    await writeAudit(req.user!.id, "category.create", "category", category.id, input);
    res.status(201).json(category);
  })
);

adminRouter.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.serviceSetting.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] }));
  })
);

adminRouter.patch(
  "/settings/:key",
  asyncHandler(async (req, res) => {
    const input = z.object({ valueJson: z.string().min(1) }).parse(req.body);
    const before = await prisma.serviceSetting.findUnique({ where: { key: req.params.key } });
    const setting = await prisma.serviceSetting.update({
      where: { key: req.params.key },
      data: { valueJson: input.valueJson }
    });
    await writeAudit(req.user!.id, "settings.update", "service_setting", setting.key, {
      before: before?.valueJson,
      after: input.valueJson
    });
    res.json(setting);
  })
);

adminRouter.get(
  "/knowledge",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.knowledgeArticle.findMany({ orderBy: [{ category: "asc" }, { sortOrder: "asc" }] }));
  })
);

adminRouter.post(
  "/knowledge",
  asyncHandler(async (req, res) => {
    const input = knowledgeSchema.parse(req.body);
    const article = await prisma.knowledgeArticle.create({ data: input });
    await writeAudit(req.user!.id, "knowledge.create", "knowledge_article", article.id, input);
    res.status(201).json(article);
  })
);

adminRouter.patch(
  "/knowledge/:id",
  asyncHandler(async (req, res) => {
    const input = knowledgeSchema.partial().parse(req.body);
    const article = await prisma.knowledgeArticle.update({ where: { id: req.params.id }, data: input });
    await writeAudit(req.user!.id, "knowledge.update", "knowledge_article", article.id, input);
    res.json(article);
  })
);

adminRouter.patch(
  "/performer-documents/:id/status",
  asyncHandler(async (req, res) => {
    const input = z.object({
      status: z.enum(["uploaded", "verified", "rejected", "needs_update"]),
      adminComment: z.string().max(1000).optional()
    }).parse(req.body);
    const document = await prisma.performerDocument.update({
      where: { id: req.params.id },
      data: {
        status: input.status,
        adminComment: input.adminComment,
        verifiedAt: input.status === "verified" ? new Date() : null
      }
    });
    await writeAudit(req.user!.id, "performer_document.status_update", "performer_document", document.id, input);
    res.json(document);
  })
);

adminRouter.post(
  "/archive/run",
  asyncHandler(async (req, res) => {
    const input = z.object({ completedRequestDays: z.number().int().positive().default(30) }).parse(req.body ?? {});
    const archivedUsers = await archiveInactiveUsersOlderThan90Days(req.user!.id);
    const archivedRequests = await archiveCompletedRequestsOlderThanNdays(req.user!.id, input.completedRequestDays);
    res.json({ archivedUsers, archivedRequests });
  })
);

adminRouter.patch(
  "/categories/:id",
  asyncHandler(async (req, res) => {
    const input = categorySchema.partial().parse(req.body);
    const category = await prisma.serviceCategory.update({ where: { id: req.params.id }, data: input });
    await writeAudit(req.user!.id, "category.update", "category", category.id, input);
    res.json(category);
  })
);

adminRouter.get(
  "/balance-transactions",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.balanceTransaction.findMany({
      include: {
        user: { select: { id: true, displayName: true, role: true } },
        createdByAdmin: { select: { id: true, displayName: true } },
        relatedRequest: { select: { id: true, publicNumber: true, title: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    res.json(rows);
  })
);

adminRouter.get(
  "/legal/documents",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.legalDocument.findMany({ orderBy: [{ type: "asc" }, { version: "desc" }] }));
  })
);

adminRouter.post(
  "/legal/documents",
  asyncHandler(async (req, res) => {
    const input = legalDocumentSchema.parse(req.body);
    const document = await prisma.legalDocument.create({
      data: {
        ...input,
        contentHash: calculateLegalDocumentHash(input),
        isPublished: false,
        isActive: false,
        createdByAdminId: req.user!.id
      }
    });
    await writeAudit(req.user!.id, "legal_document.create_draft", "legal_document", document.id, {
      type: document.type,
      version: document.version
    });
    res.status(201).json(document);
  })
);

adminRouter.post(
  "/legal/documents/:id/new-version",
  asyncHandler(async (req, res) => {
    const existing = await prisma.legalDocument.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      throw new HttpError(404, "Юридический документ не найден", "legal_document_not_found");
    }
    const input = legalDocumentSchema.partial().extend({
      version: z.string().min(1).default(nextLegalVersion(existing.version))
    }).parse(req.body ?? {});
    const draft = {
      type: input.type ?? existing.type,
      roleScope: input.roleScope ?? existing.roleScope,
      title: input.title ?? existing.title,
      slug: input.slug ?? existing.slug,
      version: input.version,
      contentMarkdown: input.contentMarkdown ?? existing.contentMarkdown,
      isRequired: input.isRequired ?? existing.isRequired
    };
    const document = await prisma.legalDocument.create({
      data: {
        ...draft,
        contentHash: calculateLegalDocumentHash(draft),
        isPublished: false,
        isActive: false,
        createdByAdminId: req.user!.id
      }
    });
    await writeAudit(req.user!.id, "legal_document.new_version", "legal_document", document.id, {
      previousDocumentId: existing.id,
      type: document.type,
      version: document.version
    });
    res.status(201).json(document);
  })
);

adminRouter.patch(
  "/legal/documents/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.legalDocument.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      throw new HttpError(404, "Юридический документ не найден", "legal_document_not_found");
    }
    if (existing.isPublished) {
      throw new HttpError(400, "Опубликованный документ нельзя редактировать напрямую. Создайте новую версию.", "published_legal_document_locked");
    }
    const input = legalDocumentSchema.partial().parse(req.body);
    const merged = {
      title: input.title ?? existing.title,
      version: input.version ?? existing.version,
      type: input.type ?? existing.type,
      contentMarkdown: input.contentMarkdown ?? existing.contentMarkdown
    };
    const document = await prisma.legalDocument.update({
      where: { id: existing.id },
      data: {
        ...input,
        contentHash: calculateLegalDocumentHash(merged)
      }
    });
    await writeAudit(req.user!.id, "legal_document.update_draft", "legal_document", document.id, input);
    res.json(document);
  })
);

adminRouter.post(
  "/legal/documents/:id/publish",
  asyncHandler(async (req, res) => {
    res.json(await publishLegalDocument(req.params.id, req.user!.id));
  })
);

adminRouter.post(
  "/legal/documents/:id/archive",
  asyncHandler(async (req, res) => {
    const document = await prisma.legalDocument.update({
      where: { id: req.params.id },
      data: { isActive: false, archivedAt: new Date() }
    });
    await writeAudit(req.user!.id, "legal_document.archive", "legal_document", document.id, {
      type: document.type,
      version: document.version
    });
    res.json(document);
  })
);

adminRouter.get(
  "/legal/consents",
  asyncHandler(async (_req, res) => {
    res.json(
      await prisma.userConsent.findMany({
        include: {
          user: { select: { id: true, displayName: true, role: true, phone: true, email: true } },
          document: true
        },
        orderBy: { acceptedAt: "desc" },
        take: 500
      })
    );
  })
);

adminRouter.get(
  "/legal/export-logs",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.consentExportLog.findMany({ orderBy: { exportedAt: "desc" }, take: 50 }));
  })
);

adminRouter.get(
  "/legal/exports/all.xlsx",
  asyncHandler(async (req, res) => {
    res.json(await buildAllConsentsExport(req.user!.id, requestMeta(req)));
  })
);

adminRouter.get(
  "/legal/exports/archive.zip",
  asyncHandler(async (req, res) => {
    res.json(await buildLegalArchiveExport(req.user!.id, requestMeta(req)));
  })
);

adminRouter.get(
  "/users/:userId/legal/consents",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { id: true, role: true } });
    if (!user) {
      throw new HttpError(404, "Пользователь не найден", "user_not_found");
    }
    res.json(await getConsentStatuses(user.id, user.role as UserRole));
  })
);

adminRouter.get(
  "/users/:userId/legal/consents.xlsx",
  asyncHandler(async (req, res) => {
    res.json(await buildUserConsentsExport(req.params.userId, req.user!.id, requestMeta(req)));
  })
);

adminRouter.get(
  "/users/:userId/legal/archive.zip",
  asyncHandler(async (req, res) => {
    res.json(await buildUserLegalArchiveExport(req.params.userId, req.user!.id, requestMeta(req)));
  })
);

adminRouter.get(
  "/legal/security-checklist",
  asyncHandler(async (_req, res) => {
    res.json({
      title: "Проверка production-безопасности",
      status: "manual_review_required",
      items: [
        "Заменить JWT_SECRET на длинный production-секрет.",
        "Вынести базу данных из ephemeral preview-хранилища.",
        "Проверить CORS_ORIGIN для production-домена.",
        "Включить HTTPS и secure-cookie слой при переходе на production.",
        "Провести юридическую проверку документов версии 1.0."
      ]
    });
  })
);

const citySchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9_-]+$/),
  region: z.string().min(2),
  isActive: z.boolean().default(true),
  defaultCommissionAmount: z.number().int().positive().default(50),
  minTopUpAmount: z.number().int().positive().default(150),
  timezone: z.string().min(2).default("Asia/Yekaterinburg"),
  pricingZone: z.string().min(2).default("base_yugorsk"),
  sortOrder: z.number().int().default(100),
  mapCenterLat: z.number(),
  mapCenterLng: z.number()
});

const categorySchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  includedJson: z.string().optional(),
  excludedJson: z.string().optional(),
  complexityJson: z.string().optional(),
  transferRules: z.string().optional(),
  medicalProhibitions: z.string().optional(),
  clientInstructions: z.string().optional(),
  performerInstructions: z.string().optional(),
  pricingRulesJson: z.string().optional(),
  basePrice: z.number().int().nonnegative().optional(),
  calculationUnit: z.enum(["hour", "visit", "task"]).optional(),
  minDurationHours: z.number().positive().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().default(true),
  isChildcare: z.boolean().default(false),
  requiresCriminalRecord: z.boolean().default(false)
});

const knowledgeSchema = z.object({
  audience: z.enum(["client", "performer", "all"]).default("all"),
  title: z.string().min(3),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  content: z.string().min(3),
  category: z.string().min(2),
  isPublished: z.boolean().default(true),
  sortOrder: z.number().int().default(100)
});

const legalDocumentSchema = z.object({
  type: z.string().min(2).max(120),
  roleScope: z.enum(["all", "customer", "helper", "admin"]),
  title: z.string().min(3).max(240),
  slug: z.string().min(2).max(160).regex(/^[a-z0-9-]+$/),
  version: z.string().min(1).max(40),
  contentMarkdown: z.string().min(20),
  isRequired: z.boolean().default(true)
});

function nextLegalVersion(version: string) {
  const parsed = Number.parseFloat(version);
  if (Number.isFinite(parsed)) return (parsed + 0.1).toFixed(1);
  return `${version}-new`;
}

function requestMeta(req: any) {
  return {
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null
  };
}
