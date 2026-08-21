import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import type { Request, Response } from "express";
import { prisma } from "../../../db/prisma";
import { env } from "../../../config/env";
import { isVkIdConfigured } from "../../../services/vkIdService";
@Controller("api/public")
export class PublicController {
  @Get("/bootstrap")
  async getbootstrap0(@Req() _req: Request, @Res() res: Response) {
    const [cities, categories] = await Promise.all([
      prisma.city.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      prisma.serviceCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } })
    ]);

    res.json({
      cities,
      categories,
      settings: {
        defaultServiceFeeAmount: env.defaultServiceFeeAmount,
        defaultCommissionAmount: env.defaultCommissionAmount,
        defaultMinTopUpAmount: env.defaultMinTopUpAmount,
        yandexMapsEnabled: Boolean(env.yandexMapsApiKey),
        vkIdEnabled: isVkIdConfigured(),
        servicePositioning: "Локальный сервис помощи для семьи, дома и близких",
        medicalServicesForbidden: true
      }
    });
  }
}
