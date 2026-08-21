import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../../db/prisma";
import { getServiceFeeSettings } from "../../../services/balanceService";
import { calculatePrice } from "../../../services/pricingService";
import { HttpError } from "../../../utils/http";

const quoteSchema = z.object({
  categoryId: z.string().min(1),
  packageId: z.string().optional(),
  helperAmount: z.number().int().positive().optional(),
  selectedAddonIds: z.array(z.string()).optional(),
  addonQuantities: z.record(z.number().positive()).optional(),
  addonAmounts: z.record(z.number().int().positive()).optional(),
  expectedDurationHours: z.number().positive().optional(),
  durationHours: z.number().positive().optional(),
  urgency: z.string().optional(),
  scheduleType: z.string().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  timeFrom: z.string().optional(),
  helpFor: z.string().optional(),
  selectedActions: z.array(z.string()).optional(),
  extraActions: z.array(z.string()).optional(),
  additionalActions: z.array(z.string()).optional(),
  dependentState: z.array(z.string()).optional(),
  hygieneLevel: z.string().optional(),
  physicalLoadLevel: z.string().optional(),
  physicalHelpLevel: z.string().optional(),
  taskVolumeLevel: z.string().optional(),
  urgencyFlags: z.array(z.string()).optional(),
  isRemoteAddress: z.boolean().optional(),
  transportOption: z.string().optional(),
  mobilityFlags: z
    .object({
      limitedMobility: z.boolean().optional(),
      bedridden: z.boolean().optional(),
      fallRisk: z.boolean().optional(),
      wheelchair: z.boolean().optional(),
      bigWeight: z.boolean().optional(),
      cognitiveFeatures: z.boolean().optional(),
      transferHelp: z.boolean().optional(),
      positionChange: z.boolean().optional()
    })
    .optional(),
  hasLimitedMobility: z.boolean().optional(),
  needsCooking: z.boolean().optional(),
  needsCleaning: z.boolean().optional(),
  needsWalk: z.boolean().optional(),
  needsHygieneHelp: z.boolean().optional(),
  hasPets: z.boolean().optional()
});
@Controller("api/pricing")
export class PricingController {
  @Post("/quote")
  @HttpCode(200)
  async postquote0(@Req() req: Request, @Res() res: Response) {
    const input = quoteSchema.parse(req.body);
    const category = await prisma.serviceCategory.findFirst({
      where: { id: input.categoryId, isActive: true }
    });

    if (!category) {
      throw new HttpError(404, "Категория не найдена", "category_not_found");
    }

    const fees = await getServiceFeeSettings();
    res.json(calculatePrice({ category, ...input, ...fees }));
  }
}
