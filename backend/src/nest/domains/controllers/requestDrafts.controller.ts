import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  createDraftSupportCase,
  createRequestDraft,
  deleteRequestDraft,
  duplicateRequestDraft,
  getRequestDraft,
  listDraftSupportCases,
  listRequestDrafts,
  publishRequestDraft,
  replyToDraftSupportCase,
  updateDraftSupportCase,
  updateRequestDraft
} from "../../../services/requestDraftService";

const draftBody = z.object({
  cityId: z.string().min(1).nullable().optional(), title: z.string().max(160).nullable().optional(),
  formData: z.record(z.string(), z.unknown()).optional(), selectedNodeSlugs: z.array(z.string()).max(500).optional(), expandedNodeSlugs: z.array(z.string()).max(1000).optional(),
  dynamicFieldValues: z.record(z.string(), z.record(z.string(), z.unknown())).optional(), scheduleDraft: z.record(z.string(), z.unknown()).optional(),
  addressDraft: z.record(z.string(), z.unknown()).optional(), beneficiaryDraft: z.record(z.string(), z.unknown()).optional(),
  latestQuote: z.record(z.string(), z.unknown()).nullable().optional(), validationState: z.record(z.string(), z.unknown()).optional(),
  revision: z.number().int().positive().optional(), autosave: z.boolean().optional()
}).strict();
@Controller("api/me/request-drafts")
export class RequestDraftsController {
  @Get("/")
  @RequireRoles("client")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async getroot0(@Req() req: Request, @Res() res: Response) {
    return res.json(await listRequestDrafts(req.user!.id, { query: String(req.query.q ?? ""), take: req.query.take ? Number(req.query.take) : undefined }));
  }

  @Post("/")
  @HttpCode(200)
  @RequireRoles("client")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async postroot1(@Req() req: Request, @Res() res: Response) {
    return res.status(201).json(await createRequestDraft(req.user!.id, draftBody.parse(req.body)));
  }

  @Get("/:id")
  @RequireRoles("client")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async getid2(@Req() req: Request, @Res() res: Response) {
    return res.json(await getRequestDraft(req.user!.id, req.params.id));
  }

  @Patch("/:id")
  @RequireRoles("client")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async patchid3(@Req() req: Request, @Res() res: Response) {
  const input = draftBody.extend({ revision: z.number().int().positive() }).parse(req.body);
  res.json(await updateRequestDraft(req.user!.id, req.params.id, input));
}

  @Delete("/:id")
  @RequireRoles("client")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async deleteid4(@Req() req: Request, @Res() res: Response) { await deleteRequestDraft(req.user!.id, req.params.id); res.status(204).end(); }

  @Post("/:id/duplicate")
  @HttpCode(200)
  @RequireRoles("client")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async postidDuplicate5(@Req() req: Request, @Res() res: Response) {
    return res.status(201).json(await duplicateRequestDraft(req.user!.id, req.params.id));
  }

  @Post("/:id/publish")
  @HttpCode(200)
  @RequireRoles("client")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async postidPublish6(@Req() req: Request, @Res() res: Response) {
    return res.json(await publishRequestDraft(req.user!.id, req.params.id, z.object({ revision: z.number().int().positive() }).strict().parse(req.body).revision));
  }

  @Post("/:id/support-cases")
  @HttpCode(200)
  @RequireRoles("client")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async postidSupportCases7(@Req() req: Request, @Res() res: Response) {
  const input = z.object({ subject: z.string().trim().min(2).max(120), message: z.string().trim().min(1).max(5000), revision: z.number().int().positive() }).strict().parse(req.body);
  res.status(201).json(await createDraftSupportCase(req.user!.id, req.params.id, input));
}

  @Get("/:id/support-cases")
  @RequireRoles("client")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async getidSupportCases8(@Req() req: Request, @Res() res: Response) {
  const draft = await getRequestDraft(req.user!.id, req.params.id);
  res.json(draft.supportCases ?? []);
}
}

@Controller("api/admin/request-support-cases")
export class RequestDraftSupportController {
  @Get("/")
  @UseGuards(NestJwtAuthGuard, NestAdminManagerGuard)
  async getroot0(@Req() req: Request, @Res() res: Response) {
    return res.json(await listDraftSupportCases(req.user!, { status: req.query.status ? String(req.query.status) : undefined, take: req.query.take ? Number(req.query.take) : undefined }));
  }

  @Post("/:id/messages")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminManagerGuard)
  async postidMessages1(@Req() req: Request, @Res() res: Response) {
    return res.status(201).json(await replyToDraftSupportCase(req.user!, req.params.id, z.object({ body: z.string().trim().min(1).max(5000) }).strict().parse(req.body).body));
  }

  @Patch("/:id/status")
  @UseGuards(NestJwtAuthGuard, NestAdminManagerGuard)
  async patchidStatus2(@Req() req: Request, @Res() res: Response) {
    return res.json(await updateDraftSupportCase(req.user!, req.params.id, z.object({ status: z.enum(["new", "in_progress", "waiting_for_client", "resolved", "closed"]) }).strict().parse(req.body)));
  }

  @Post("/:id/assign")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminManagerGuard)
  async postidAssign3(@Req() req: Request, @Res() res: Response) {
    return res.json(await updateDraftSupportCase(req.user!, req.params.id, { assignToMe: true }));
  }
}
