import { Router } from "express";
import { z } from "zod";
import { authenticate, requireAdminManagerOrSuperadmin, requireRole } from "../middleware/auth";
import { asyncHandler } from "../utils/http";
import {
  createDraftSupportCase,
  createRequestDraft,
  deleteRequestDraft,
  duplicateRequestDraft,
  getRequestDraft,
  listDraftSupportCases,
  listRequestDrafts,
  publishRequestDraft,
  replyToDraftSupportCase,
  updateDraftSupportCase,
  updateRequestDraft
} from "../services/requestDraftService";

export const requestDraftsRouter = Router();
export const requestDraftSupportRouter = Router();

const draftBody = z.object({
  cityId: z.string().min(1).nullable().optional(), title: z.string().max(160).nullable().optional(),
  formData: z.record(z.string(), z.unknown()).optional(), selectedNodeSlugs: z.array(z.string()).max(500).optional(), expandedNodeSlugs: z.array(z.string()).max(1000).optional(),
  dynamicFieldValues: z.record(z.string(), z.record(z.string(), z.unknown())).optional(), scheduleDraft: z.record(z.string(), z.unknown()).optional(),
  addressDraft: z.record(z.string(), z.unknown()).optional(), beneficiaryDraft: z.record(z.string(), z.unknown()).optional(),
  latestQuote: z.record(z.string(), z.unknown()).nullable().optional(), validationState: z.record(z.string(), z.unknown()).optional(),
  revision: z.number().int().positive().optional(), autosave: z.boolean().optional()
}).strict();

requestDraftsRouter.use(authenticate, requireRole("client"));
requestDraftsRouter.get("/", asyncHandler(async (req, res) => res.json(await listRequestDrafts(req.user!.id, { query: String(req.query.q ?? ""), take: req.query.take ? Number(req.query.take) : undefined }))));
requestDraftsRouter.post("/", asyncHandler(async (req, res) => res.status(201).json(await createRequestDraft(req.user!.id, draftBody.parse(req.body)))));
requestDraftsRouter.get("/:id", asyncHandler(async (req, res) => res.json(await getRequestDraft(req.user!.id, req.params.id))));
requestDraftsRouter.patch("/:id", asyncHandler(async (req, res) => {
  const input = draftBody.extend({ revision: z.number().int().positive() }).parse(req.body);
  res.json(await updateRequestDraft(req.user!.id, req.params.id, input));
}));
requestDraftsRouter.delete("/:id", asyncHandler(async (req, res) => { await deleteRequestDraft(req.user!.id, req.params.id); res.status(204).end(); }));
requestDraftsRouter.post("/:id/duplicate", asyncHandler(async (req, res) => res.status(201).json(await duplicateRequestDraft(req.user!.id, req.params.id))));
requestDraftsRouter.post("/:id/publish", asyncHandler(async (req, res) => res.json(await publishRequestDraft(req.user!.id, req.params.id, z.object({ revision: z.number().int().positive() }).strict().parse(req.body).revision))));
requestDraftsRouter.post("/:id/support-cases", asyncHandler(async (req, res) => {
  const input = z.object({ subject: z.string().trim().min(2).max(120), message: z.string().trim().min(1).max(5000), revision: z.number().int().positive() }).strict().parse(req.body);
  res.status(201).json(await createDraftSupportCase(req.user!.id, req.params.id, input));
}));
requestDraftsRouter.get("/:id/support-cases", asyncHandler(async (req, res) => {
  const draft = await getRequestDraft(req.user!.id, req.params.id);
  res.json(draft.supportCases ?? []);
}));

requestDraftSupportRouter.use(authenticate, requireAdminManagerOrSuperadmin);
requestDraftSupportRouter.get("/", asyncHandler(async (req, res) => res.json(await listDraftSupportCases(req.user!, { status: req.query.status ? String(req.query.status) : undefined, take: req.query.take ? Number(req.query.take) : undefined }))));
requestDraftSupportRouter.post("/:id/messages", asyncHandler(async (req, res) => res.status(201).json(await replyToDraftSupportCase(req.user!, req.params.id, z.object({ body: z.string().trim().min(1).max(5000) }).strict().parse(req.body).body))));
requestDraftSupportRouter.patch("/:id/status", asyncHandler(async (req, res) => res.json(await updateDraftSupportCase(req.user!, req.params.id, z.object({ status: z.enum(["new", "in_progress", "waiting_for_client", "resolved", "closed"]) }).strict().parse(req.body)))));
requestDraftSupportRouter.post("/:id/assign", asyncHandler(async (req, res) => res.json(await updateDraftSupportCase(req.user!, req.params.id, { assignToMe: true }))));
