import { Router } from "express";
import { z } from "zod";
import { authenticate, requireAdmin } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { FIXED_SERVICE_FEE_SETTING_KEYS, grantAdminBonus } from "../services/balanceService";
import {
  getTrialBalanceAdminView,
  grantTrialBalanceToEligibleUsers,
  updateTrialBalanceSettings
} from "../services/trialBalanceService";
import { archiveCompletedRequestsOlderThanNdays, archiveSafePendingUsers } from "../services/archiveService";
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
import { normalizeSettlementName } from "../services/settlementService";
import { serializeAgreedTerms } from "../services/agreementTermsService";
import { getUserArchiveSafety } from "../services/userLifecycleService";
import { signUserToken, type ActingRole } from "../services/authTokenService";

export const adminRouter = Router();

adminRouter.use(authenticate, requireAdmin);

adminRouter.post(
  "/acting/start",
  asyncHandler(async (req, res) => {
    const input = z.object({ role: z.enum(["customer", "helper"]) }).parse(req.body);
    const actingRole: ActingRole = input.role === "customer" ? "client" : "performer";
    const realRole = req.user!.realRole;
    const token = signUserToken(req.user!.id, realRole, actingRole);
    const metadata = {
      realUserId: req.user!.id,
      effectiveUserId: req.user!.id,
      realRole,
      effectiveRole: actingRole,
      actingRole,
      actionSource: "admin_acting_mode"
    };
    await writeAudit(req.user!.id, "admin.acting.start", "user", req.user!.id, metadata);
    res.json({
      token,
      role: realRole,
      effectiveRole: actingRole,
      actingRole,
      isActingAsRole: true,
      nextPath: actingRole === "client" ? "/app/client/requests" : "/app/performer/requests"
    });
  })
);

adminRouter.post(
  "/acting/stop",
  asyncHandler(async (req, res) => {
    const realRole = req.user!.realRole;
    const metadata = {
      realUserId: req.user!.id,
      effectiveUserId: req.user!.id,
      realRole,
      effectiveRole: req.user!.effectiveRole,
      actingRole: req.user!.actingRole,
      actionSource: "admin_acting_mode"
    };
    await writeAudit(req.user!.id, "admin.acting.stop", "user", req.user!.id, metadata);
    res.json({
      token: signUserToken(req.user!.id, realRole),
      role: realRole,
      effectiveRole: realRole,
      actingRole: null,
      isActingAsRole: false,
      nextPath: "/app/admin"
    });
  })
);

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
        userCities: { where: { isActive: true }, include: { city: true } },
        clientProfile: true,
        performerProfile: true,
        performerDocuments: { orderBy: { uploadedAt: "desc" } },
        identities: {
          select: { id: true, provider: true, providerUserId: true, displayName: true, avatarUrl: true, createdAt: true }
        },
        riskFlags: { where: { resolvedAt: null }, orderBy: { createdAt: "desc" } }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    });

    res.json(users.map(({ passwordHash: _passwordHash, ...user }) => user));
  })
);

adminRouter.post(
  "/users/:id/block",
  asyncHandler(async (req, res) => {
    const input = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);
    if (req.user!.id === req.params.id) {
      throw new HttpError(400, "Нельзя заблокировать текущую учётную запись", "cannot_block_self");
    }
    const current = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!current) throw new HttpError(404, "Пользователь не найден", "user_not_found");
    if (current.status === "archived") {
      throw new HttpError(409, "Архивный профиль нельзя заблокировать", "user_already_archived");
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        status: "blocked",
        blockedAt: new Date(),
        blockedByAdminId: req.user!.id,
        blockReason: input.reason
      }
    });

    await writeAudit(req.user!.id, "user.block", "user", user.id, input);
    const { passwordHash: _passwordHash, ...safeUser } = user;
    res.json(safeUser);
  })
);

