import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../../db/prisma";
import {
  adjustUserBalanceByAdmin,
  FIXED_SERVICE_FEE_SETTING_KEYS,
  grantAdminBonus,
  MAX_ADMIN_BALANCE_ADJUSTMENT
} from "../../../services/balanceService";
import {
  getTrialBalanceAdminView,
  grantTrialBalanceToEligibleUsers,
  updateTrialBalanceSettings
} from "../../../services/trialBalanceService";
import { archiveCompletedRequestsOlderThanNdays, archiveSafePendingUsers } from "../../../services/archiveService";
import { writeAudit } from "../../../services/auditService";
import {
  buildAllConsentsExport,
  buildLegalArchiveExport,
  buildUserConsentsExport,
  buildUserLegalArchiveExport,
  calculateLegalDocumentHash,
  getConsentStatuses,
  publishLegalDocument
} from "../../../services/legalService";
import type { UserRole } from "../../../types/domain";
import { HttpError } from "../../../utils/http";
import { normalizeSettlementName } from "../../../services/settlementService";
import { serializeAgreedTerms } from "../../../services/agreementTermsService";
import {
  getArchivedOAuthPendingRestoreSafety,
  getOAuthPendingCancellationSafety,
  getUserArchiveSafety,
  OAUTH_PENDING_CANCEL_ARCHIVE_REASON,
  restoreArchivedOAuthPendingUser
} from "../../../services/userLifecycleService";
import { signUserToken, type ActingRole } from "../../../services/authTokenService";
import { revokeUserSessions, setSessionActingRole } from "../../../services/authSessionService";
import { assignManagerRole, blockUser, revokeManagerRole, unblockUser } from "../../../services/userAccessService";
import { createRequestCategorySnapshotTx } from "../../../services/categoryStructureService";
import { serializePerformerDocument } from "./performerDocuments.controller";
import { passwordResetReasonCodes, resetPasswordBySuperadmin } from "../../../services/accountSecurityService";

function requestIp(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }) {
  const forwarded = req.headers["x-forwarded-for"];
  return typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : req.socket?.remoteAddress ?? null;
}

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
@Controller("api/admin")
export class AdminController {
  @Post("/acting/start")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postactingStart0(@Req() req: Request, @Res() res: Response) {
    const input = z.object({ role: z.enum(["customer", "helper"]) }).parse(req.body);
    const actingRole: ActingRole = input.role === "customer" ? "client" : "performer";
    const realRole = req.user!.realRole;
    await setSessionActingRole(req.user!.sessionId, req.user!.id, actingRole);
    const token = signUserToken(req.user!.id, realRole, req.user!.authTokenVersion, req.user!.sessionId, actingRole);
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
  }

