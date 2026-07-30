import { Router } from "express";
import { z } from "zod";
import { authenticate, requireAdmin, requireAdminManagerOrSuperadmin } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { asyncHandler, HttpError } from "../utils/http";
import { openVisitDispute, reconcileDueVisits, reserveSummary, resolveVisitDispute } from "../services/visitOperationsService";
import { visitReconciliationScheduler } from "../services/visitReconciliationScheduler";

export const visitsRouter = Router();
visitsRouter.use(authenticate);

visitsRouter.get("/request/:requestId", asyncHandler(async (req, res) => {
  await reconcileDueVisits();
  const request = await prisma.clientRequest.findUnique({ where: { id: req.params.requestId }, select: { clientId: true, selectedPerformerId: true } });
  if (!request) throw new HttpError(404, "Заявка не найдена", "request_not_found");
  if (![request.clientId, request.selectedPerformerId].includes(req.user!.id) && !["admin", "superadmin", "manager"].includes(req.user!.role)) throw new HttpError(403, "Нет доступа к визитам", "forbidden");
  res.json(await prisma.requestVisit.findMany({ where: { requestId: req.params.requestId }, include: { allocations: req.user!.role === "admin" || req.user!.role === "superadmin", disputes: true }, orderBy: { scheduledStart: "asc" } }));
}));

visitsRouter.post("/:visitId/disputes", asyncHandler(async (req, res) => {
  const input = z.object({ reason: z.enum(["helper_no_show", "customer_cancelled", "helper_cancelled", "time_changed", "tasks_not_agreed", "other"]), description: z.string().max(2000).optional() }).parse(req.body);
  res.status(201).json(await openVisitDispute(req.params.visitId, req.user!, input.reason, input.description));
}));

export const adminVisitsRouter = Router();
adminVisitsRouter.use(authenticate, requireAdminManagerOrSuperadmin);
adminVisitsRouter.get("/reserve-summary", asyncHandler(async (_req, res) => { await reconcileDueVisits(); res.json({ ...await reserveSummary(), reconciliation: visitReconciliationScheduler.getDiagnostics() }); }));
adminVisitsRouter.post("/reconcile", requireAdmin, asyncHandler(async (_req, res) => res.json(await visitReconciliationScheduler.runOnce("manual"))));
adminVisitsRouter.post("/disputes/:id/resolve", requireAdmin, asyncHandler(async (req, res) => {
  const input = z.object({ resolution: z.enum(["keep_fee", "return_to_source"]), comment: z.string().min(3).max(2000) }).parse(req.body);
  res.json(await resolveVisitDispute(req.params.id, req.user!.id, input.resolution, input.comment));
}));
