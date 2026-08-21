import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../../db/prisma";
import { ensureNonNegativeBalance, getServiceFeeSettings } from "../../../services/balanceService";
import { writeAudit } from "../../../services/auditService";
import { requireFeatureConsent } from "../../../services/legalService";
import { calculatePrice } from "../../../services/pricingService";
import { nextRequestPublicNumber } from "../../../services/requestNumberService";
import { evaluateRequestMatch } from "../../../services/matchingService";
import { detectMedicalTerms, serializeRequestForUser } from "../../../services/requestPolicy";
import {
  buildFullAddress,
  buildPublicAddress,
  buildYandexExactMapAddress,
  buildYandexPublicMapAddress,
  normalizeAddressParts,
  parseAddressText
} from "../../../services/addressService";
import { HttpError } from "../../../utils/http";
import { activateSettlementTx } from "../../../services/settlementService";
import {
  calculateStructuredRequestPrice,
  createRequestCategorySnapshotTx,
  REQUEST_FREQUENCY_CODES
} from "../../../services/categoryStructureService";
import {
  calculateMultiTaskRequest,
  createMultiTaskRequestSnapshotTx,
  REQUEST_FREQUENCIES,
  validateMultiTaskSafety,
  type RequestScheduleInput
} from "../../../services/requestScheduleService";
import { calculateServiceTreeQuote } from "../../../services/serviceTreeService";

const requestInclude = {
  city: true,
  category: true,
  client: { select: { id: true, displayName: true } },
  selectedPerformer: { select: { id: true, displayName: true } },
  responses: {
    include: {
      performer: {
        select: {
          id: true,
          displayName: true,
          avatarUrl: true,
          performerProfile: true
        }
      }
    },
    orderBy: { createdAt: "desc" as const }
  },
  chats: {
    select: {
      id: true,
      status: true,
      performerId: true,
      clientConfirmedAt: true,
      performerConfirmedAt: true,
      agreementFinalizedAt: true,
      agreedHelperAmount: true,
      customerServiceFeeAmount: true,
      helperServiceFeeAmount: true,
      customerTotalAmount: true,
      helperNetAmount: true,
      agreedPackageId: true,
      agreedPackageTitle: true,
      agreedAddonsJson: true,
      agreedDurationMinutes: true,
      agreedScheduledAt: true,
      agreedTermsComment: true,
      agreedByCustomerAt: true,
      agreedByHelperAt: true,
      termsUpdatedAt: true,
      termsUpdatedByUserId: true,
      archivedAt: true
    },
    orderBy: { createdAt: "desc" as const }
  },
  categorySnapshots: { orderBy: { createdAt: "desc" as const }, take: 1 },
  structureUpdateRevisions: { where: { status: "pending_customer_confirmation" }, orderBy: { createdAt: "desc" as const }, take: 1 }
};

const createRequestSchema = z.object({
  cityId: z.string().min(1),
  categoryId: z.string().min(1).optional(),
  structuredCategoryId: z.string().min(1).optional(),
  structuredSubcategoryId: z.string().min(1).optional(),
  categoryTaskTemplateId: z.string().min(1).optional(),
  frequencyCode: z.enum(REQUEST_FREQUENCY_CODES).default("once"),
  categorySpecificFormatCode: z.string().max(80).optional(),
  additionalTask: z.object({
    categoryId: z.string().min(1),
    subcategoryId: z.string().min(1).optional(),
    taskTemplateId: z.string().min(1).optional()
  }).optional(),
  contactName: z.string().max(120).optional(),
  contactPhone: z.string().max(40).optional(),
  helpFor: z.enum(["elderly", "child", "limited_mobility", "home_family", "other"]).optional(),
  additionalActions: z.array(z.string()).default([]),
  dependentState: z.array(z.string()).default([]),
  dependentAge: z.number().int().positive().max(120).optional(),
  scheduleType: z.enum(["once", "regular", "urgent"]).default("once"),
  regularPeriod: z.string().max(240).optional(),
  repeatedVisitsAllowed: z.boolean().default(false),
  hygieneLevel: z.string().max(120).optional(),
  physicalLoadLevel: z.string().max(120).optional(),
  taskVolumeLevel: z.string().max(120).optional(),
  urgencyFlags: z.array(z.string()).default([]),
  isRemoteAddress: z.boolean().default(false),
  transportOption: z.string().max(120).optional(),
  recipientType: z.enum(["self", "adult", "elderly", "child"]).optional(),
  dependentName: z.string().min(1).max(120).optional(),
  dependentMainState: z.enum(["independent", "light_support", "limited_mobility", "bedridden"]).optional(),
  dependentStateFeatures: z.array(z.string().max(80)).max(20).optional(),
  selectedTasks: z.array(z.object({
    categoryId: z.string().min(1),
    subcategoryId: z.string().min(1).nullable().optional(),
    taskTemplateId: z.string().min(1).nullable().optional()
  })).max(100).optional(),
  taskFieldValues: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  scheduleV2: z.any().optional(),
  accompanimentWaitingMinutes: z.number().int().min(0).max(1440).optional(),
  title: z.string().min(4).max(160).optional(),
  description: z.string().min(1).max(4000).optional(),
  addressText: z.string().max(500).optional(),
  addressStreet: z.string().min(1).max(160).optional(),
  addressHouse: z.string().min(1).max(60).optional(),
  addressApartment: z.string().max(60).optional(),
  addressEntrance: z.string().max(60).optional(),
  addressFloor: z.string().max(60).optional(),
  addressIntercom: z.string().max(120).optional(),
  addressComment: z.string().max(500).optional(),
  approximateAddressText: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  district: z.string().optional(),
  date: z.string().optional(),
  timeFrom: z.string().optional(),
  timeTo: z.string().optional(),
  expectedDurationHours: z.number().positive().optional(),
  urgency: z.enum(["normal", "urgent", "regular"]).default("normal"),
  hasElderlyPerson: z.boolean().default(false),
  hasChild: z.boolean().default(false),
  hasLimitedMobility: z.boolean().default(false),
  physicalHelpLevel: z.string().max(120).optional(),
  needsCooking: z.boolean().default(false),
  needsCleaning: z.boolean().default(false),
  needsWalk: z.boolean().default(false),
  needsHygieneHelp: z.boolean().default(false),
  hasPets: z.boolean().default(false),
  budgetAmount: z.number().int().positive().optional(),
  comment: z.string().max(2000).optional()
});