adminRouter.post(
  "/users/:id/unblock",
  asyncHandler(async (req, res) => {
    const current = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!current) throw new HttpError(404, "Пользователь не найден", "user_not_found");
    if (!["blocked", "pending_archive"].includes(current.status)) {
      throw new HttpError(409, "Разблокирование для этого статуса недоступно", "user_status_invalid");
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        status: "active",
        blockedAt: null,
        blockedByAdminId: null,
        blockReason: null,
        archiveRequestedAt: null,
        archiveRequestedByAdminId: null,
        archiveReason: null,
        archiveBlockedReason: null
      }
    });

    await writeAudit(req.user!.id, "user.unblock", "user", user.id);
    const { passwordHash: _passwordHash, ...safeUser } = user;
    res.json(safeUser);
  })
);

adminRouter.delete(
  "/users/:id",
  asyncHandler(async (_req, _res) => {
    throw new HttpError(
      405,
      "Физическое удаление пользователей запрещено. Используйте блокировку или архивирование.",
      "physical_user_deletion_forbidden"
    );
  })
);

adminRouter.get(
  "/users/:id/archive-safety",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!user) throw new HttpError(404, "Пользователь не найден", "user_not_found");
    res.json(await getUserArchiveSafety(user.id));
  })
);

adminRouter.post(
  "/users/:id/request-archive",
  asyncHandler(async (req, res) => {
    const input = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id: req.params.id } });
      if (!current) throw new HttpError(404, "Пользователь не найден", "user_not_found");
      if (current.status === "archived") {
        return { user: current, safety: await getUserArchiveSafety(current.id, tx) };
      }
      if (req.user!.id === current.id) {
        throw new HttpError(400, "Нельзя архивировать текущую учётную запись", "cannot_archive_self");
      }
      const requestedAt = current.archiveRequestedAt ?? new Date();
      const user = await tx.user.update({
        where: { id: current.id },
        data: {
          status: "pending_archive",
          archiveRequestedAt: requestedAt,
          archiveRequestedByAdminId: req.user!.id,
          archiveReason: input.reason
        }
      });
      const safety = await getUserArchiveSafety(user.id, tx);
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { archiveBlockedReason: safety.reasons.length ? safety.reasons.join(" ") : null }
      });
      await writeAudit(req.user!.id, "user.archive_requested", "user", user.id, { ...input, safety }, tx);
      return { user: updated, safety };
    });
    const { passwordHash: _passwordHash, ...safeUser } = result.user;
    res.json({ user: safeUser, safety: result.safety });
  })
);

adminRouter.post(
  "/users/:id/archive",
  asyncHandler(async (req, res) => {
    const input = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id: req.params.id } });
      if (!current) throw new HttpError(404, "Пользователь не найден", "user_not_found");
      if (current.status === "archived") {
        return { user: current, safety: await getUserArchiveSafety(current.id, tx), blocked: false };
      }
      if (req.user!.id === current.id) {
        throw new HttpError(400, "Нельзя архивировать текущую учётную запись", "cannot_archive_self");
      }
      const safety = await getUserArchiveSafety(current.id, tx);
      if (!safety.canArchive) {
        const user = await tx.user.update({
          where: { id: current.id },
          data: { archiveBlockedReason: safety.reasons.join(" ") }
        });
        await writeAudit(req.user!.id, "user.archive_blocked", "user", current.id, { ...input, safety }, tx);
        return { user, safety, blocked: true };
      }
      const user = await tx.user.update({
        where: { id: current.id },
        data: {
          status: "archived",
          archivedAt: new Date(),
          archivedByAdminId: req.user!.id,
          archiveReason: input.reason,
          archiveBlockedReason: null
        }
      });
      await writeAudit(req.user!.id, "user.archived", "user", user.id, { ...input, safety }, tx);
      return { user, safety, blocked: false };
    });
    if (result.blocked) {
      throw new HttpError(409, "Пользователя пока нельзя архивировать", "user_archive_blocked", result.safety);
    }
    const { passwordHash: _passwordHash, ...safeUser } = result.user;
    res.json({ user: safeUser, safety: result.safety });
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
        chats: {
          select: {
            id: true,
            status: true,
            performerId: true,
            agreedHelperAmount: true,
            customerServiceFeeAmount: true,
            helperServiceFeeAmount: true,
            customerTotalAmount: true,
            helperNetAmount: true,
            agreedPackageId: true,
            agreedPackageTitle: true,
            agreedAddonsJson: true,
            agreedDurationMinutes: true,
            agreedScheduledAt: true,
            agreedTermsComment: true,
            agreedByCustomerAt: true,
            agreedByHelperAt: true,
            termsUpdatedAt: true,
            termsUpdatedByUserId: true,
            archivedAt: true
          },
          orderBy: { createdAt: "desc" }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    res.json(requests.map((request) => {
      const chat = request.chats[0] ?? null;
      return {
        ...request,
        chat: chat ? { ...chat, agreedTerms: serializeAgreedTerms(chat) } : null
      };
    }));
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
    res.json(chats.map((chat) => ({ ...chat, agreedTerms: serializeAgreedTerms(chat) })));
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
    const cities = await prisma.city.findMany({
      include: {
        userCities: { where: { isActive: true }, include: { user: { select: { role: true } } } },
        _count: { select: { requests: true } },
        activatedByUser: { select: { id: true, displayName: true } }
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
    });
    res.json(cities.map((city) => ({
      ...city,
      customerCount: city.userCities.filter((row) => row.user.role === "client").length,
      helperCount: city.userCities.filter((row) => row.user.role === "performer").length,
      requestCount: city._count.requests,
      needsReview: city.directoryStatus === "needs_review"
    })));
  })
);

