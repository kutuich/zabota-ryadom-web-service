import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { writeAudit } from "../services/auditService";
import { requireFeatureConsent } from "../services/legalService";
import { savePerformerDocumentFile } from "../services/uploadStorage";
import { asyncHandler } from "../utils/http";

export const performerDocumentsRouter = Router();

performerDocumentsRouter.use(authenticate, requireRole("performer"));

performerDocumentsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.performerDocument.findMany({
        where: { performerId: req.user!.id },
        orderBy: { uploadedAt: "desc" }
      })
    );
  })
);

performerDocumentsRouter.post(
  "/",
  requireFeatureConsent("upload_helper_document"),
  asyncHandler(async (req, res) => {
    const input = z.object({
      type: z.enum(["self_employed", "criminal_record"]),
      fileName: z.string().min(3).max(240),
      fileData: z.string().optional(),
      fileUrl: z.string().min(3).max(1000).optional()
    }).refine((value) => value.fileData || value.fileUrl, {
      message: "Выберите файл документа"
    }).parse(req.body);

    const storedFile = input.fileData
      ? await savePerformerDocumentFile({
          performerId: req.user!.id,
          type: input.type,
          fileName: input.fileName,
          fileData: input.fileData
        })
      : { fileUrl: input.fileUrl! };

    const existing = await prisma.performerDocument.findFirst({
      where: { performerId: req.user!.id, type: input.type },
      orderBy: { uploadedAt: "desc" }
    });

    const document = existing
      ? await prisma.performerDocument.update({
          where: { id: existing.id },
          data: {
            fileName: input.fileName,
            fileUrl: storedFile.fileUrl,
            status: "uploaded",
            uploadedAt: new Date(),
            verifiedAt: null,
            adminComment: null
          }
        })
      : await prisma.performerDocument.create({
          data: {
            performerId: req.user!.id,
            type: input.type,
            fileName: input.fileName,
            fileUrl: storedFile.fileUrl,
            status: "uploaded"
          }
        });

    await writeAudit(req.user!.id, existing ? "performer_document.replace" : "performer_document.upload", "performer_document", document.id, {
      type: input.type,
      fileName: input.fileName,
      fileUrl: storedFile.fileUrl
    });
    res.status(201).json(document);
  })
);