const updateRequestSchema = createRequestSchema.partial();

const structuredPriceSchema = z.object({
  cityId: z.string().min(1),
  categoryId: z.string().min(1),
  subcategoryId: z.string().min(1).optional(),
  taskTemplateId: z.string().min(1).optional(),
  frequencyCode: z.enum(REQUEST_FREQUENCY_CODES).default("once"),
  categorySpecificFormatCode: z.string().max(80).optional(),
  durationMinutes: z.number().int().positive().max(1440).optional(),
  queryText: z.string().max(4000).optional(),
  additionalTask: z.object({
    categoryId: z.string().min(1),
    subcategoryId: z.string().min(1).optional(),
    taskTemplateId: z.string().min(1).optional()
  }).optional()
});

const visitSlotSchema = z.object({
  id: z.string().min(1).max(80),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMinutes: z.number().int().positive().max(1440)
});
const scheduleV2Schema = z.object({
  frequency: z.enum(REQUEST_FREQUENCIES),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  weeksCount: z.number().int().positive().max(104).nullable().optional(),
  visitCount: z.number().int().positive().max(5000).nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  slots: z.array(visitSlotSchema).max(24).optional(),
  daySchedules: z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), slots: z.array(visitSlotSchema).max(24) })).max(7).optional()
});

const multiTaskPriceSchema = z.object({
  cityId: z.string().min(1),
  recipientType: z.enum(["self", "adult", "elderly", "child"]),
  dependentState: z.object({ mainState: z.string().min(1), features: z.array(z.string()).default([]) }),
  selectedTasks: z.array(z.object({ categoryId: z.string().min(1), subcategoryId: z.string().nullable().optional(), taskTemplateId: z.string().nullable().optional() })).min(1).max(100),
  taskFieldValues: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  frequency: z.enum(REQUEST_FREQUENCIES),
  schedule: scheduleV2Schema,
  accompanimentWaitingMinutes: z.number().int().min(0).max(1440).optional(),
  queryText: z.string().max(4000).optional()
});

async function ensureCanViewRequest(
  request: { clientId: string; selectedPerformerId: string | null; cityId: string; visibilityStatus: string; isHiddenFromPerformers: boolean; responses?: Array<{ performerId: string }>; chats?: Array<{ performerId: string }> },
  viewer: { id: string; role: string; cityId: string | null }
) {
  if (["admin", "superadmin"].includes(viewer.role)) return;
  if (request.clientId === viewer.id || request.selectedPerformerId === viewer.id) return;
  if (viewer.role === "performer" && request.isHiddenFromPerformers) {
    const alreadyInterested = request.responses?.some((row) => row.performerId === viewer.id) || request.chats?.some((row) => row.performerId === viewer.id);
    if (alreadyInterested) return;
    throw new HttpError(404, "Заявка не найдена", "request_not_found");
  }
  if (viewer.role === "performer" && request.visibilityStatus === "city_visible") {
    const relation = await prisma.userCity.findFirst({
      where: { userId: viewer.id, cityId: request.cityId, isActive: true, roleScope: { in: ["helper", "both"] } }
    });
    if (relation || request.cityId === viewer.cityId) return;
  }
  throw new HttpError(403, "Нет доступа к заявке", "forbidden");
}

function toApproximatePoint(lat: number | undefined, lng: number | undefined, cityLat: number, cityLng: number) {
  if (typeof lat !== "number" || typeof lng !== "number") {
    return { lat: cityLat, lng: cityLng };
  }

  return {
    lat: Math.round(lat * 100) / 100,
    lng: Math.round(lng * 100) / 100
  };
}

function collectChangedFields(request: any, input: Record<string, unknown>) {
  const labels: Record<string, string> = {
    title: "Краткое описание",
    description: "Описание",
    addressText: "Адрес",
    addressStreet: "Улица",
    addressHouse: "Дом",
    addressApartment: "Квартира",
    addressEntrance: "Подъезд",
    addressFloor: "Этаж",
    addressIntercom: "Домофон",
    addressComment: "Комментарий к адресу",
    district: "Район",
    date: "Дата",
    timeFrom: "Время начала",
    timeTo: "Время окончания",
    expectedDurationHours: "Длительность",
    comment: "Комментарий",
    categoryId: "Категория",
    cityId: "Город"
  };
  return Object.entries(labels)
    .filter(([key]) => Object.prototype.hasOwnProperty.call(input, key))
    .filter(([key]) => normalizeComparable((request as any)[key]) !== normalizeComparable(input[key]))
    .map(([, label]) => label);
}

function normalizeComparable(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return value ?? null;
}

