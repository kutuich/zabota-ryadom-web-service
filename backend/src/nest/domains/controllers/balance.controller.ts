import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import type { Request, Response } from "express";
import { z } from "zod";
import { env } from "../../../config/env";
import { getBalanceSummary, mockTopUp } from "../../../services/balanceService";
import { requireFeatureConsent } from "../../../services/legalService";
import { HttpError } from "../../../utils/http";
@Controller("api/balance")
export class BalanceController {
  @Get("/me")
  @UseGuards(NestJwtAuthGuard)
  async getme0(@Req() req: Request, @Res() res: Response) {
    res.json(await getBalanceSummary(req.user!.id));
  }

  @Post("/mock-top-up")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestFeatureConsentGuard("top_up_balance"))
  async postmockTopUp1(@Req() req: Request, @Res() res: Response) {
    if (env.nodeEnv === "production" || !env.allowLegacyMockTopUp) {
      throw new HttpError(403, "Тестовое пополнение недоступно", "legacy_mock_top_up_forbidden");
    }
    const input = z.object({ amount: z.number().int().positive() }).parse(req.body);
    res.json(await mockTopUp(req.user!.id, input.amount));
  }
}
