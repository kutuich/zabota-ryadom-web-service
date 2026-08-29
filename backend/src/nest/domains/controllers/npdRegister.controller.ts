import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import type { Request, Response } from "express";
import { z } from "zod";
import { listNpdRegister, updateNpdRegisterEntry } from "../../../services/npdTaxRegisterService";
@Controller("api/admin/npd-register")
export class NpdRegisterController {
  @Get("/")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getroot0(@Req() req: Request, @Res() res: Response) {
    const query = z.object({
      from: z.string().optional(),
      to: z.string().optional()
    }).parse(req.query);
    res.json(await listNpdRegister(query.from, query.to));
  }

  @Patch("/:id")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async patchid1(@Req() req: Request, @Res() res: Response) {
    const input = z.object({
      npdStatus: z.enum(["pending", "recorded", "not_required", "needs_review"]).optional(),
      npdComment: z.string().max(1000).nullable().optional()
    }).parse(req.body);
    res.json(await updateNpdRegisterEntry({
      entryId: req.params.id,
      actorUserId: req.user!.id,
      ...input
    }));
  }
}
