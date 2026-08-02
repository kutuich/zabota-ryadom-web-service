import { Router } from "express";
import { z } from "zod";
import { authenticate, requireAdmin, requireRole } from "../middleware/auth";
import {
  archiveCategoryStructure,
  buildCityTemplateExport,
  buildRegionTemplateExport,
  buildStructureExport,
  CATEGORY_IMPORT_MAX_BYTES,
  categoriesForCity,
  compareCategoryStructures,
  createDraftFromImport,
  createNewStructureVersion,
  createRollbackDraft,
  createStructureFromParent,
  getCategoryCityStatuses,
  getCategoryStructure,
  getEffectiveCategoryStructure,
  getHelperCategoryPreferences,
  listCategoryStructures,
  publishCategoryStructure,
  previewCategoryImport,
  saveHelperCategoryPreferences,
  updateDraftStructure,
  type CategoryImportPayload
} from "../services/categoryStructureService";
import { asyncHandler, HttpError } from "../utils/http";
import { flattenRequestCatalog } from "../services/requestScheduleService";
import { getEffectiveServiceTree } from "../services/serviceTreeService";
import {
  cancelRequestStructureUpdate,
  confirmRequestStructureUpdate,
  deleteCategoryStructure,
  emergencyDisableCategoryStructure,
  getEmergencyDisablePreview,
  getCategoryStructureDependencies,
  startRequestStructureUpdate
} from "../services/categoryStructureLifecycleService";

export const categoryStructuresRouter = Router();
export const categoriesRouter = Router();
export const helperCategoryPreferencesRouter = Router();
export const adminCategoryStructuresRouter = Router();

categoryStructuresRouter.use(authenticate);
categoryStructuresRouter.get(
  "/effective-tree",
  asyncHandler(async (req, res) => {
    const cityId = z.string().min(1).parse(req.query.cityId);
    res.json(await getEffectiveServiceTree(cityId));
  })
);
categoryStructuresRouter.get(
  "/effective",
  asyncHandler(async (req, res) => {
    const cityId = z.string().min(1).parse(req.query.cityId);
    const effective = await getEffectiveCategoryStructure(cityId);
    res.json({
      status: effective.status,
      statusLabel: effective.statusLabel,
      structure: effective.structure
        ? {
            id: effective.structure.id,
            scopeType: effective.structure.scopeType,
            versionNumber: effective.structure.versionNumber,
            title: effective.structure.title,
            qualityStatus: effective.structure.qualityStatus
          }
        : null,
      layers: effective.layers.map((layer) => ({ id: layer.id, scopeType: layer.scopeType, versionNumber: layer.versionNumber, title: layer.title, qualityStatus: layer.qualityStatus }))
    });
  })
);
categoryStructuresRouter.post(
  "/request-updates/:id/confirm",
  requireRole("client"),
  asyncHandler(async (req, res) => res.json(await confirmRequestStructureUpdate(req.params.id, req.user!.id)))
);

categoriesRouter.use(authenticate);
categoriesRouter.get(
  "/for-request",
  asyncHandler(async (req, res) => {
    const cityId = z.string().min(1).parse(req.query.cityId);
    res.json(flattenRequestCatalog(await categoriesForCity(cityId, "customer")));
  })
);
categoriesRouter.get(
  "/for-helper",
  asyncHandler(async (req, res) => {
    const cityId = z.string().min(1).parse(req.query.cityId);
    res.json(await categoriesForCity(cityId, "helper"));
  })
);

helperCategoryPreferencesRouter.use(authenticate, requireRole("performer"));
helperCategoryPreferencesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const cityId = typeof req.query.cityId === "string" ? req.query.cityId : undefined;
    res.json(await getHelperCategoryPreferences(req.user!.id, cityId));
  })
);
helperCategoryPreferencesRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const input = z.object({
      cityId: z.string().min(1),
      categoryIds: z.array(z.string().min(1)).max(100),
      comment: z.string().max(500).optional()
    }).parse(req.body);
    res.json(await saveHelperCategoryPreferences(req.user!.id, input));
  })
);

adminCategoryStructuresRouter.use(authenticate, requireAdmin);

