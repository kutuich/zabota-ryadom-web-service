import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../../db/prisma";
import { linkUserCityTx, type SettlementRoleScope } from "../../../services/settlementService";
import { HttpError } from "../../../utils/http";

const roleScopeSchema = z.enum(["customer", "helper", "both"]);
@Controller("api/me/cities")
export class MeCitiesController {
  @Get("/")
  @UseGuards(NestJwtAuthGuard)
  async getroot0(@Req() req: Request, @Res() res: Response) {
    const rows = await prisma.userCity.findMany({
      where: { userId: req.user!.id, isActive: true },
      include: { city: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }]
    });
    res.json({
      primaryCity: rows.find((row) => row.isPrimary) ?? null,
      additionalCities: rows.filter((row) => !row.isPrimary),
      cities: rows
    });
  }

  @Post("/")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard)
  async postroot1(@Req() req: Request, @Res() res: Response) {
    const input = z.object({ cityId: z.string().min(1), roleScope: roleScopeSchema, isPrimary: z.boolean().optional() }).parse(req.body);
    const existing = await prisma.userCity.findUnique({ where: { userId_cityId: { userId: req.user!.id, cityId: input.cityId } } });
    if (existing?.isActive) throw new HttpError(409, "Этот город уже добавлен в профиль", "user_city_exists");
    const result = await prisma.$transaction((tx) => linkUserCityTx(tx, { userId: req.user!.id, ...input }));
    res.status(201).json(result);
  }

  @Patch("/:id")
  @UseGuards(NestJwtAuthGuard)
  async patchid2(@Req() req: Request, @Res() res: Response) {
    const input = z.object({ roleScope: roleScopeSchema.optional(), isPrimary: z.boolean().optional(), isActive: z.boolean().optional() }).parse(req.body);
    const row = await prisma.userCity.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!row) throw new HttpError(404, "Город профиля не найден", "user_city_not_found");
    if (input.isActive === false && row.isPrimary) throw new HttpError(400, "Сначала выберите другой основной город", "primary_city_required");
    if (input.isPrimary) {
      const updated = await prisma.$transaction((tx) => linkUserCityTx(tx, {
        userId: req.user!.id,
        cityId: row.cityId,
        roleScope: (input.roleScope ?? row.roleScope) as SettlementRoleScope,
        isPrimary: true
      }));
      return res.json(updated);
    }
    res.json(await prisma.userCity.update({ where: { id: row.id }, data: input }));
  }

  @Delete("/:id")
  @UseGuards(NestJwtAuthGuard)
  async deleteid3(@Req() req: Request, @Res() res: Response) {
    const row = await prisma.userCity.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!row) throw new HttpError(404, "Город профиля не найден", "user_city_not_found");
    if (row.isPrimary) throw new HttpError(400, "Сначала выберите другой основной город", "primary_city_required");
    await prisma.userCity.update({ where: { id: row.id }, data: { isActive: false } });
    res.status(204).send();
  }
}