  @Post("/acting/stop")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postactingStop1(@Req() req: Request, @Res() res: Response) {
    const realRole = req.user!.realRole;
    await setSessionActingRole(req.user!.sessionId, req.user!.id, null);
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
      token: signUserToken(req.user!.id, realRole, req.user!.authTokenVersion, req.user!.sessionId),
      role: realRole,
      effectiveRole: realRole,
      actingRole: null,
      isActingAsRole: false,
      nextPath: "/app/admin"
    });
  }

  @Patch("/requests/:id/category")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async patchrequestsIdCategory2(@Req() req: Request, @Res() res: Response) {
    const input = z.object({ categoryId: z.string().min(1), subcategoryId: z.string().optional(), taskTemplateId: z.string().optional() }).parse(req.body);
    const request = await prisma.clientRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw new HttpError(404, "Заявка не найдена", "request_not_found");
    if (["completed", "cancelled", "archived", "blocked"].includes(request.status)) throw new HttpError(409, "Категорию закрытой заявки изменить нельзя", "request_category_locked");
    const snapshot = await prisma.$transaction(async (tx) => {
      const created = await createRequestCategorySnapshotTx(tx, { requestId: request.id, cityId: request.cityId, categoryId: input.categoryId, subcategoryId: input.subcategoryId, taskTemplateId: input.taskTemplateId });
      if (!created) throw new HttpError(409, "Структура категорий города не настроена", "category_structure_missing");
      await writeAudit(req.user!.id, "admin.request.category.update", "request", request.id, { categoryId: input.categoryId, subcategoryId: input.subcategoryId, snapshotId: created.id }, tx);
      return created;
    });
    res.json(snapshot);
  }

  @Get("/summary")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getsummary3(@Req() _req: Request, @Res() res: Response) {
    const [
      usersTotal,
      performersTotal,
      clientsTotal,
      requestsTotal,
      chatsTotal,
      complaintsTotal,
      managersTotal,
      managersActive,
      riskFlagsTotal
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: "performer" } }),
      prisma.user.count({ where: { role: "client" } }),
      prisma.clientRequest.count(),
      prisma.chat.count(),
      prisma.complaint.count(),
      prisma.user.count({ where: { role: "manager" } }),
      prisma.user.count({ where: { role: "manager", status: "active" } }),
      prisma.userRiskFlag.count({ where: { resolvedAt: null } })
    ]);

    res.json({
      usersTotal,
      clientsTotal,
      performersTotal,
      requestsTotal,
      chatsTotal,
      complaintsTotal,
      managersTotal,
      managersActive,
      riskFlagsTotal
    });
  }

  @Get("/users")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getusers4(@Req() req: Request, @Res() res: Response) {
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const users = await prisma.user.findMany({
      where: status ? { status } : undefined,
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

    res.json(users.map(({ passwordHash, authTokenVersion: _authTokenVersion, ...user }) => ({
      ...user,
      performerDocuments: user.performerDocuments.map(serializePerformerDocument),
      hasPassword: Boolean(passwordHash)
    })));
  }

  @Post("/users/:id/block")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postusersIdBlock5(@Req() req: Request, @Res() res: Response) {
    const input = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);
    const user = await blockUser({ id: req.user!.id, role: req.user!.realRole }, req.params.id, input.reason);
    const { passwordHash: _passwordHash, authTokenVersion: _authTokenVersion, ...safeUser } = user;
    res.json(safeUser);
  }

  @Post("/users/:id/unblock")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postusersIdUnblock6(@Req() req: Request, @Res() res: Response) {
    const user = await unblockUser({ id: req.user!.id, role: req.user!.realRole }, req.params.id);
    const { passwordHash: _passwordHash, authTokenVersion: _authTokenVersion, ...safeUser } = user;
    res.json(safeUser);
  }

  @Post("/users/:id/manager/assign")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postusersIdManagerAssign7(@Req() req: Request, @Res() res: Response) {
    const input = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    const user = await assignManagerRole({ id: req.user!.id, role: req.user!.realRole }, req.params.id, input.reason);
    const { passwordHash: _passwordHash, authTokenVersion: _authTokenVersion, ...safeUser } = user;
    res.json(safeUser);
  }

  @Post("/users/:id/manager/revoke")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postusersIdManagerRevoke8(@Req() req: Request, @Res() res: Response) {
    const input = z.object({
      restoreRole: z.enum(["client", "performer"]).optional(),
      reason: z.string().trim().min(3).max(500)
    }).parse(req.body);
    const user = await revokeManagerRole(
      { id: req.user!.id, role: req.user!.realRole },
      req.params.id,
      input.restoreRole,
      input.reason
    );
    const { passwordHash: _passwordHash, authTokenVersion: _authTokenVersion, ...safeUser } = user;
    res.json(safeUser);
  }

  @Post("/users/:id/reset-password")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postusersIdResetPassword9(@Req() req: Request, @Res() res: Response) {
    const input = z.object({
      reasonCode: z.enum(passwordResetReasonCodes),
      reasonComment: z.string().trim().max(1000).optional()
    }).parse(req.body);
    const result = await resetPasswordBySuperadmin({
      actorId: req.user!.id,
      actorRole: req.user!.realRole,
      targetUserId: req.params.id,
      reasonCode: input.reasonCode,
      reasonComment: input.reasonComment,
      ipAddress: requestIp(req),
      userAgent: req.headers["user-agent"] ?? null
    });
    res.json(result);
  }

  @Post("/users/:id/revoke-sessions")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postusersIdRevokeSessions10(@Req() req: Request, @Res() res: Response) {
    if (req.params.id === req.user!.id) throw new HttpError(400, "Собственные сеансы завершайте через профиль", "cannot_revoke_own_admin_sessions");
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw new HttpError(404, "Пользователь не найден", "user_not_found");
    if (target.role === "superadmin") throw new HttpError(409, "Нельзя завершить сеансы Суперадминистратора через карточку", "superadmin_sessions_protected");
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: target.id }, data: { authTokenVersion: { increment: 1 } } });
      await revokeUserSessions(tx, target.id, "admin_revoked_sessions");
      await writeAudit(req.user!.id, "USER_SESSIONS_REVOKED", "user", target.id, {
        actorId: req.user!.id,
        actorRole: req.user!.realRole,
        targetUserId: target.id,
        scope: "all",
        ipAddress: requestIp(req),
        userAgent: req.headers["user-agent"] ?? null
      }, tx);
      return updated;
    });
    res.json({ revoked: true, userId: user.id });
  }

  @Delete("/users/:id")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async deleteusersId11(@Req() _req: Request, @Res() _res: Response) {
    throw new HttpError(
      405,
      "Физическое удаление пользователей запрещено. Используйте блокировку или архивирование.",
      "physical_user_deletion_forbidden"
    );
  }

  @Post("/users/:id/oauth-pending/cancel")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postusersIdOauthPendingCancel12(@Req() req: Request, @Res() res: Response) {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id: req.params.id } });
      if (!current) throw new HttpError(404, "Пользователь не найден", "user_not_found");
      const safety = await getOAuthPendingCancellationSafety(current.id, tx);
      if (!safety.canCancel) {
        throw new HttpError(
          409,
          "Нельзя отменить регистрацию: у пользователя уже есть история действий. Используйте блокировку или архивирование по правилам безопасности.",
          "oauth_pending_cancel_blocked",
          safety
        );
      }
      const reason = OAUTH_PENDING_CANCEL_ARCHIVE_REASON;
      const user = await tx.user.update({
        where: { id: current.id },
        data: {
          status: "archived",
          archivedAt: new Date(),
          archivedByAdminId: req.user!.id,
          archiveReason: reason,
          archiveBlockedReason: null
        }
      });
      await writeAudit(req.user!.id, "admin.oauth_pending.cancel", "user", user.id, {
        reason: "oauth_pending_cancelled",
        actorUserId: req.user!.id,
        targetUserId: user.id,
        source: "admin_panel",
        safety
      }, tx);
      return { user, safety };
    });
    const { passwordHash: _passwordHash, authTokenVersion: _authTokenVersion, ...safeUser } = result.user;
    res.json({ user: safeUser, safety: result.safety });
  }

  @Get("/users/:id/oauth-pending-restore-safety")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getusersIdOauthPendingRestoreSafety13(@Req() req: Request, @Res() res: Response) {
    res.json(await getArchivedOAuthPendingRestoreSafety(req.params.id));
  }

  @Post("/users/:id/restore-oauth-pending")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postusersIdRestoreOauthPending14(@Req() req: Request, @Res() res: Response) {
    const result = await prisma.$transaction((tx) => restoreArchivedOAuthPendingUser({
      userId: req.params.id,
      actorUserId: req.user!.id,
      source: "admin_panel"
    }, tx));
    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: result.user.id },
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
      }
    });
    const { passwordHash: _passwordHash, authTokenVersion: _authTokenVersion, ...safeUser } = updated;
    res.json({ user: { ...safeUser, performerDocuments: safeUser.performerDocuments.map(serializePerformerDocument) }, safety: result.safety });
  }

  @Get("/users/:id/archive-safety")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getusersIdArchiveSafety15(@Req() req: Request, @Res() res: Response) {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!user) throw new HttpError(404, "Пользователь не найден", "user_not_found");
    res.json(await getUserArchiveSafety(user.id));
  }

  @Post("/users/:id/request-archive")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postusersIdRequestArchive16(@Req() req: Request, @Res() res: Response) {
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
      if (current.role === "superadmin") {
        throw new HttpError(409, "Суперадминистратор защищён от архивирования", "last_superadmin_protected");
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
    const { passwordHash: _passwordHash, authTokenVersion: _authTokenVersion, ...safeUser } = result.user;
    res.json({ user: safeUser, safety: result.safety });
  }

  @Post("/users/:id/archive")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postusersIdArchive17(@Req() req: Request, @Res() res: Response) {
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
      if (current.role === "superadmin") {
        throw new HttpError(409, "Суперадминистратор защищён от архивирования", "last_superadmin_protected");
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
    const { passwordHash: _passwordHash, authTokenVersion: _authTokenVersion, ...safeUser } = result.user;
    res.json({ user: safeUser, safety: result.safety });
  }

  @Post("/users/:id/bonus")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postusersIdBonus18(@Req() req: Request, @Res() res: Response) {
    const input = z.object({
      amount: z.number().int().positive(),
      reason: z.string().min(3).max(500),
      comment: z.string().trim().min(10).max(1000),
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
  }

  @Post("/users/:id/balance-adjustment")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postusersIdBalanceAdjustment19(@Req() req: Request, @Res() res: Response) {
    const input = z.object({
      wallet: z.enum(["main", "bonus"]),
      direction: z.enum(["credit", "debit"]),
      amount: z.number().int().positive().max(MAX_ADMIN_BALANCE_ADJUSTMENT),
      reason: z.enum(["payment_issue", "goodwill_bonus", "manual_correction", "refund", "penalty_reversal", "other"]),
      comment: z.string().trim().min(10).max(1000),
      clientRequestId: z.string().trim().min(8).max(120).optional()
    }).parse(req.body);
    res.json(await adjustUserBalanceByAdmin({
      actorUserId: req.user!.id,
      actorRole: req.user!.realRole as "admin" | "superadmin",
      targetUserId: req.params.id,
      ...input
    }));
  }

  @Patch("/performers/:userId/verification")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async patchperformersUserIdVerification20(@Req() req: Request, @Res() res: Response) {
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
  }

  @Get("/requests")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getrequests21(@Req() _req: Request, @Res() res: Response) {
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
  }

  @Patch("/requests/:id/moderation")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async patchrequestsIdModeration22(@Req() req: Request, @Res() res: Response) {
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
  }

  @Get("/chats")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getchats23(@Req() _req: Request, @Res() res: Response) {
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
  }

  @Get("/complaints")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getcomplaints24(@Req() _req: Request, @Res() res: Response) {
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
  }

  @Get("/cities")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getcities25(@Req() _req: Request, @Res() res: Response) {
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
  }

  @Post("/cities")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postcities26(@Req() req: Request, @Res() res: Response) {
    const input = citySchema.parse(req.body);
    const city = await prisma.city.create({ data: { ...input, normalizedName: normalizeSettlementName(input.name) } });
    await writeAudit(req.user!.id, "city.create", "city", city.id, input);
    res.status(201).json(city);
  }

  @Patch("/cities/:id")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async patchcitiesId27(@Req() req: Request, @Res() res: Response) {
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
  }

  @Get("/categories")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getcategories28(@Req() _req: Request, @Res() res: Response) {
    res.json(await prisma.serviceCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }));
  }

  @Post("/categories")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postcategories29(@Req() req: Request, @Res() res: Response) {
    const input = categorySchema.parse(req.body);
    const category = await prisma.serviceCategory.create({ data: input });
    await writeAudit(req.user!.id, "category.create", "category", category.id, input);
    res.status(201).json(category);
  }

  @Get("/settings")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getsettings30(@Req() _req: Request, @Res() res: Response) {
    res.json(await prisma.serviceSetting.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] }));
  }

  @Get("/trial-balance/settings")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async gettrialBalanceSettings31(@Req() _req: Request, @Res() res: Response) {
    res.json(await getTrialBalanceAdminView());
  }

  @Put("/trial-balance/settings")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async puttrialBalanceSettings32(@Req() req: Request, @Res() res: Response) {
    const input = z.object({
      enabled: z.boolean(),
      amount: z.number().int().positive(),
      autoGrantNewUsers: z.boolean()
    }).parse(req.body);
    const settings = await updateTrialBalanceSettings(input);
    await writeAudit(req.user!.id, "trial_balance.settings_update", "service_setting", "trialBalanceSettings", input);
    res.json(await getTrialBalanceAdminView());
  }

  @Post("/trial-balance/grant-all")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async posttrialBalanceGrantAll33(@Req() req: Request, @Res() res: Response) {
    const summary = await grantTrialBalanceToEligibleUsers(req.user!.id);
    await writeAudit(req.user!.id, "trial_balance.bulk_grant", "service_setting", "trialBalanceSettings", summary);
    res.json(summary);
  }

  @Patch("/settings/:key")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async patchsettingsKey34(@Req() req: Request, @Res() res: Response) {
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
  }

  @Get("/knowledge")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getknowledge35(@Req() _req: Request, @Res() res: Response) {
    res.json(await prisma.knowledgeArticle.findMany({ orderBy: [{ category: "asc" }, { sortOrder: "asc" }] }));
  }

  @Post("/knowledge")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postknowledge36(@Req() req: Request, @Res() res: Response) {
    const input = knowledgeSchema.parse(req.body);
    const article = await prisma.knowledgeArticle.create({ data: input });
    await writeAudit(req.user!.id, "knowledge.create", "knowledge_article", article.id, input);
    res.status(201).json(article);
  }

  @Patch("/knowledge/:id")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async patchknowledgeId37(@Req() req: Request, @Res() res: Response) {
    const input = knowledgeSchema.partial().parse(req.body);
    const article = await prisma.knowledgeArticle.update({ where: { id: req.params.id }, data: input });
    await writeAudit(req.user!.id, "knowledge.update", "knowledge_article", article.id, input);
    res.json(article);
  }

  @Patch("/performer-documents/:id/status")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async patchperformerDocumentsIdStatus38(@Req() req: Request, @Res() res: Response) {
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
    res.json(serializePerformerDocument(document));
  }

  @Post("/archive/run")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postarchiveRun39(@Req() req: Request, @Res() res: Response) {
    const input = z.object({ completedRequestDays: z.number().int().positive().default(30) }).parse(req.body ?? {});
    const archivedUsers = await archiveSafePendingUsers(req.user!.id);
    const archivedRequests = await archiveCompletedRequestsOlderThanNdays(req.user!.id, input.completedRequestDays);
    res.json({ archivedUsers, archivedRequests });
  }

  @Patch("/categories/:id")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async patchcategoriesId40(@Req() req: Request, @Res() res: Response) {
    const input = categorySchema.partial().parse(req.body);
    const category = await prisma.serviceCategory.update({ where: { id: req.params.id }, data: input });
    await writeAudit(req.user!.id, "category.update", "category", category.id, input);
    res.json(category);
  }

  @Get("/balance-transactions")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getbalanceTransactions41(@Req() _req: Request, @Res() res: Response) {
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
  }

  @Get("/legal/documents")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getlegalDocuments42(@Req() _req: Request, @Res() res: Response) {
    res.json(await prisma.legalDocument.findMany({ orderBy: [{ type: "asc" }, { version: "desc" }] }));
  }

  @Post("/legal/documents")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postlegalDocuments43(@Req() req: Request, @Res() res: Response) {
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
  }

  @Post("/legal/documents/:id/new-version")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postlegalDocumentsIdNewVersion44(@Req() req: Request, @Res() res: Response) {
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
  }

  @Patch("/legal/documents/:id")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async patchlegalDocumentsId45(@Req() req: Request, @Res() res: Response) {
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
  }

  @Post("/legal/documents/:id/publish")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postlegalDocumentsIdPublish46(@Req() req: Request, @Res() res: Response) {
    res.json(await publishLegalDocument(req.params.id, req.user!.id));
  }

  @Post("/legal/documents/:id/archive")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postlegalDocumentsIdArchive47(@Req() req: Request, @Res() res: Response) {
    const document = await prisma.legalDocument.update({
      where: { id: req.params.id },
      data: { isActive: false, archivedAt: new Date() }
    });
    await writeAudit(req.user!.id, "legal_document.archive", "legal_document", document.id, {
      type: document.type,
      version: document.version
    });
    res.json(document);
  }

  @Get("/legal/consents")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getlegalConsents48(@Req() _req: Request, @Res() res: Response) {
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
  }

  @Get("/legal/export-logs")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getlegalExportLogs49(@Req() _req: Request, @Res() res: Response) {
    res.json(await prisma.consentExportLog.findMany({ orderBy: { exportedAt: "desc" }, take: 50 }));
  }

  @Get("/legal/exports/all.xlsx")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getlegalExportsAllXlsx50(@Req() req: Request, @Res() res: Response) {
    res.json(await buildAllConsentsExport(req.user!.id, requestMeta(req)));
  }

  @Get("/legal/exports/archive.zip")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getlegalExportsArchiveZip51(@Req() req: Request, @Res() res: Response) {
    res.json(await buildLegalArchiveExport(req.user!.id, requestMeta(req)));
  }

  @Get("/users/:userId/legal/consents")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getusersUserIdLegalConsents52(@Req() req: Request, @Res() res: Response) {
    const user = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { id: true, role: true } });
    if (!user) {
      throw new HttpError(404, "Пользователь не найден", "user_not_found");
    }
    res.json(await getConsentStatuses(user.id, user.role as UserRole));
  }

  @Get("/users/:userId/legal/consents.xlsx")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getusersUserIdLegalConsentsXlsx53(@Req() req: Request, @Res() res: Response) {
    res.json(await buildUserConsentsExport(req.params.userId, req.user!.id, requestMeta(req)));
  }

  @Get("/users/:userId/legal/archive.zip")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getusersUserIdLegalArchiveZip54(@Req() req: Request, @Res() res: Response) {
    res.json(await buildUserLegalArchiveExport(req.params.userId, req.user!.id, requestMeta(req)));
  }

  @Get("/legal/security-checklist")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getlegalSecurityChecklist55(@Req() _req: Request, @Res() res: Response) {
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
  }
}
