import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import type { Request, Response } from "express";
import { z } from "zod";
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
} from "../../../services/categoryStructureService";
import { HttpError } from "../../../utils/http";
import { flattenRequestCatalog } from "../../../services/requestScheduleService";
import { getEffectiveServiceTree } from "../../../services/serviceTreeService";
import {
  cancelRequestStructureUpdate,
  confirmRequestStructureUpdate,
  deleteCategoryStructure,
  emergencyDisableCategoryStructure,
  getEmergencyDisablePreview,
  getCategoryStructureDependencies,
  startRequestStructureUpdate
} from "../../../services/categoryStructureLifecycleService";

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
@Controller("api/category-structures")
export class CategoryStructuresController {
  @Get("/effective-tree")
  @UseGuards(NestJwtAuthGuard)
  async geteffectiveTree0(@Req() req: Request, @Res() res: Response) {
    const cityId = z.string().min(1).parse(req.query.cityId);
    res.json(await getEffectiveServiceTree(cityId));
  }

  @Get("/effective")
  @UseGuards(NestJwtAuthGuard)
  async geteffective1(@Req() req: Request, @Res() res: Response) {
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
  }

  @Post("/request-updates/:id/confirm")
  @HttpCode(200)
  @RequireRoles("client")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async postrequestUpdatesIdConfirm2(@Req() req: Request, @Res() res: Response) {
    return res.json(await confirmRequestStructureUpdate(req.params.id, req.user!.id));
  }
}

@Controller("api/categories")
export class CategoriesController {
  @Get("/for-request")
  @UseGuards(NestJwtAuthGuard)
  async getforRequest0(@Req() req: Request, @Res() res: Response) {
    const cityId = z.string().min(1).parse(req.query.cityId);
    res.json(flattenRequestCatalog(await categoriesForCity(cityId, "customer")));
  }

  @Get("/for-helper")
  @UseGuards(NestJwtAuthGuard)
  async getforHelper1(@Req() req: Request, @Res() res: Response) {
    const cityId = z.string().min(1).parse(req.query.cityId);
    res.json(await categoriesForCity(cityId, "helper"));
  }
}

@Controller("api/helper/category-preferences")
export class HelperCategoryPreferencesController {
  @Get("/")
  @RequireRoles("performer")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async getroot0(@Req() req: Request, @Res() res: Response) {
    const cityId = typeof req.query.cityId === "string" ? req.query.cityId : undefined;
    res.json(await getHelperCategoryPreferences(req.user!.id, cityId));
  }

  @Put("/")
  @RequireRoles("performer")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async putroot1(@Req() req: Request, @Res() res: Response) {
    const input = z.object({
      cityId: z.string().min(1),
      categoryIds: z.array(z.string().min(1)).max(100),
      comment: z.string().max(500).optional()
    }).parse(req.body);
    res.json(await saveHelperCategoryPreferences(req.user!.id, input));
  }
}

@Controller("api/admin/category-structures")
export class AdminCategoryStructuresController {
  @Get("/city-status")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getcityStatus0(@Req() _req: Request, @Res() res: Response) {
    return res.json(await getCategoryCityStatuses());
  }

  @Get("/city-template/export.xlsx")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getcityTemplateExportXlsx1(@Req() req: Request, @Res() res: Response) {
    const cityId = z.string().min(1).parse(req.query.cityId);
    res.json(await buildCityTemplateExport(cityId, req.user!.id));
  }

  @Get("/region-template/export.xlsx")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getregionTemplateExportXlsx2(@Req() req: Request, @Res() res: Response) {
    const regionId = z.string().min(1).parse(req.query.regionId);
    res.json(await buildRegionTemplateExport(regionId, req.user!.id));
  }

  @Post("/import/preview")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postimportPreview3(@Req() req: Request, @Res() res: Response) {
    const input = parseImportRequest(req.body);
    res.json(await previewCategoryImport(input.payload));
  }

  @Post("/import/create-draft")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postimportCreateDraft4(@Req() req: Request, @Res() res: Response) {
    const input = parseImportRequest(req.body);
    res.status(201).json(await createDraftFromImport(input.payload, req.user!.id, input.fileName));
  }

  @Post("/create-from-parent")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postcreateFromParent5(@Req() req: Request, @Res() res: Response) {
    const input = z.object({
      scopeType: z.enum(["region", "city"]),
      regionId: z.string().optional(),
      cityId: z.string().optional(),
      title: z.string().min(2).max(180).optional(),
      comment: z.string().max(1000).optional()
    }).parse(req.body);
    res.status(201).json(await createStructureFromParent(input, req.user!.id));
  }

