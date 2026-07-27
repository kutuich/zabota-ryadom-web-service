import { Router } from "express";
import { prisma } from "../db/prisma";
import { asyncHandler } from "../utils/http";
import { env } from "../config/env";
import { isVkIdConfigured } from "../services/vkIdService";

export const publicRouter = Router();

publicRouter.get(
  "/bootstrap",
  asyncHandler(async (_req, res) => {
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
  })
);