adminRouter.post(
  "/cities",
  asyncHandler(async (req, res) => {
    const input = citySchema.parse(req.body);
    const city = await prisma.city.create({ data: { ...input, normalizedName: normalizeSettlementName(input.name) } });
    await writeAudit(req.user!.id, "city.create", "city", city.id, input);
    res.status(201).json(city);
  })
);

adminRouter.patch(
  "/cities/:id",
  asyncHandler(async (req, res) => {
    const input = citySchema.partial().parse(req.body);
    const city = await prisma.city.update({
      where: { id: req.params.id },
      data: {
        ...input,
        normalizedName: input.name ? normalizeSettlementName(input.name) : undefined,
        activatedAt: input.serviceStatus === "active" ? new Date() : undefined,
        activatedByUserId: input.serviceStatus === "active" ? req.user!.id : undefined
      }
    });
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

adminRouter.get(
  "/trial-balance/settings",
  asyncHandler(async (_req, res) => {
    res.json(await getTrialBalanceAdminView());
  })
);

adminRouter.put(
  "/trial-balance/settings",
  asyncHandler(async (req, res) => {
    const input = z.object({
      enabled: z.boolean(),
      amount: z.number().int().positive(),
      autoGrantNewUsers: z.boolean()
    }).parse(req.body);
    const settings = await updateTrialBalanceSettings(input);
    await writeAudit(req.user!.id, "trial_balance.settings_update", "service_setting", "trialBalanceSettings", input);
    res.json(await getTrialBalanceAdminView());
  })
);

adminRouter.post(
  "/trial-balance/grant-all",
  asyncHandler(async (req, res) => {
    const summary = await grantTrialBalanceToEligibleUsers(req.user!.id);
    await writeAudit(req.user!.id, "trial_balance.bulk_grant", "service_setting", "trialBalanceSettings", summary);
    res.json(summary);
  })
);

adminRouter.patch(
  "/settings/:key",
  asyncHandler(async (req, res) => {
    if (FIXED_SERVICE_FEE_SETTING_KEYS.has(req.params.key)) {
      throw new HttpError(403, "Изменение сервисного сбора временно недоступно", "service_fee_setting_locked");
    }
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
    const archivedUsers = await archiveSafePendingUsers(req.user!.id);
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
  type: z.enum(["city", "town", "settlement", "village", "rural_locality", "urban_type_settlement", "other"]).default("city"),
  district: z.string().optional().nullable(),
  municipalDistrict: z.string().optional().nullable(),
  fiasId: z.string().optional().nullable(),
  garId: z.string().optional().nullable(),
  source: z.enum(["seed", "user_suggested", "admin", "import"]).default("admin"),
  directoryStatus: z.enum(["directory", "user_suggested", "needs_review", "verified", "hidden", "duplicate"]).default("verified"),
  serviceStatus: z.enum(["inactive", "active"]).default("inactive"),
  status: z.enum(["active", "inactive"]).default("active"),
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
