import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../../db/prisma";
import { writeAudit } from "../../../services/auditService";
import {
  acceptLatestLegalDocuments,
  buildAllConsentsExport,
  buildLegalArchiveExport,
  buildUserLegalArchiveExport,
  buildUserConsentsExport,
  calculateLegalDocumentHash,
  getConsentStatuses,
  getPublishedLegalDocumentBySlug,
  getPublishedLegalDocuments,
  publishLegalDocument
} from "../../../services/legalService";
import type { UserRole } from "../../../types/domain";
import { HttpError } from "../../../utils/http";

const legalDocumentSchema = z.object({
  type: z.string().min(2).max(120),
  roleScope: z.enum(["all", "customer", "helper", "admin"]),
  title: z.string().min(3).max(240),
  slug: z.string().min(2).max(160).regex(/^[a-z0-9-]+$/),
  version: z.string().min(1).max(40),
  contentMarkdown: z.string().min(20),
  isRequired: z.boolean().default(true)
});

function nextVersion(version: string) {
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
@Controller("api/legal")
export class LegalController {
  @Get("/documents")
  async getdocuments0(@Req() _req: Request, @Res() res: Response) {
    res.json(await getPublishedLegalDocuments());
  }

  @Get("/documents/:slug")
  async getdocumentsSlug1(@Req() req: Request, @Res() res: Response) {
    const document = await getPublishedLegalDocumentBySlug(req.params.slug);
    if (!document) {
      throw new HttpError(404, "Юридический документ не найден", "legal_document_not_found");
    }
    res.json(document);
  }

  @Get("/me/status")
  @UseGuards(NestJwtAuthGuard)
  async getmeStatus2(@Req() req: Request, @Res() res: Response) {
    res.json(await getConsentStatuses(req.user!.id, req.user!.role));
  }

  @Get("/my-consents")
  @UseGuards(NestJwtAuthGuard)
  async getmyConsents3(@Req() req: Request, @Res() res: Response) {
    res.json(await getConsentStatuses(req.user!.id, req.user!.role));
  }

  @Post("/consents/accept")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard)
  async postconsentsAccept4(@Req() req: Request, @Res() res: Response) {
    const input = z.object({
      documentTypes: z.array(z.string().min(2)).min(1),
      source: z.string().min(2).max(80).default("profile")
    }).parse(req.body);

    await acceptLatestLegalDocuments({
      userId: req.user!.id,
      documentTypes: input.documentTypes,
      source: input.source,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] ?? null
    });
    res.json(await getConsentStatuses(req.user!.id, req.user!.role));
  }

  @Post("/consents/revoke-optional")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard)
  async postconsentsRevokeOptional5(@Req() req: Request, @Res() res: Response) {
    const input = z.object({
      documentType: z.string().min(2),
      reason: z.string().max(500).optional()
    }).parse(req.body);
    const consent = await prisma.userConsent.findFirst({
      where: {
        userId: req.user!.id,
        documentType: input.documentType,
        isActive: true,
        revokedAt: null
      },
      include: { document: true },
      orderBy: { acceptedAt: "desc" }
    });
    if (!consent) {
      throw new HttpError(404, "Активное согласие не найдено", "consent_not_found");
    }
    if (consent.isRequired || consent.document.isRequired) {
      throw new HttpError(400, "Обязательное согласие нельзя отозвать без ограничения доступа к сервису", "required_consent_cannot_be_revoked");
    }
    await prisma.userConsent.update({
      where: { id: consent.id },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revocationReason: input.reason ?? "Отозвано пользователем"
      }
    });
    await prisma.userConsentAuditLog.create({
      data: {
        userId: req.user!.id,
        action: "consent.revoked_optional",
        documentType: consent.documentType,
        documentVersion: consent.documentVersion,
        oldValue: JSON.stringify({ isActive: consent.isActive, revokedAt: consent.revokedAt }),
        newValue: JSON.stringify({ isActive: false, reason: input.reason ?? null }),
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
        comment: "Пользователь отозвал необязательное согласие"
      }
    });
    res.json(await getConsentStatuses(req.user!.id, req.user!.role));
  }

  @Get("/admin/documents")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getadminDocuments6(@Req() _req: Request, @Res() res: Response) {
    res.json(await prisma.legalDocument.findMany({ orderBy: [{ type: "asc" }, { version: "desc" }] }));
  }

  @Post("/admin/documents")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postadminDocuments7(@Req() req: Request, @Res() res: Response) {
    const input = legalDocumentSchema.parse(req.body);
    const contentHash = calculateLegalDocumentHash(input);
    const document = await prisma.legalDocument.create({
      data: {
        ...input,
        contentHash,
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

  @Patch("/admin/documents/:id")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async patchadminDocumentsId8(@Req() req: Request, @Res() res: Response) {
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

  @Post("/admin/documents/:id/new-version")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postadminDocumentsIdNewVersion9(@Req() req: Request, @Res() res: Response) {
    const existing = await prisma.legalDocument.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      throw new HttpError(404, "Юридический документ не найден", "legal_document_not_found");
    }
    const input = legalDocumentSchema.partial().extend({
      version: z.string().min(1).default(nextVersion(existing.version))
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

  @Post("/admin/documents/:id/publish")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postadminDocumentsIdPublish10(@Req() req: Request, @Res() res: Response) {
    res.json(await publishLegalDocument(req.params.id, req.user!.id));
  }

  @Post("/admin/documents/:id/archive")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postadminDocumentsIdArchive11(@Req() req: Request, @Res() res: Response) {
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

  @Get("/admin/consents")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getadminConsents12(@Req() _req: Request, @Res() res: Response) {
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

  @Get("/admin/users/:id/consents")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getadminUsersIdConsents13(@Req() req: Request, @Res() res: Response) {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, role: true } });
    if (!user) {
      throw new HttpError(404, "Пользователь не найден", "user_not_found");
    }
    res.json(await getConsentStatuses(user.id, user.role as UserRole));
  }

  @Post("/admin/exports/all-consents")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postadminExportsAllConsents14(@Req() req: Request, @Res() res: Response) {
    res.json(await buildAllConsentsExport(req.user!.id, requestMeta(req)));
  }

  @Post("/admin/users/:id/export-consents")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postadminUsersIdExportConsents15(@Req() req: Request, @Res() res: Response) {
    res.json(await buildUserConsentsExport(req.params.id, req.user!.id, requestMeta(req)));
  }

  @Post("/admin/users/:id/export-archive")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postadminUsersIdExportArchive16(@Req() req: Request, @Res() res: Response) {
    res.json(await buildUserLegalArchiveExport(req.params.id, req.user!.id, requestMeta(req)));
  }

  @Post("/admin/exports/legal-archive")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postadminExportsLegalArchive17(@Req() req: Request, @Res() res: Response) {
    res.json(await buildLegalArchiveExport(req.user!.id, requestMeta(req)));
  }

  @Get("/admin/security-checklist")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getadminSecurityChecklist18(@Req() _req: Request, @Res() res: Response) {
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