adminCategoryStructuresRouter.get(
  "/city-status",
  asyncHandler(async (_req, res) => res.json(await getCategoryCityStatuses()))
);
adminCategoryStructuresRouter.get(
  "/city-template/export.xlsx",
  asyncHandler(async (req, res) => {
    const cityId = z.string().min(1).parse(req.query.cityId);
    res.json(await buildCityTemplateExport(cityId, req.user!.id));
  })
);
adminCategoryStructuresRouter.get(
  "/region-template/export.xlsx",
  asyncHandler(async (req, res) => {
    const regionId = z.string().min(1).parse(req.query.regionId);
    res.json(await buildRegionTemplateExport(regionId, req.user!.id));
  })
);
adminCategoryStructuresRouter.post(
  "/import/preview",
  asyncHandler(async (req, res) => {
    const input = parseImportRequest(req.body);
    res.json(await previewCategoryImport(input.payload));
  })
);
adminCategoryStructuresRouter.post(
  "/import/create-draft",
  asyncHandler(async (req, res) => {
    const input = parseImportRequest(req.body);
    res.status(201).json(await createDraftFromImport(input.payload, req.user!.id, input.fileName));
  })
);
adminCategoryStructuresRouter.post(
  "/create-from-parent",
  asyncHandler(async (req, res) => {
    const input = z.object({
      scopeType: z.enum(["region", "city"]),
      regionId: z.string().optional(),
      cityId: z.string().optional(),
      title: z.string().min(2).max(180).optional(),
      comment: z.string().max(1000).optional()
    }).parse(req.body);
    res.status(201).json(await createStructureFromParent(input, req.user!.id));
  })
);
adminCategoryStructuresRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = z.enum(["working", "active", "draft", "archived", "all"]).default("working").parse(req.query.status);
    res.json(await listCategoryStructures(status));
  })
);
adminCategoryStructuresRouter.get(
  "/compare",
  asyncHandler(async (req, res) => {
    const input = z.object({ leftId: z.string().min(1), rightId: z.string().min(1) }).parse(req.query);
    res.json(await compareCategoryStructures(input.leftId, input.rightId));
  })
);
adminCategoryStructuresRouter.get(
  "/:id/export.xlsx",
  asyncHandler(async (req, res) => res.json(await buildStructureExport(req.params.id, req.user!.id)))
);
adminCategoryStructuresRouter.get(
  "/:id/export.json",
  asyncHandler(async (req, res) => {
    const result = await buildStructureExport(req.params.id, req.user!.id);
    res.json({ fileName: result.jsonFileName, payload: result.payload });
  })
);
adminCategoryStructuresRouter.get(
  "/:id/dependencies",
  asyncHandler(async (req, res) => res.json(await getCategoryStructureDependencies(req.params.id)))
);
adminCategoryStructuresRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = z.object({ comment: z.string().trim().min(3).max(1000), confirmationPhrase: z.string().max(200).optional() }).parse(req.body);
    res.json(await deleteCategoryStructure(req.params.id, { id: req.user!.id, realRole: req.user!.realRole }, input));
  })
);
adminCategoryStructuresRouter.post(
  "/:id/emergency-disable",
  asyncHandler(async (req, res) => {
    const input = z.object({ reason: z.string().trim().min(5).max(1000) }).parse(req.body);
    res.json(await emergencyDisableCategoryStructure(req.params.id, { id: req.user!.id, realRole: req.user!.realRole }, input.reason));
  })
);
adminCategoryStructuresRouter.get(
  "/:id/emergency-disable-preview",
  asyncHandler(async (req, res) => res.json(await getEmergencyDisablePreview(req.params.id)))
);
adminCategoryStructuresRouter.post(
  "/:id/requests/:requestId/start-update",
  asyncHandler(async (req, res) => res.status(201).json(await startRequestStructureUpdate(req.params.id, req.params.requestId, { id: req.user!.id, realRole: req.user!.realRole })))
);
adminCategoryStructuresRouter.post(
  "/request-updates/:id/cancel",
  asyncHandler(async (req, res) => {
    const input = z.object({ reason: z.string().trim().min(3).max(1000) }).parse(req.body);
    res.json(await cancelRequestStructureUpdate(req.params.id, { id: req.user!.id, realRole: req.user!.realRole }, input.reason));
  })
);
adminCategoryStructuresRouter.get(
  "/:id",
  asyncHandler(async (req, res) => res.json(await getCategoryStructure(req.params.id)))
);
adminCategoryStructuresRouter.post(
  "/:id/new-version",
  asyncHandler(async (req, res) => {
    const input = z.object({ comment: z.string().max(1000).optional() }).parse(req.body);
    res.status(201).json(await createNewStructureVersion(req.params.id, req.user!.id, input.comment));
  })
);
adminCategoryStructuresRouter.post(
  "/:id/rollback",
  asyncHandler(async (req, res) => {
    z.object({ confirmed: z.literal(true) }).parse(req.body);
    res.status(201).json(await createRollbackDraft(req.params.id, req.user!.id));
  })
);
adminCategoryStructuresRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = z.object({
      title: z.string().min(2).max(180).optional(),
      description: z.string().max(3000).nullable().optional(),
      qualityStatus: z.enum(["draft", "estimated", "reviewed", "tested", "approved"]).optional(),
      comment: z.string().max(1000).nullable().optional()
    }).parse(req.body);
    res.json(await updateDraftStructure(req.params.id, input, req.user!.id));
  })
);
adminCategoryStructuresRouter.post(
  "/:id/publish",
  asyncHandler(async (req, res) => res.json(await publishCategoryStructure(req.params.id, req.user!.id)))
);
adminCategoryStructuresRouter.post(
  "/:id/archive",
  asyncHandler(async (req, res) => res.json(await archiveCategoryStructure(req.params.id, req.user!.id)))
);

function parseImportRequest(body: unknown) {
  const input = z.object({
    payload: z.unknown(),
    fileName: z.string().min(1).max(255),
    fileSize: z.number().int().nonnegative().max(CATEGORY_IMPORT_MAX_BYTES)
  }).parse(body);
  if (!/\.(json|xlsx)$/i.test(input.fileName)) {
    throw new HttpError(400, "Разрешены только файлы JSON и XLSX", "category_import_file_type_invalid");
  }
  if (!input.payload || typeof input.payload !== "object") {
    throw new HttpError(400, "Файл не содержит структуру категорий", "category_import_payload_invalid");
  }
  return { ...input, payload: input.payload as CategoryImportPayload };
}