function safeJsonArray(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function buildRequestAddressParts(
  input: {
    addressText?: string;
    addressStreet?: string;
    addressHouse?: string;
    addressApartment?: string;
    addressEntrance?: string;
    addressFloor?: string;
    addressIntercom?: string;
    addressComment?: string;
  },
  cityName: string,
  current?: {
    addressText?: string | null;
    addressCity?: string | null;
    addressStreet?: string | null;
    addressHouse?: string | null;
    addressApartment?: string | null;
    addressEntrance?: string | null;
    addressFloor?: string | null;
    addressIntercom?: string | null;
    addressComment?: string | null;
  } | null
) {
  const parsed = parseAddressText(current?.addressText ?? input.addressText, cityName);
  return normalizeAddressParts({
    city: cityName,
    street: input.addressStreet ?? current?.addressStreet ?? parsed.street,
    house: input.addressHouse ?? current?.addressHouse ?? parsed.house,
    apartment: input.addressApartment ?? current?.addressApartment ?? "",
    entrance: input.addressEntrance ?? current?.addressEntrance ?? "",
    floor: input.addressFloor ?? current?.addressFloor ?? "",
    intercom: input.addressIntercom ?? current?.addressIntercom ?? "",
    addressComment: input.addressComment ?? current?.addressComment ?? ""
  }, cityName);
}

function buildAddressView(addressParts: ReturnType<typeof normalizeAddressParts>) {
  return {
    fullAddress: buildFullAddress(addressParts),
    publicAddress: buildPublicAddress(addressParts),
    yandexPublicMapAddress: buildYandexPublicMapAddress(addressParts),
    yandexExactMapAddress: buildYandexExactMapAddress(addressParts)
  };
}

function assertRequiredAddressParts(addressParts: ReturnType<typeof normalizeAddressParts>) {
  if (!addressParts.city) {
    throw new HttpError(400, "Укажите город.", "city_required");
  }
  if (!addressParts.street) {
    throw new HttpError(400, "Укажите улицу.", "street_required");
  }
  if (!addressParts.house) {
    throw new HttpError(400, "Укажите дом.", "house_required");
  }
}

async function recalculateRating(userId: string) {
  const aggregate = await prisma.review.aggregate({
    where: { toUserId: userId },
    _avg: { rating: true }
  });
  const rating = Number((aggregate._avg.rating ?? 0).toFixed(2));

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === "client") {
    await prisma.clientProfile.update({ where: { userId }, data: { rating } });
  }
  if (user?.role === "performer") {
    await prisma.performerProfile.update({ where: { userId }, data: { rating } });
  }
}
@Controller("api/requests")
export class RequestsController {
  @Post("/calculate-price")
  @HttpCode(200)
  @RequireRoles("client")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async postcalculatePrice0(@Req() req: Request, @Res() res: Response) {
    if (Array.isArray(req.body?.selectedNodeSlugs)) {
      const input = z.object({
        cityId: z.string().min(1),
        selectedNodeSlugs: z.array(z.string().min(1)).min(1).max(500),
        dynamicFieldValues: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
        schedule: scheduleV2Schema.optional(),
        visits: z.array(z.object({ id: z.string().min(1).max(80), date: z.string(), startTime: z.string(), durationMinutes: z.number().int().min(0).max(1440) })).max(5000).optional()
      }).strict().parse(req.body);
      return res.json(await calculateServiceTreeQuote(input));
    }
    if (Array.isArray(req.body?.selectedTasks)) {
      const input = multiTaskPriceSchema.parse(req.body);
      return res.json(await calculateMultiTaskRequest({
        cityId: input.cityId,
        selectedTasks: input.selectedTasks,
        frequency: input.frequency,
        schedule: input.schedule,
        taskFieldValues: input.taskFieldValues,
        queryText: input.queryText
      }));
    }
    return res.json(await calculateStructuredRequestPrice(structuredPriceSchema.parse(req.body)));
  }

  @Get("/")
  @UseGuards(NestJwtAuthGuard)
  async getroot1(@Req() req: Request, @Res() res: Response) {
    const viewer = req.user!;
    const scope = String(req.query.scope ?? "available");

    if (["admin", "superadmin"].includes(viewer.role)) {
      const requests = await prisma.clientRequest.findMany({
        include: requestInclude,
        orderBy: { createdAt: "desc" },
        take: 100
      });
      return res.json(requests.map((request) => serializeRequestForUser(request, viewer)));
    }

    if (viewer.role === "client") {
      const requests = await prisma.clientRequest.findMany({
        where: { clientId: viewer.id },
        include: requestInclude,
        orderBy: { createdAt: "desc" }
      });
      return res.json(requests.map((request) => serializeRequestForUser(request, viewer)));
    }

    if (scope === "mine") {
      const responses = await prisma.requestResponse.findMany({
        where: { performerId: viewer.id },
        include: { request: { include: requestInclude } },
        orderBy: { createdAt: "desc" }
      });

      return res.json(
        responses.map((response) => ({
          responseId: response.id,
          responseStatus: response.status,
          responseMessage: response.message,
          ...serializeRequestForUser(response.request, viewer)
        }))
      );
    }

    const helperCityRows = await prisma.userCity.findMany({
      where: { userId: viewer.id, isActive: true, roleScope: { in: ["helper", "both"] } },
      select: { cityId: true }
    });
    const helperCityIds = helperCityRows.length ? helperCityRows.map((row) => row.cityId) : viewer.cityId ? [viewer.cityId] : [];
    const [requests, performer] = await Promise.all([
      prisma.clientRequest.findMany({
      where: {
        cityId: { in: helperCityIds },
        isHiddenFromPerformers: false,
        visibilityStatus: "city_visible",
        status: { in: ["published", "waiting_for_responses", "has_responses"] },
        responses: { none: { performerId: viewer.id } }
      },
      include: requestInclude,
      orderBy: [{ date: "asc" }, { createdAt: "desc" }],
      take: 100
      }),
      prisma.user.findUnique({
        where: { id: viewer.id },
        include: { performerProfile: true, userCities: true }
      })
    ]);

    return res.json(
      requests.map((request) => ({
        ...serializeRequestForUser(request, viewer),
        match: performer ? evaluateRequestMatch(request, performer) : null
      }))
    );
  }

