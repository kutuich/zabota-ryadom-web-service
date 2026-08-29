import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../../db/prisma";
import {
  normalizeSettlementName,
  sanitizeSettlementText,
  SETTLEMENT_TYPES,
  settlementDto
} from "../../../services/settlementService";

const suggestSchema = z.object({
  name: z.string().min(2).max(120),
  region: z.string().max(160).optional().default(""),
  district: z.string().max(160).optional(),
  type: z.enum(SETTLEMENT_TYPES).optional().default("other")
});
@Controller("api/settlements")
export class SettlementsController {
  @Get("/search")
  async getsearch0(@Req() req: Request, @Res() res: Response) {
    const query = z.string().trim().min(2).max(100).parse(req.query.q);
    const normalizedQuery = normalizeSettlementName(query);
    const candidates = await prisma.city.findMany({
      where: {
        isActive: true,
        directoryStatus: { notIn: ["hidden", "duplicate"] },
        OR: [
          { normalizedName: { contains: normalizedQuery } },
          { region: { contains: query } },
          { district: { contains: query } }
        ]
      },
      take: 100
    });
    const hasUsableRegion = (city: (typeof candidates)[number]) => {
      const region = normalizeSettlementName(city.region ?? "");
      return Boolean(city.regionId) && region !== "регион не указан" && region !== "не указан";
    };
    const publicCandidates = candidates.filter(hasUsableRegion);
    const deduplicated = new Map<string, (typeof candidates)[number]>();
    for (const city of publicCandidates) {
      const key = `${normalizeSettlementName(city.name)}:${city.regionId}`;
      const current = deduplicated.get(key);
      if (!current || ["verified", "directory"].includes(city.directoryStatus)) deduplicated.set(key, city);
    }
    const visibleCandidates = [...deduplicated.values()];
    const rankStatus = (status: string) => ["verified", "directory"].includes(status) ? 0 : 1;
    visibleCandidates.sort((left, right) => {
      const leftName = normalizeSettlementName(left.name);
      const rightName = normalizeSettlementName(right.name);
      const rank = (name: string) => name === normalizedQuery ? 0 : name.startsWith(normalizedQuery) ? 1 : 2;
      return rank(leftName) - rank(rightName)
        || rankStatus(left.directoryStatus) - rankStatus(right.directoryStatus)
        || left.name.localeCompare(right.name, "ru");
    });
    res.json(visibleCandidates.slice(0, 20).map(settlementDto));
  }

  @Post("/suggest")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard)
  async postsuggest1(@Req() req: Request, @Res() res: Response) {
    const input = suggestSchema.parse(req.body);
    const name = sanitizeSettlementText(input.name, 120);
    const region = input.region ? sanitizeSettlementText(input.region, 160) : "Регион не указан";
    const district = input.district ? sanitizeSettlementText(input.district, 160) : null;
    const normalizedName = normalizeSettlementName(name);
    const existing = await prisma.city.findFirst({ where: { normalizedName, region } });
    if (existing) return res.json({ settlement: settlementDto(existing), existing: true });

    const slugBase = normalizedName.replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-|-$/g, "") || "settlement";
    const city = await prisma.city.create({
      data: {
        name,
        normalizedName,
        slug: `${slugBase}-${Date.now().toString(36)}`,
        type: input.type,
        region,
        district,
        source: "user_suggested",
        directoryStatus: "needs_review",
        serviceStatus: "inactive",
        status: "inactive",
        isActive: true,
        mapCenterLat: 0,
        mapCenterLng: 0,
        pricingZone: "future_settlement"
      }
    });
    res.status(201).json({ settlement: settlementDto(city), existing: false });
  }
}
