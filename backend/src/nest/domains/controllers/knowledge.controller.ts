import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import type { Request, Response } from "express";
import { prisma } from "../../../db/prisma";
@Controller("api/knowledge")
export class KnowledgeController {
  @Get("/")
  async getroot0(@Req() req: Request, @Res() res: Response) {
    const audience = String(req.query.audience ?? "all");
    res.json(
      await prisma.knowledgeArticle.findMany({
        where: {
          isPublished: true,
          OR: [{ audience: "all" }, { audience }]
        },
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }]
      })
    );
  }
}