  @Post("/")
  @HttpCode(200)
  @RequireRoles("client")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard, NestFeatureConsentGuard("create_request"))
  async postroot2(@Req() req: Request, @Res() res: Response) {
    const input = createRequestSchema.parse(req.body);
    const usesStructuredV2 = Boolean(input.selectedTasks?.length);
    const scheduleV2 = usesStructuredV2 ? scheduleV2Schema.parse(input.scheduleV2) as RequestScheduleInput : null;
    if (usesStructuredV2) {
      const validationErrors = [
        !input.contactName?.trim() ? { path: "contactName", message: "Укажите имя контактного лица." } : null,
        !input.contactPhone?.trim() ? { path: "contactPhone", message: "Укажите телефон контактного лица." } : null,
        !input.recipientType ? { path: "recipientType", message: "Выберите, кому нужна помощь." } : null,
        input.recipientType !== "self" && !input.dependentName?.trim() ? { path: "dependentName", message: "Укажите имя Подопечного." } : null,
        input.recipientType === "child" && !input.dependentAge ? { path: "dependentAge", message: "Укажите возраст Подопечного." } : null,
        !input.dependentMainState ? { path: "dependentMainState", message: "Выберите основное состояние Подопечного." } : null
      ].filter(Boolean);
      if (validationErrors.length) throw new HttpError(400, "Проверьте заполнение формы", "validation_error", { validationErrors });
    } else if (!input.title || !input.description) {
      throw new HttpError(400, "Проверьте заполнение формы", "validation_error", { validationErrors: [{ path: "title", message: "Опишите задачу." }] });
    }

    const medicalMatches = detectMedicalTerms(`${input.title ?? ""} ${input.description ?? ""} ${input.comment ?? ""}`);

    if (medicalMatches.length > 0) {
      throw new HttpError(
        400,
        "Сервис не принимает задачи с медицинскими процедурами. Уберите такие действия из заявки.",
        "medical_terms_forbidden",
        { matches: medicalMatches }
      );
    }

    const multiPricing = usesStructuredV2 ? await calculateMultiTaskRequest({
      cityId: input.cityId,
      selectedTasks: input.selectedTasks!,
      frequency: scheduleV2!.frequency,
      schedule: scheduleV2!,
      taskFieldValues: input.taskFieldValues,
      queryText: `${input.comment ?? ""}`
    }) : null;
    const hasAccompaniment = multiPricing?.selectedTasks.some((task) => task.categorySlug === "accompaniment") ?? false;
    if (hasAccompaniment && !input.comment?.trim()) {
      throw new HttpError(400, "Проверьте заполнение формы", "validation_error", { validationErrors: [{ path: "comment", message: "Укажите место назначения и действия, которые Помощнику нужно выполнить в процессе сопровождения." }] });
    }
    const commentRequiredTask = multiPricing?.selectedTasks.find((task) => task.requiresComment);
    if (commentRequiredTask && !input.comment?.trim()) {
      throw new HttpError(400, "Проверьте заполнение формы", "validation_error", { validationErrors: [{ path: "comment", message: `Добавьте комментарий для задачи «${commentRequiredTask.taskTemplateTitle}».` }] });
    }
    const resolvedTitle = input.title ?? multiPricing!.selectedTasks.slice(0, 3).map((task) => task.taskTemplateTitle).join(", ");
    const resolvedDescription = input.description ?? `Выбранные задачи: ${multiPricing!.selectedTasks.map((task) => task.taskTemplateTitle).join(", ")}.`;

    const city = await prisma.city.findFirst({ where: { id: input.cityId, isActive: true, directoryStatus: { notIn: ["hidden", "duplicate"] } } });
    const primaryStructuredCategoryId = input.structuredCategoryId ?? input.selectedTasks?.[0]?.categoryId;
    const structuredCategory = primaryStructuredCategoryId
      ? await prisma.category.findUnique({ where: { id: primaryStructuredCategoryId }, select: { slug: true } })
      : null;
    const category = input.categoryId
      ? await prisma.serviceCategory.findFirst({ where: { id: input.categoryId, isActive: true } })
      : await prisma.serviceCategory.findFirst({
          where: { isActive: true, ...(structuredCategory ? { slug: structuredCategory.slug } : {}) },
          orderBy: { sortOrder: "asc" }
        }) ?? await prisma.serviceCategory.findFirst({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });

    if (!city || !category) {
      throw new HttpError(400, "Город или категория недоступны", "dictionary_invalid");
    }
    const addressParts = buildRequestAddressParts(input, city.name);
    assertRequiredAddressParts(addressParts);
    const addressView = buildAddressView(addressParts);

    const feeSettings = await getServiceFeeSettings();
    const legacyPricing = calculatePrice({
      category,
      expectedDurationHours: input.expectedDurationHours,
      date: input.date,
      timeFrom: input.timeFrom,
      scheduleType: input.scheduleType,
      helpFor: input.helpFor,
      additionalActions: input.additionalActions,
      dependentState: input.dependentState,
      hygieneLevel: input.hygieneLevel,
      physicalLoadLevel: input.physicalLoadLevel ?? input.physicalHelpLevel,
      physicalHelpLevel: input.physicalHelpLevel,
      taskVolumeLevel: input.taskVolumeLevel,
      urgencyFlags: input.urgencyFlags,
      isRemoteAddress: input.isRemoteAddress,
      transportOption: input.transportOption,
      urgency: input.urgency,
      hasLimitedMobility: input.hasLimitedMobility,
      needsCooking: input.needsCooking,
      needsCleaning: input.needsCleaning,
      needsWalk: input.needsWalk,
      needsHygieneHelp: input.needsHygieneHelp,
      hasPets: input.hasPets,
      ...feeSettings
    });
    const structuredPricing = !usesStructuredV2 && input.structuredCategoryId ? await calculateStructuredRequestPrice({
      cityId: input.cityId,
      categoryId: input.structuredCategoryId,
      subcategoryId: input.structuredSubcategoryId,
      taskTemplateId: input.categoryTaskTemplateId,
      frequencyCode: input.frequencyCode,
      categorySpecificFormatCode: input.categorySpecificFormatCode,
      durationMinutes: input.expectedDurationHours ? Math.round(input.expectedDurationHours * 60) : undefined,
      queryText: `${input.title} ${input.description}`,
      additionalTask: input.additionalTask
    }) : null;
    const recommendedAmount = multiPricing ? multiPricing.totalHelpAmount : structuredPricing ? structuredPricing.finalCalculatedRecommendedPrice : legacyPricing.performerPaymentAmount;
    const pricing = multiPricing ?? structuredPricing ?? legacyPricing;
    const firstVisit = multiPricing?.expandedVisits[0];
    const derivedHelpFor = input.recipientType === "child" ? "child" : input.recipientType === "elderly" ? "elderly" : input.recipientType ? "home_family" : input.helpFor;
    const derivedStates = usesStructuredV2 ? [input.dependentMainState!, ...(input.dependentStateFeatures ?? [])] : input.dependentState;

    if (usesStructuredV2) {
      await validateMultiTaskSafety({ cityId: input.cityId, selectedTasks: input.selectedTasks!, taskFieldValues: input.taskFieldValues });
    }

    const approximate = toApproximatePoint(input.lat, input.lng, city.mapCenterLat, city.mapCenterLng);
    const request = await prisma.$transaction(async (tx) => {
      await activateSettlementTx(tx, city.id, req.user!.id);
      const publicNumber = await nextRequestPublicNumber(tx);
      const created = await tx.clientRequest.create({
        data: {
          publicNumber,
          clientId: req.user!.id,
          cityId: input.cityId,
          categoryId: category.id,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          helpFor: derivedHelpFor,
          additionalActionsJson: JSON.stringify(input.additionalActions),
          dependentStateJson: JSON.stringify(derivedStates),
          dependentAge: input.dependentAge,
          scheduleType: scheduleV2?.frequency ?? input.scheduleType,
          regularPeriod: input.regularPeriod,
          repeatedVisitsAllowed: input.repeatedVisitsAllowed,
          title: resolvedTitle,
          description: resolvedDescription,
          addressText: addressView.fullAddress,
          approximateAddressText: input.approximateAddressText || addressView.publicAddress,
          addressCity: addressParts.city,
          addressStreet: addressParts.street,
          addressHouse: addressParts.house,
          addressApartment: addressParts.apartment,
          addressEntrance: addressParts.entrance,
          addressFloor: addressParts.floor,
          addressIntercom: addressParts.intercom,
          addressComment: addressParts.addressComment,
          fullAddress: addressView.fullAddress,
          publicAddress: addressView.publicAddress,
          yandexPublicMapAddress: addressView.yandexPublicMapAddress,
          yandexExactMapAddress: addressView.yandexExactMapAddress,
          lat: input.lat,
          lng: input.lng,
          approximateLat: approximate.lat,
          approximateLng: approximate.lng,
          mapPrivacyRadiusMeters: city.mapDefaultRadiusMeters,
          district: input.district,
          date: firstVisit ? new Date(`${firstVisit.date}T00:00:00.000Z`) : input.date ? new Date(input.date) : null,
          timeFrom: firstVisit?.startTime ?? input.timeFrom,
          timeTo: firstVisit?.endTime ?? input.timeTo,
          expectedDurationHours: firstVisit ? firstVisit.durationMinutes / 60 : input.expectedDurationHours,
          urgency: scheduleV2?.frequency === "urgent_today" ? "urgent" : scheduleV2 && !["once", "urgent_today"].includes(scheduleV2.frequency) ? "regular" : input.urgency,
          hasElderlyPerson: input.recipientType === "elderly" || input.hasElderlyPerson,
          hasChild: input.recipientType === "child" || input.hasChild,
          hasLimitedMobility: ["limited_mobility", "bedridden"].includes(input.dependentMainState ?? "") || input.hasLimitedMobility,
          physicalHelpLevel: input.physicalHelpLevel,
          needsCooking: input.needsCooking,
          needsCleaning: input.needsCleaning,
          needsWalk: input.needsWalk,
          needsHygieneHelp: input.needsHygieneHelp,
          hasPets: input.hasPets,
          budgetAmount: recommendedAmount,
          priceEstimateAmount: recommendedAmount,
          pricingBreakdownJson: JSON.stringify(pricing),
          comment: input.comment,
          status: "draft",
          visibilityStatus: "private"
        },
        include: requestInclude
      });
      if (multiPricing) {
        await createMultiTaskRequestSnapshotTx(tx, {
          requestId: created.id,
          cityId: input.cityId,
          recipientType: input.recipientType!,
          dependentName: input.dependentName,
          dependentAge: input.dependentAge,
          dependentState: { mainState: input.dependentMainState!, features: input.dependentStateFeatures ?? [] },
          selectedTasks: input.selectedTasks!,
          taskFieldValues: input.taskFieldValues,
          frequency: scheduleV2!.frequency,
          schedule: scheduleV2!,
          accompanimentWaitingMinutes: input.accompanimentWaitingMinutes
        }, multiPricing);
      } else await createRequestCategorySnapshotTx(tx, {
        requestId: created.id,
        cityId: input.cityId,
        categoryId: input.structuredCategoryId,
        subcategoryId: input.structuredSubcategoryId,
        taskTemplateId: input.categoryTaskTemplateId,
        frequencyCode: input.frequencyCode,
        categorySpecificFormatCode: input.categorySpecificFormatCode,
        durationMinutes: input.expectedDurationHours ? Math.round(input.expectedDurationHours * 60) : undefined,
        queryText: `${resolvedTitle} ${resolvedDescription}`,
        additionalTask: input.additionalTask
      });
      await writeAudit(req.user!.id, "request.create", "request", created.id, {
        publicNumber,
        pricing
      }, tx);
      return tx.clientRequest.findUniqueOrThrow({ where: { id: created.id }, include: requestInclude });
    });

    res.status(201).json(serializeRequestForUser(request, req.user!));
  }

  @Get("/:id")
  @UseGuards(NestJwtAuthGuard)
  async getid3(@Req() req: Request, @Res() res: Response) {
    const request = await prisma.clientRequest.findUnique({
      where: { id: req.params.id },
      include: requestInclude
    });

    if (!request) {
      throw new HttpError(404, "Заявка не найдена", "request_not_found");
    }

    await ensureCanViewRequest(request, req.user!);
    res.json(serializeRequestForUser(request, req.user!));
  }

  @Patch("/:id")
  @RequireRoles("client")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard, NestFeatureConsentGuard("edit_request"))
  async patchid4(@Req() req: Request, @Res() res: Response) {
    const input = updateRequestSchema.parse(req.body);
    const request = await prisma.clientRequest.findUnique({
      where: { id: req.params.id },
      include: { category: true, city: true }
    });

    if (!request || request.clientId !== req.user!.id) {
      throw new HttpError(404, "Заявка не найдена", "request_not_found");
    }
    if (["in_progress", "completed", "archived", "blocked"].includes(request.status)) {
      throw new HttpError(400, "Эту заявку нельзя изменить в текущем статусе", "request_edit_forbidden");
    }

    const medicalMatches = detectMedicalTerms(`${input.title ?? request.title} ${input.description ?? request.description}`);
    if (medicalMatches.length > 0) {
      throw new HttpError(
        400,
        "Сервис не принимает задачи с медицинскими процедурами. Уберите такие действия из заявки.",
        "medical_terms_forbidden",
        { matches: medicalMatches }
      );
    }

    const [city, category] = await Promise.all([
      input.cityId ? prisma.city.findFirst({ where: { id: input.cityId, isActive: true, directoryStatus: { notIn: ["hidden", "duplicate"] } } }) : Promise.resolve(null),
      input.categoryId ? prisma.serviceCategory.findFirst({ where: { id: input.categoryId, isActive: true } }) : Promise.resolve(null)
    ]);
    if (input.cityId && !city) {
      throw new HttpError(400, "Город недоступен", "city_invalid");
    }
    if (input.categoryId && !category) {
      throw new HttpError(400, "Категория недоступна", "category_invalid");
    }

    const pricingCategory = category ?? request.category;
    const effectiveCity = city ?? request.city;
    const addressParts = buildRequestAddressParts(input, effectiveCity.name, request);
    assertRequiredAddressParts(addressParts);
    const addressView = buildAddressView(addressParts);
    const feeSettings = await getServiceFeeSettings();
    const pricing = calculatePrice({
      category: pricingCategory,
      expectedDurationHours: input.expectedDurationHours ?? request.expectedDurationHours ?? undefined,
      date: input.date ?? request.date,
      timeFrom: input.timeFrom ?? request.timeFrom,
      scheduleType: input.scheduleType ?? request.scheduleType,
      helpFor: input.helpFor ?? request.helpFor,
      additionalActions: input.additionalActions ?? safeJsonArray(request.additionalActionsJson),
      dependentState: input.dependentState ?? safeJsonArray(request.dependentStateJson),
      hygieneLevel: input.hygieneLevel,
      physicalLoadLevel: input.physicalLoadLevel ?? input.physicalHelpLevel ?? request.physicalHelpLevel,
      physicalHelpLevel: input.physicalHelpLevel ?? request.physicalHelpLevel,
      taskVolumeLevel: input.taskVolumeLevel,
      urgencyFlags: input.urgencyFlags,
      isRemoteAddress: input.isRemoteAddress,
      transportOption: input.transportOption,
      urgency: input.urgency ?? request.urgency,
      hasLimitedMobility: input.hasLimitedMobility ?? request.hasLimitedMobility,
      needsCooking: input.needsCooking ?? request.needsCooking,
      needsCleaning: input.needsCleaning ?? request.needsCleaning,
      needsWalk: input.needsWalk ?? request.needsWalk,
      needsHygieneHelp: input.needsHygieneHelp ?? request.needsHygieneHelp,
      hasPets: input.hasPets ?? request.hasPets,
      ...feeSettings
    });
    const changedFields = collectChangedFields(request, input);

    const updated = await prisma.$transaction(async (tx) => {
      if (input.cityId) await activateSettlementTx(tx, input.cityId, req.user!.id);
      const saved = await tx.clientRequest.update({
        where: { id: request.id },
        data: {
          cityId: input.cityId,
          categoryId: input.categoryId,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          helpFor: input.helpFor,
          additionalActionsJson: input.additionalActions ? JSON.stringify(input.additionalActions) : undefined,
          dependentStateJson: input.dependentState ? JSON.stringify(input.dependentState) : undefined,
          dependentAge: input.dependentAge,
          scheduleType: input.scheduleType,
          regularPeriod: input.regularPeriod,
          repeatedVisitsAllowed: input.repeatedVisitsAllowed,
          title: input.title,
          description: input.description,
          addressText: addressView.fullAddress,
          approximateAddressText: input.approximateAddressText ?? addressView.publicAddress,
          addressCity: addressParts.city,
          addressStreet: addressParts.street,
          addressHouse: addressParts.house,
          addressApartment: addressParts.apartment,
          addressEntrance: addressParts.entrance,
          addressFloor: addressParts.floor,
          addressIntercom: addressParts.intercom,
          addressComment: addressParts.addressComment,
          fullAddress: addressView.fullAddress,
          publicAddress: addressView.publicAddress,
          yandexPublicMapAddress: addressView.yandexPublicMapAddress,
          yandexExactMapAddress: addressView.yandexExactMapAddress,
          lat: input.lat,
          lng: input.lng,
          district: input.district,
          date: input.date ? new Date(input.date) : undefined,
          timeFrom: input.timeFrom,
          timeTo: input.timeTo,
          expectedDurationHours: input.expectedDurationHours,
          urgency: input.urgency,
          hasElderlyPerson: input.hasElderlyPerson,
          hasChild: input.hasChild,
          hasLimitedMobility: input.hasLimitedMobility,
          physicalHelpLevel: input.physicalHelpLevel,
          needsCooking: input.needsCooking,
          needsCleaning: input.needsCleaning,
          needsWalk: input.needsWalk,
          needsHygieneHelp: input.needsHygieneHelp,
          hasPets: input.hasPets,
          budgetAmount: pricing.performerPaymentAmount,
          priceEstimateAmount: pricing.performerPaymentAmount,
          pricingBreakdownJson: JSON.stringify(pricing),
          comment: input.comment
        },
        include: requestInclude
      });

      if (input.cityId || input.structuredCategoryId || input.structuredSubcategoryId || input.categoryTaskTemplateId) {
        await createRequestCategorySnapshotTx(tx, {
          requestId: request.id,
          cityId: input.cityId ?? request.cityId,
          categoryId: input.structuredCategoryId,
          subcategoryId: input.structuredSubcategoryId,
          taskTemplateId: input.categoryTaskTemplateId,
          frequencyCode: input.frequencyCode,
          categorySpecificFormatCode: input.categorySpecificFormatCode,
          durationMinutes: input.expectedDurationHours ? Math.round(input.expectedDurationHours * 60) : undefined,
          queryText: `${input.title ?? request.title} ${input.description ?? request.description}`,
          additionalTask: input.additionalTask
        });
      }

      const activeChats = await tx.chat.findMany({
        where: { requestId: request.id, status: { in: ["open", "waiting_client_confirmation", "waiting_performer_confirmation"] } },
        select: { id: true }
      });
      if (activeChats.length > 0 && changedFields.length > 0) {
        await tx.chatMessage.createMany({
          data: activeChats.map((chat) => ({
            chatId: chat.id,
            senderId: null,
            isSystem: true,
            text: `Заказчик изменил условия заявки ${request.publicNumber ?? request.id}.\n\nИзменены поля:\n${changedFields.map((field) => `— ${field}`).join("\n")}\n\nПожалуйста, проверьте новые условия перед подтверждением заявки.`
          }))
        });
      }
      await writeAudit(req.user!.id, "request.update", "request", request.id, { changedFields }, tx);
      return tx.clientRequest.findUniqueOrThrow({ where: { id: saved.id }, include: requestInclude });
    });

    res.json(serializeRequestForUser(updated, req.user!));
  }

  @Post("/:id/publish")
  @HttpCode(200)
  @RequireRoles("client")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard, NestFeatureConsentGuard("publish_request"))
  async postidPublish5(@Req() req: Request, @Res() res: Response) {
    const request = await prisma.clientRequest.findUnique({ where: { id: req.params.id } });
    if (!request || request.clientId !== req.user!.id) {
      throw new HttpError(404, "Заявка не найдена", "request_not_found");
    }

    const updated = await prisma.clientRequest.update({
      where: { id: request.id },
      data: { status: "waiting_for_responses", visibilityStatus: "city_visible" },
      include: requestInclude
    });

    await writeAudit(req.user!.id, "request.publish", "request", request.id);
    res.json(serializeRequestForUser(updated, req.user!));
  }

  @Post("/:id/respond")
  @HttpCode(200)
  @RequireRoles("performer")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard, NestFeatureConsentGuard("respond_to_request"))
  async postidRespond6(@Req() req: Request, @Res() res: Response) {
    const input = z.object({ message: z.string().max(1000).optional() }).parse(req.body);
    const request = await prisma.clientRequest.findUnique({
      where: { id: req.params.id },
      include: { category: true }
    });

    const cityAccess = request ? await prisma.userCity.findFirst({
      where: { userId: req.user!.id, cityId: request.cityId, isActive: true, roleScope: { in: ["helper", "both"] } }
    }) : null;
    if (!request || (!cityAccess && request.cityId !== req.user!.cityId)) {
      throw new HttpError(404, "Заявка не найдена", "request_not_found");
    }
    if (request.isHiddenFromPerformers) {
      throw new HttpError(409, "Заявка временно скрыта до подтверждения обновлённых данных Заказчиком", "request_structure_update_pending");
    }
    if (!["published", "waiting_for_responses", "has_responses"].includes(request.status)) {
      throw new HttpError(400, "На эту заявку нельзя откликнуться", "request_not_available");
    }
    await ensureNonNegativeBalance(req.user!.id);

    const performer = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      include: {
        performerProfile: true,
        userCities: { where: { isActive: true } }
      }
    });
    const match = evaluateRequestMatch(request, performer);
    if (match.status === "not_fit") {
      await writeAudit(req.user!.id, "response.blocked_by_matching", "request", request.id, { reasons: match.reasons });
      throw new HttpError(403, "Отклик недоступен: профиль Помощника не соответствует обязательным условиям заявки", "request_match_blocked", { reasons: match.reasons });
    }

    const childcareWarning =
      request.category.isChildcare &&
      performer.performerProfile?.criminalRecordCertificateStatus !== "criminal_record_verified";

    const response = await prisma.$transaction(async (tx) => {
      const created = await tx.requestResponse.upsert({
        where: {
          requestId_performerId: {
            requestId: request.id,
            performerId: req.user!.id
          }
        },
        update: {
          message: input.message,
          status: "pending",
          rejectedAt: null
        },
        create: {
          requestId: request.id,
          performerId: req.user!.id,
          message: input.message,
          status: "pending"
        }
      });

      await tx.clientRequest.update({
        where: { id: request.id },
        data: { status: "has_responses" }
      });

      if (childcareWarning) {
        await tx.userRiskFlag.create({
          data: {
            userId: req.user!.id,
            type: "childcare_without_verified_criminal_record",
            severity: "high",
            reason: "Отклик на категорию няни без подтверждённой справки об отсутствии судимости"
          }
        });
      }

      await writeAudit(req.user!.id, "response.create", "request", request.id, {
        responseId: created.id,
        childcareWarning
      }, tx);

      return created;
    });

    res.status(201).json({
      response,
      warning: childcareWarning
        ? "Для категории няни заказчику будет явно показано, что справка об отсутствии судимости не подтверждена."
        : null
    });
  }

  @Post("/responses/:responseId/accept")
  @HttpCode(200)
  @RequireRoles("client")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard, NestFeatureConsentGuard("open_chat"))
  async postresponsesResponseIdAccept7(@Req() req: Request, @Res() res: Response) {
    const response = await prisma.requestResponse.findUnique({
      where: { id: req.params.responseId },
      include: {
        request: { include: { city: true } },
        performer: true
      }
    });

    if (!response || response.request.clientId !== req.user!.id) {
      throw new HttpError(404, "Отклик не найден", "response_not_found");
    }
    if (!["pending", "not_agreed", "new_terms_proposed"].includes(response.status)) {
      throw new HttpError(400, "Отклик уже обработан", "response_not_pending");
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.requestResponse.update({
        where: { id: response.id },
        data: { status: "discussion", acceptedAt: new Date(), rejectedAt: null, notAgreedAt: null }
      });

      const request = await tx.clientRequest.update({
        where: { id: response.requestId },
        data: {
          status: "discussion"
        },
        include: requestInclude
      });

      const chat = await tx.chat.upsert({
        where: { responseId: response.id },
        update: {
          status: "open",
          archivedAt: null,
          closedAt: null,
          notAgreedAt: null,
          reopenedAt: new Date()
        },
        create: {
          requestId: response.requestId,
          responseId: response.id,
          clientId: response.request.clientId,
          performerId: response.performerId,
          status: "open"
        }
      });

      await tx.chatMessage.create({
        data: {
          chatId: chat.id,
          senderId: null,
          text: "Сервис «Забота Рядом»: чат по заявке открыт. Обсудите дату, время, объём работ и условия выполнения.",
          isSystem: true
        }
      });

      await writeAudit(req.user!.id, "response.open_discussion_chat", "request", response.requestId, {
        responseId: response.id,
        performerId: response.performerId,
        chatId: chat.id
      }, tx);

      return { request, chat };
    });

    res.json({
      request: serializeRequestForUser(result.request, req.user!),
      chat: result.chat
    });
  }

  @Post("/:id/complete")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestFeatureConsentGuard("complete_request"))
  async postidComplete8(@Req() req: Request, @Res() res: Response) {
    const request = await prisma.clientRequest.findUnique({ where: { id: req.params.id } });
    if (!request) {
      throw new HttpError(404, "Заявка не найдена", "request_not_found");
    }

    const isParticipant =
      request.clientId === req.user!.id || request.selectedPerformerId === req.user!.id;
    if (!isParticipant && !["admin", "superadmin"].includes(req.user!.role)) {
      throw new HttpError(403, "Нет доступа к завершению заявки", "forbidden");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const completed = await tx.clientRequest.update({
        where: { id: request.id },
        data: { status: "completed", completedAt: new Date(), archivedAt: new Date() },
        include: requestInclude
      });
      await tx.chat.updateMany({
        where: { requestId: request.id, status: "in_work" },
        data: { status: "completed", closedAt: new Date(), archivedAt: new Date() }
      });
      await writeAudit(req.user!.id, "request.complete", "request", request.id, undefined, tx);
      return completed;
    });

    res.json(serializeRequestForUser(updated, req.user!));
  }

  @Post("/:id/reviews")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestFeatureConsentGuard("leave_review"))
  async postidReviews9(@Req() req: Request, @Res() res: Response) {
    const input = z.object({
      toUserId: z.string().min(1),
      rating: z.number().int().min(1).max(5),
      text: z.string().min(3).max(1000),
      likedText: z.string().max(1000).optional(),
      improvementText: z.string().max(1000).optional()
    }).parse(req.body);

    const request = await prisma.clientRequest.findUnique({ where: { id: req.params.id } });
    if (!request || request.status !== "completed") {
      throw new HttpError(400, "Отзыв можно оставить только по завершённой заявке", "review_not_allowed");
    }

    const participants = [request.clientId, request.selectedPerformerId].filter(Boolean);
    if (!participants.includes(req.user!.id) || !participants.includes(input.toUserId)) {
      throw new HttpError(403, "Отзыв доступен только участникам заявки", "forbidden");
    }

    const review = await prisma.review.upsert({
      where: {
        requestId_fromUserId_toUserId: {
          requestId: request.id,
          fromUserId: req.user!.id,
          toUserId: input.toUserId
        }
      },
      update: {
        rating: input.rating,
        text: input.text,
        likedText: input.likedText,
        improvementText: input.improvementText
      },
      create: {
        requestId: request.id,
        fromUserId: req.user!.id,
        toUserId: input.toUserId,
        rating: input.rating,
        text: input.text,
        likedText: input.likedText,
        improvementText: input.improvementText
      }
    });

    await recalculateRating(input.toUserId);
    await writeAudit(req.user!.id, "review.upsert", "request", request.id, {
      toUserId: input.toUserId,
      rating: input.rating
    });

    res.status(201).json(review);
  }
}
