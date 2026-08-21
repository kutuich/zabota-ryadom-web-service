import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { prisma } from "../../../db/prisma";
import { writeAudit } from "../../../services/auditService";
import { resolveAgreementContractPath } from "../../../services/agreementContractService";
import { HttpError } from "../../../utils/http";

async function loadContract(id: string, viewer: { id: string; realRole: string }) {
  const contract = await prisma.agreementContract.findUnique({
    where: { id },
    include: { chat: { select: { clientId: true, performerId: true } } }
  });
  if (!contract) throw new HttpError(404, "Проект договора не найден", "agreement_contract_not_found");
  assertAgreementContractAccess(viewer, contract.chat);
  return contract;
}

export function assertAgreementContractAccess(viewer: { id: string; realRole: string }, chat: { clientId: string; performerId: string }) {
  const isParticipant = [chat.clientId, chat.performerId].includes(viewer.id);
  if (!isParticipant && viewer.realRole !== "superadmin") {
    throw new HttpError(403, "Нет доступа к проекту договора", "agreement_contract_access_denied");
  }
}

export function serializeAgreementContract(contract: any, includeContent = false) {
  return {
    id: contract.id,
    requestId: contract.requestId,
    agreementVersionId: contract.agreementVersionId,
    templateVersion: contract.templateVersion,
    documentVersion: contract.documentVersion,
    status: contract.status,
    title: contract.title,
    checksum: contract.checksum,
    fileName: contract.fileName,
    mimeType: contract.mimeType,
    fileSize: contract.fileSize,
    createdAt: contract.createdAt,
    ...(includeContent ? { contentText: contract.contentText } : {})
  };
}
@Controller("api/agreement-contracts")
export class AgreementContractsController {
  @Get("/:id")
  @UseGuards(NestJwtAuthGuard)
  async getid0(@Req() req: Request, @Res() res: Response) {
  const contract = await loadContract(req.params.id, req.user!);
  res.json(serializeAgreementContract(contract, true));
}

  @Get("/:id/download")
  @UseGuards(NestJwtAuthGuard)
  async getidDownload1(@Req() req: Request, @Res() res: Response) {
  const contract = await loadContract(req.params.id, req.user!);
  const filePath = resolveAgreementContractPath(contract.storagePath);
  let bytes: Buffer;
  try { bytes = await fs.readFile(filePath); } catch { throw new HttpError(404, "Файл проекта договора не найден", "agreement_contract_file_missing"); }
  if (createHash("sha256").update(bytes).digest("hex") !== contract.checksum) {
    throw new HttpError(409, "Контрольная сумма проекта договора не совпадает", "agreement_contract_checksum_mismatch");
  }
  await writeAudit(req.user!.id, "agreement_contract.download", "agreement_contract", contract.id, {
    requestId: contract.requestId,
    agreementVersionId: contract.agreementVersionId,
    checksum: contract.checksum
  });
  res.type(contract.mimeType);
  res.download(filePath, contract.fileName);
}
}
