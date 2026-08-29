import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { ApiProduces, ApiResponse } from "@nestjs/swagger";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import type { Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../../db/prisma";
import { writeAudit } from "../../../services/auditService";
import { requireFeatureConsent } from "../../../services/legalService";
import { resolvePerformerDocumentKey, savePerformerDocumentFile } from "../../../services/uploadStorage";
import { ObjectStorageNotFoundError } from "../../../storage/objectStorage";
import { objectStorage } from "../../../storage/storageProvider";
import { HttpError } from "../../../utils/http";
import { ApiZodBody } from "../../openapi/zod-openapi";

export const performerDocumentUploadSchema = z.object({
  type: z.enum(["self_employed", "criminal_record"]),
  fileName: z.string().min(3).max(240),
  fileData: z.string().min(1)
});

export function serializePerformerDocument<T extends { id: string; storagePath?: string | null; fileUrl: string }>(document: T) {
  const { storagePath: _storagePath, ...safe } = document;
  return { ...safe, fileUrl: `/api/performer-documents/${document.id}/download` };
}

export function assertPerformerDocumentDownloadAccess(viewer: { id: string; realRole: string }, document: { performerId: string }) {
  if (document.performerId !== viewer.id && viewer.realRole !== "superadmin") {
    throw new HttpError(403, "Нет доступа к документу", "performer_document_access_denied");
  }
}
@Controller("api/performer-documents")
export class PerformerDocumentsController {
  @Get("/")
  @RequireRoles("performer")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async getroot0(@Req() req: Request, @Res() res: Response) {
    res.json(
      (await prisma.performerDocument.findMany({
        where: { performerId: req.user!.id },
        orderBy: { uploadedAt: "desc" }
      })).map(serializePerformerDocument)
    );
  }

  @Post("/")
  @HttpCode(200)
  @ApiZodBody(performerDocumentUploadSchema, "Base64-encoded protected document upload; this endpoint does not use multipart/form-data")
  @RequireRoles("performer")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard, NestFeatureConsentGuard("upload_helper_document"))
  async postroot1(@Req() req: Request, @Res() res: Response) {
    const input = performerDocumentUploadSchema.parse(req.body);

    const storedFile = await savePerformerDocumentFile({
      performerId: req.user!.id,
      type: input.type,
      fileName: input.fileName,
      fileData: input.fileData
    });

    const existing = await prisma.performerDocument.findFirst({
      where: { performerId: req.user!.id, type: input.type },
      orderBy: { uploadedAt: "desc" }
    });

    const documentId = existing?.id ?? randomUUID();
    const protectedFileUrl = `/api/performer-documents/${documentId}/download`;
    const document = existing
      ? await prisma.performerDocument.update({
          where: { id: existing.id },
          data: {
            fileName: input.fileName,
            fileUrl: protectedFileUrl,
            originalFileName: storedFile.originalFileName,
            storagePath: storedFile.storagePath,
            mimeType: storedFile.mimeType,
            fileSize: storedFile.size,
            checksum: storedFile.checksum,
            status: "uploaded",
            uploadedAt: new Date(),
            verifiedAt: null,
            adminComment: null
          }
        })
      : await prisma.performerDocument.create({
        data: {
            id: documentId,
            performerId: req.user!.id,
            type: input.type,
            fileName: input.fileName,
            fileUrl: protectedFileUrl,
            originalFileName: storedFile.originalFileName,
            storagePath: storedFile.storagePath,
            mimeType: storedFile.mimeType,
            fileSize: storedFile.size,
            checksum: storedFile.checksum,
            status: "uploaded"
          }
        });

    await writeAudit(req.user!.id, existing ? "performer_document.replace" : "performer_document.upload", "performer_document", document.id, {
      type: input.type,
      fileName: input.fileName,
      checksum: storedFile.checksum
    });
    res.status(201).json(serializePerformerDocument(document));
  }

  @Get("/:id/download")
  @ApiProduces("application/octet-stream")
  @ApiResponse({ status: 200, description: "Protected performer document", schema: { type: "string", format: "binary" } })
  @UseGuards(NestJwtAuthGuard)
  async getidDownload2(@Req() req: Request, @Res() res: Response) {
    const document = await prisma.performerDocument.findUnique({ where: { id: req.params.id } });
    if (!document) throw new HttpError(404, "Документ не найден", "performer_document_not_found");
    const isOwner = document.performerId === req.user!.id;
    assertPerformerDocumentDownloadAccess(req.user!, document);
    const objectKey = resolvePerformerDocumentKey(document);
    let bytes: Buffer;
    try { bytes = (await objectStorage.get(objectKey)).body; } catch (error) {
      if (error instanceof ObjectStorageNotFoundError) throw new HttpError(404, "Файл документа не найден", "performer_document_file_missing");
      throw error;
    }
    if (document.checksum && createHash("sha256").update(bytes).digest("hex") !== document.checksum) {
      throw new HttpError(409, "Контрольная сумма документа не совпадает", "performer_document_checksum_mismatch");
    }
    await writeAudit(req.user!.id, isOwner ? "performer_document.download" : "admin.performer_document.download", "performer_document", document.id, {
      performerId: document.performerId
    });
    res.attachment(document.originalFileName ?? document.fileName);
    res.type(document.mimeType ?? "application/octet-stream");
    res.send(bytes);
  }
}