  @Get("/")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getroot6(@Req() req: Request, @Res() res: Response) {
    const status = z.enum(["working", "active", "draft", "archived", "all"]).default("working").parse(req.query.status);
    res.json(await listCategoryStructures(status));
  }

  @Get("/compare")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getcompare7(@Req() req: Request, @Res() res: Response) {
    const input = z.object({ leftId: z.string().min(1), rightId: z.string().min(1) }).parse(req.query);
    res.json(await compareCategoryStructures(input.leftId, input.rightId));
  }

  @Get("/:id/export.xlsx")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getidExportXlsx8(@Req() req: Request, @Res() res: Response) {
    return res.json(await buildStructureExport(req.params.id, req.user!.id));
  }

  @Get("/:id/export.json")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getidExportJson9(@Req() req: Request, @Res() res: Response) {
    const result = await buildStructureExport(req.params.id, req.user!.id);
    res.json({ fileName: result.jsonFileName, payload: result.payload });
  }

  @Get("/:id/dependencies")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getidDependencies10(@Req() req: Request, @Res() res: Response) {
    return res.json(await getCategoryStructureDependencies(req.params.id));
  }

  @Delete("/:id")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async deleteid11(@Req() req: Request, @Res() res: Response) {
    const input = z.object({ comment: z.string().trim().min(3).max(1000), confirmationPhrase: z.string().max(200).optional() }).parse(req.body);
    res.json(await deleteCategoryStructure(req.params.id, { id: req.user!.id, realRole: req.user!.realRole }, input));
  }

  @Post("/:id/emergency-disable")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postidEmergencyDisable12(@Req() req: Request, @Res() res: Response) {
    const input = z.object({ reason: z.string().trim().min(5).max(1000) }).parse(req.body);
    res.json(await emergencyDisableCategoryStructure(req.params.id, { id: req.user!.id, realRole: req.user!.realRole }, input.reason));
  }

  @Get("/:id/emergency-disable-preview")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getidEmergencyDisablePreview13(@Req() req: Request, @Res() res: Response) {
    return res.json(await getEmergencyDisablePreview(req.params.id));
  }

  @Post("/:id/requests/:requestId/start-update")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postidRequestsRequestIdStartUpdate14(@Req() req: Request, @Res() res: Response) {
    return res.status(201).json(await startRequestStructureUpdate(req.params.id, req.params.requestId, { id: req.user!.id, realRole: req.user!.realRole }));
  }

  @Post("/request-updates/:id/cancel")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postrequestUpdatesIdCancel15(@Req() req: Request, @Res() res: Response) {
    const input = z.object({ reason: z.string().trim().min(3).max(1000) }).parse(req.body);
    res.json(await cancelRequestStructureUpdate(req.params.id, { id: req.user!.id, realRole: req.user!.realRole }, input.reason));
  }

  @Get("/:id")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getid16(@Req() req: Request, @Res() res: Response) {
    return res.json(await getCategoryStructure(req.params.id));
  }

  @Post("/:id/new-version")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postidNewVersion17(@Req() req: Request, @Res() res: Response) {
    const input = z.object({ comment: z.string().max(1000).optional() }).parse(req.body);
    res.status(201).json(await createNewStructureVersion(req.params.id, req.user!.id, input.comment));
  }

  @Post("/:id/rollback")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postidRollback18(@Req() req: Request, @Res() res: Response) {
    z.object({ confirmed: z.literal(true) }).parse(req.body);
    res.status(201).json(await createRollbackDraft(req.params.id, req.user!.id));
  }

  @Patch("/:id")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async patchid19(@Req() req: Request, @Res() res: Response) {
    const input = z.object({
      title: z.string().min(2).max(180).optional(),
      description: z.string().max(3000).nullable().optional(),
      qualityStatus: z.enum(["draft", "estimated", "reviewed", "tested", "approved"]).optional(),
      comment: z.string().max(1000).nullable().optional()
    }).parse(req.body);
    res.json(await updateDraftStructure(req.params.id, input, req.user!.id));
  }

  @Post("/:id/publish")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postidPublish20(@Req() req: Request, @Res() res: Response) {
    return res.json(await publishCategoryStructure(req.params.id, req.user!.id));
  }

  @Post("/:id/archive")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postidArchive21(@Req() req: Request, @Res() res: Response) {
    return res.json(await archiveCategoryStructure(req.params.id, req.user!.id));
  }
}
