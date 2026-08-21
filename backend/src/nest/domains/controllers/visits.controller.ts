import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../../db/prisma";
import { HttpError } from "../../../utils/http";
import { openVisitDispute, reconcileDueVisits, reserveSummary, resolveVisitDispute } from "../../../services/visitOperationsService";
import { visitReconciliationScheduler } from "../../../services/visitReconciliationScheduler";
@Controller("api/visits")
export class VisitsController {
  @Get("/request/:requestId")
  @UseGuards(NestJwtAuthGuard)
  async getrequestRequestId0(@Req() req: Request, @Res() res: Response) {
  await reconcileDueVisits();
  const request = await prisma.clientRequest.findUnique({ where: { id: req.params.requestId }, select: { clientId: true, selectedPerformerId: true } });
  if (!request) throw new HttpError(404, "Заявка не найдена", "request_not_found");
  if (![request.clientId, request.selectedPerformerId].includes(req.user!.id) && !["admin", "superadmin", "manager"].includes(req.user!.role)) throw new HttpError(403, "Нет доступа к визитам", "forbidden");
  res.json(await prisma.requestVisit.findMany({ where: { requestId: req.params.requestId }, include: { allocations: req.user!.role === "admin" || req.user!.role === "superadmin", disputes: true }, orderBy: { scheduledStart: "asc" } }));
}

  @Post("/:visitId/disputes")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard)
  async postvisitIdDisputes1(@Req() req: Request, @Res() res: Response) {
  const input = z.object({ reason: z.enum(["helper_no_show", "customer_cancelled", "helper_cancelled", "time_changed", "tasks_not_agreed", "other"]), description: z.string().max(2000).optional() }).parse(req.body);
  res.status(201).json(await openVisitDispute(req.params.visitId, req.user!, input.reason, input.description));
}
}

@Controller("api/admin/visits")
export class AdminVisitsController {
  @Get("/reserve-summary")
  @UseGuards(NestJwtAuthGuard, NestAdminManagerGuard)
  async getreserveSummary0(@Req() _req: Request, @Res() res: Response) { await reconcileDueVisits(); res.json({ ...await reserveSummary(), reconciliation: visitReconciliationScheduler.getDiagnostics() }); }

  @Post("/reconcile")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminManagerGuard, NestAdminGuard)
  async postreconcile1(@Req() _req: Request, @Res() res: Response) {
    return res.json(await visitReconciliationScheduler.runOnce("manual"));
  }

  @Post("/disputes/:id/resolve")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminManagerGuard, NestAdminGuard)
  async postdisputesIdResolve2(@Req() req: Request, @Res() res: Response) {
  const input = z.object({ resolution: z.enum(["keep_fee", "return_to_source"]), comment: z.string().min(3).max(2000) }).parse(req.body);
  res.json(await resolveVisitDispute(req.params.id, req.user!.id, input.resolution, input.comment));
}
}
