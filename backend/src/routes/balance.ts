import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth";
import { getBalanceSummary, mockTopUp } from "../services/balanceService";
import { requireFeatureConsent } from "../services/legalService";
import { asyncHandler } from "../utils/http";

export const balanceRouter = Router();

balanceRouter.use(authenticate);

balanceRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    res.json(await getBalanceSummary(req.user!.id));
  })
);

balanceRouter.post(
  "/mock-top-up",
  requireFeatureConsent("top_up_balance"),
  asyncHandler(async (req, res) => {
    const input = z.object({ amount: z.number().int().positive() }).parse(req.body);
    res.json(await mockTopUp(req.user!.id, input.amount));
  })
);
