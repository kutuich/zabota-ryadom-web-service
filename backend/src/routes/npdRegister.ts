import { Router } from "express";
import { z } from "zod";
import { authenticate, requireAdmin } from "../middleware/auth";
import { listNpdRegister, updateNpdRegisterEntry } from "../services/npdTaxRegisterService";
import { asyncHandler } from "../utils/http";

export const npdRegisterRouter = Router();

npdRegisterRouter.use(authenticate, requireAdmin);

npdRegisterRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = z.object({
      from: z.string().optional(),
      to: z.string().optional()
    }).parse(req.query);
    res.json(await listNpdRegister(query.from, query.to));
  })
);

npdRegisterRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = z.object({
      npdStatus: z.enum(["pending", "recorded", "not_required", "needs_review"]).optional(),
      npdComment: z.string().max(1000).nullable().optional()
    }).parse(req.body);
    res.json(await updateNpdRegisterEntry({
      entryId: req.params.id,
      actorUserId: req.user!.id,
      ...input
    }));
  })
);
