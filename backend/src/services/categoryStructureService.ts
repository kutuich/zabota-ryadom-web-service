import { createHash } from "node:crypto";
import { Prisma, type CategoryStructure } from "@prisma/client";
import { prisma } from "../db/prisma";
import { HttpError } from "../utils/http";
import { writeAudit } from "./auditService";

type DbClient = Prisma.TransactionClient | typeof prisma;

export const CATEGORY_STRUCTURE_STATUSES = ["draft", "active", "archived"] as const;
export const CATEGORY_QUALITY_STATUSES = ["draft", "estimated", "reviewed", "tested", "approved"] as const;
export const CATEGORY_SCOPE_TYPES = ["federal", "region", "city"] as const;
export const CATEGORY_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export type CategoryScopeType = typeof CATEGORY_SCOPE_TYPES[number];
export type EffectiveCategoryStructureStatus = "local_ready" | "uses_region_fallback" | "uses_federal_fallback" | "missing_structure";

export const REQUEST_FREQUENCY_CODES = ["once", "several_weekly", "daily", "regular_schedule", "urgent_today", "unknown"] as const;
export type RequestFrequencyCode = typeof REQUEST_FREQUENCY_CODES[number];

export type StructuredRequestPriceInput = {
  cityId: string;
  categoryId: string;
  subcategoryId?: string | null;
  taskTemplateId?: string | null;
  frequencyCode: RequestFrequencyCode;
  categorySpecificFormatCode?: string | null;
  durationMinutes?: number | null;
  queryText?: string | null;
  additionalTask?: {
    categoryId: string;
    subcategoryId?: string | null;
    taskTemplateId?: string | null;
  } | null;
};

const frequencyTitles: Record<RequestFrequencyCode, string> = {
  once: "Разово",
  several_weekly: "Несколько раз в неделю",
  daily: "Ежедневно",
  regular_schedule: "Регулярно по графику",
  urgent_today: "Срочно / сегодня",
  unknown: "Пока не знаю, обсудить в чате"
};

const categorySpecificFormatTitles: Record<string, string> = {
  one_way: "В одну сторону",
  round_trip: "Туда и обратно",
  with_waiting: "С ожиданием",
  by_agreement: "По согласованию",
  companionship: "Побыть рядом",
  hygiene_help: "Помощь с гигиеной",
  diaper_change: "Смена подгузника",
  dressing_help: "Помощь переодеться",
  meal_help: "Помощь с приёмом пищи",
  walk_supervision: "Прогулка и присмотр",
  buy_deliver: "Купить и принести",
  pickup_order: "Забрать заказ",
  transfer_item: "Передать вещь"
};

const medicalProcedureTerms = ["укол", "инъекц", "капельниц", "перевяз", "обработка ран", "назначить лекар", "назначение лекар", "медицинский уход"];
export const MEDICAL_PROCEDURE_WARNING = "Сервис не принимает задачи с медицинскими процедурами. При угрозе жизни или здоровью обращайтесь в экстренные службы.";

const forbiddenImportTerms = ["клиент", "исполнитель", "комиссия", "работник", "трудоустроим", "медицинские услуги"];
const repairCategoryTerms = ["электрик", "электрика", "сантехник", "сантехника", "газ", "ремонт", "бытовая техника", "строительные работы"];

const federalCategories = [
  ["home-help", "Помощь по дому", 700, 1100, ["Лёгкая уборка", "Мытьё посуды", "Вынос мусора", "Полив растений", "Помочь разобрать и убрать вещи", "Приготовить простую еду"]],
  ["supervision", "Уход на дому", 700, 1200, ["Побыть рядом", "Присмотр во время отсутствия родственников", "Прогулка и присмотр", "Бытовая поддержка рядом"]],
  ["shopping-delivery", "Покупки и поручения", 400, 700, ["Купить продукты", "Купить товары для дома", "Купить в аптеке по готовому списку", "Получить заказ"]],
  ["accompaniment", "Сопровождение", 800, 1500, ["Сопроводить Подопечного"]]
] as const;

const commonSafetyRules = [
  ["Без медицинских процедур", "Сервис не выполняет медицинские процедуры и не заменяет врача, медсестру или социальную службу.", "forbidden", true],
  ["Запрещённые действия по здоровью", "Не принимаются задачи с инъекциями, перевязками, выдачей лекарств, медицинскими рекомендациями и медицинским уходом.", "forbidden", true],
  ["Экстренная ситуация", "При угрозе жизни или здоровью нужно обращаться в экстренные службы.", "warning", false],
  ["Опасные работы", "Ремонтные, технические и опасные работы не принимаются.", "forbidden", true],
  ["Оборудование и коммуникации", "Не принимаются задачи, связанные с ремонтом, подключением или обслуживанием электричества, газа, сантехники, отопления, бытовой техники и другого оборудования.", "forbidden", true],
  ["Финансовая безопасность", "Не принимаются задачи с передачей паролей, доступом к банковским приложениям, оформлением кредитов или займов.", "forbidden", true],
  ["Ограниченные товары", "Не принимаются задачи с покупкой алкоголя, табака, запрещённых товаров и товаров, требующих специального права на приобретение.", "forbidden", true]
] as const;

export type CategoryImportPayload = {
  version?: string;
  scope: { type: CategoryScopeType; regionId?: string | null; regionSlug?: string | null; cityId?: string | null; citySlug?: string | null };
  passport?: {
    title?: string;
    description?: string | null;
    versionNumber?: string;
    qualityStatus?: string;
    comment?: string | null;
    parentStructureId?: string | null;
  };
  categories: Array<{
    slug: string;
    parentSlug?: string | null;
    title: string;
    shortTitle?: string | null;
    descriptionForCustomer?: string | null;
    descriptionForHelper?: string | null;
    descriptionForManager?: string | null;
    descriptionForAdmin?: string | null;
    icon?: string | null;
    sortOrder?: number;
    status?: string;
    visibleForCustomer?: boolean;
    visibleForHelper?: boolean;
    visibleForManager?: boolean;
    visibleForAdmin?: boolean;
  }>;
  taskTemplates?: Array<{
    categorySlug: string;
    taskSlug: string;
    title: string;
    description?: string | null;
    shortDescription?: string | null;
    customerHint?: string | null;
    helperHint?: string | null;
    managerHint?: string | null;
    safetyNote?: string | null;
    taskKind?: "standard" | "additional" | "both";
    aliases?: string[];
    durationEffect?: Record<string, unknown> | null;
    priceEffect?: Record<string, unknown> | null;
    requiresComment?: boolean;
    allowedRegions?: string[];
    formFields?: Array<{
      id: string;
      label: string;
      type: "text" | "textarea" | "number" | "select" | "checkbox" | "time";
      required?: boolean;
      requiredWhen?: { fieldId: string; equals: string | number | boolean };
      placeholder?: string | null;
      helpText?: string | null;
      options?: Array<{ value: string; label: string }>;
      min?: number | null;
      max?: number | null;
    }>;
    recommendations?: Array<{ taskSlug: string; label?: string | null }>;
    constraints?: Record<string, unknown> | null;
    sortOrder?: number;
    active?: boolean;
  }>;
  safetyRules?: Array<{ categorySlug: string; ruleKey?: string; title: string; description: string; severity?: string; isBlocking?: boolean; applicability?: SafetyRuleApplicability; active?: boolean; showToCustomer?: boolean; showToHelper?: boolean; showToManager?: boolean; sortOrder?: number }>;
  pricingRules?: Array<{ categorySlug: string; taskSlug?: string | null; packageCode?: string | null; coveredTaskSlugs?: string[]; recommendedMinPrice?: number | null; recommendedMaxPrice?: number | null; defaultDurationMinutes?: number | null; priceComment?: string | null; active?: boolean }>;
};

export type SafetyRuleCondition = {
  fieldId: string;
  operator: "equals" | "not_equals" | "in" | "not_in" | "gt" | "gte" | "lt" | "lte" | "truthy" | "falsy";
  value?: unknown;
};

export type SafetyRuleApplicability = {
  appliesToTaskSlugs?: string[];
  appliesToCategorySlugs?: string[];
  conditions?: SafetyRuleCondition[];
  forbiddenValues?: Array<{ fieldId: string; values: unknown[] }>;
  numericLimits?: Array<{ fieldId: string; minValue?: number; maxValue?: number }>;
  requiredConfirmation?: Array<{ fieldId: string; value?: boolean }>;
};

export async function ensureFederalCategoryStructure(client: DbClient = prisma) {
  const structure = await client.categoryStructure.upsert({
    where: { scopeKey_versionNumber: { scopeKey: "federal", versionNumber: "1.0" } },
    update: {},
    create: {
      scopeType: "federal",
      scopeKey: "federal",
      versionNumber: "1.0",
      title: "Базовая структура РФ",
      description: "Базовый шаблон направлений бытовой помощи для региональных и городских структур.",
      status: "active",
      qualityStatus: "estimated",
      source: "seed",
      publishedAt: new Date()
    }
  });

  for (const [rootSlug, title, minPrice, maxPrice, children] of federalCategories) {
    const root = await client.category.upsert({
      where: { structureId_slug: { structureId: structure.id, slug: rootSlug } },
      update: { title, status: "active", isVisibleForCustomer: true, isVisibleForHelper: true },
      create: {
        structureId: structure.id,
        slug: rootSlug,
        title,
        descriptionForCustomer: `Выберите подходящую задачу в направлении «${title}».`,
        descriptionForHelper: `Задачи направления «${title}», которые можно включить в профиль.`,
        level: 0,
        sortOrder: federalCategories.findIndex((item) => item[0] === rootSlug) * 10 + 10
      }
    });

    for (let index = 0; index < children.length; index += 1) {
      const childTitle = children[index];
      const childSlug = `${rootSlug}-${slugify(childTitle)}`;
      const child = await client.category.upsert({
        where: { structureId_slug: { structureId: structure.id, slug: childSlug } },
        update: { title: childTitle, parentId: root.id, status: "active" },
        create: { structureId: structure.id, parentId: root.id, slug: childSlug, title: childTitle, level: 1, sortOrder: (index + 1) * 10 }
      });
      await client.categoryTaskTemplate.upsert({
        where: { categoryId_slug: { categoryId: child.id, slug: `${childSlug}-task` } },
        update: { title: childTitle, isActive: true },
        create: { categoryId: child.id, slug: `${childSlug}-task`, title: childTitle, sortOrder: 10 }
      });
    }

    for (let index = 0; index < commonSafetyRules.length; index += 1) {
      const [ruleTitle, description, severity, isBlocking] = commonSafetyRules[index];
      const existing = await client.categorySafetyRule.findFirst({ where: { categoryId: root.id, title: ruleTitle } });
      if (!existing) {
        await client.categorySafetyRule.create({ data: { categoryId: root.id, ruleKey: slugify(ruleTitle), title: ruleTitle, description, severity, isBlocking, applicabilityJson: "{}", sortOrder: (index + 1) * 10 } });
      }
    }

    const priceComment = minPrice === null
      ? "По согласованию. Федеральный ориентир требует регионального уточнения."
      : "Федеральный ориентир. Точная сумма согласуется в чате.";
    const existingPricing = await client.categoryPricingRule.findFirst({ where: { categoryId: root.id, isActive: true } });
    if (existingPricing) {
      await client.categoryPricingRule.update({ where: { id: existingPricing.id }, data: { recommendedMinPrice: minPrice, recommendedMaxPrice: maxPrice, priceComment } });
    } else {
      await client.categoryPricingRule.create({ data: { categoryId: root.id, recommendedMinPrice: minPrice, recommendedMaxPrice: maxPrice, priceComment } });
    }
  }
  return structure;
}

export async function getEffectiveCategoryStructure(cityId: string, client: DbClient = prisma) {
  const city = await client.city.findUnique({ where: { id: cityId }, include: { regionRecord: true } });
  if (!city) throw new HttpError(404, "Город не найден", "city_not_found");
  const [federal, regional, local] = await Promise.all([
    findActiveStructure({ scopeKey: "federal" }, client),
    city.regionId ? findActiveStructure({ scopeRegionId: city.regionId, scopeType: "region" }, client) : null,
    findActiveStructure({ scopeCityId: city.id, scopeType: "city" }, client)
  ]);
  const layers = [federal, regional, local].filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (local) return effectiveResult(local, "local_ready", city, layers);
  if (regional) return effectiveResult(regional, "uses_region_fallback", city, layers);
  if (federal) return effectiveResult(federal, "uses_federal_fallback", city, layers);
  return { status: "missing_structure" as const, statusLabel: effectiveStatusLabel("missing_structure"), structure: null, layers: [], city };
}

export async function listCategoryStructures(status: "working" | "active" | "draft" | "archived" | "all" = "working") {
  return prisma.categoryStructure.findMany({
    where: status === "working" ? { status: { in: ["active", "draft"] } } : status === "all" ? undefined : { status },
    include: structureListInclude,
    orderBy: [{ scopeType: "asc" }, { updatedAt: "desc" }]
  });
}

export async function getCategoryStructure(id: string) {
  const structure = await prisma.categoryStructure.findUnique({ where: { id }, include: structureDetailInclude });
  if (!structure) throw new HttpError(404, "Структура категорий не найдена", "category_structure_not_found");
  return structure;
}

export async function getCategoryCityStatuses() {
  const cities = await prisma.city.findMany({
    where: { isActive: true, serviceStatus: "active" },
    include: { regionRecord: true },
    orderBy: [{ region: "asc" }, { name: "asc" }]
  });
  return Promise.all(cities.map(async (city) => {
    const effective = await getEffectiveCategoryStructure(city.id);
    return {
      city: { id: city.id, name: city.name, slug: city.slug, region: city.region, regionId: city.regionId },
      region: city.regionRecord,
      status: effective.status,
      statusLabel: effective.statusLabel,
      effectiveStructure: effective.structure,
      message: cityFallbackMessage(city, effective)
    };
  }));
}

export async function createStructureFromParent(input: { scopeType: "region" | "city"; regionId?: string; cityId?: string; title?: string; comment?: string }, adminId: string) {
  const scope = await resolveTargetScope(input);
  const parent = await resolveParentStructure(scope.regionId, scope.cityId);
  if (!parent) throw new HttpError(409, "Базовая структура РФ не настроена", "category_parent_missing");
  const versionNumber = await nextAvailableVersion(scope.scopeKey);
  const structure = await prisma.$transaction((tx) => cloneStructureTx(tx, parent.id, {
    scopeType: input.scopeType,
    regionId: scope.regionId,
    cityId: scope.cityId,
    scopeKey: scope.scopeKey,
    versionNumber,
    title: input.title ?? scope.defaultTitle,
    comment: input.comment,
    source: "copied_from_parent",
    createdByAdminId: adminId
  }));
  await writeAudit(adminId, "admin.category_structure.create_from_parent", "category_structure", structure.id, { parentStructureId: parent.id, scopeKey: scope.scopeKey });
  return getCategoryStructure(structure.id);
}

export async function createNewStructureVersion(id: string, adminId: string, comment?: string) {
  const source = await getCategoryStructure(id);
  const versionNumber = await nextAvailableVersion(source.scopeKey, source.versionNumber);
  const structure = await prisma.$transaction((tx) => cloneStructureTx(tx, source.id, {
    scopeType: source.scopeType as CategoryScopeType,
    regionId: source.scopeRegionId,
    cityId: source.scopeCityId,
    scopeKey: source.scopeKey,
    versionNumber,
    title: source.title,
    comment,
    source: "manual",
    createdByAdminId: adminId
  }));
  return getCategoryStructure(structure.id);
}

export async function createRollbackDraft(id: string, adminId: string) {
  const source = await getCategoryStructure(id);
  const versionNumber = await nextAvailableVersion(source.scopeKey);
  const structure = await prisma.$transaction(async (tx) => {
    const created = await cloneStructureTx(tx, source.id, {
      scopeType: source.scopeType as CategoryScopeType,
      regionId: source.scopeRegionId,
      cityId: source.scopeCityId,
      scopeKey: source.scopeKey,
      versionNumber,
      title: source.title,
      comment: `Черновик отката на основе v${source.versionNumber}`,
      source: "rollback",
      createdByAdminId: adminId
    });
    await writeAudit(adminId, "admin.category_structure.rollback_draft", "category_structure", created.id, { sourceStructureId: source.id, sourceVersion: source.versionNumber }, tx);
    return created;
  });
  return getCategoryStructure(structure.id);
}

export async function compareCategoryStructures(leftId: string, rightId: string) {
  const [left, right] = await Promise.all([getCategoryStructure(leftId), getCategoryStructure(rightId)]);
  if (left.scopeKey !== right.scopeKey) throw new HttpError(400, "Сравнивать можно только версии одной области действия", "category_structure_scope_mismatch");
  const summarize = (structure: any) => {
    const categoryById = new Map(structure.categories.map((category: any) => [category.id, category]));
    return {
      categories: new Map<string, string>(structure.categories.map((category: any) => [category.slug, JSON.stringify({ parentSlug: category.parentId ? (categoryById.get(category.parentId) as any)?.slug : null, title: category.title, status: category.status, visible: category.isVisibleForCustomer })])),
      tasks: new Map<string, string>(structure.categories.flatMap((category: any) => category.taskTemplates.map((task: any) => [`${category.slug}:${task.slug}`, JSON.stringify({ title: task.title, active: task.isActive, taskKind: task.taskKind, formFields: safeJson(task.formFieldsJson), constraints: safeJson(task.constraintsJson) })]))),
      prices: new Map<string, string>(structure.categories.flatMap((category: any) => category.pricingRules.map((rule: any) => [`${category.slug}:${rule.taskTemplate?.slug ?? "category"}:${rule.recommendedPackageCode ?? "single"}`, JSON.stringify({ min: rule.recommendedMinPrice, max: rule.recommendedMaxPrice, duration: rule.defaultDurationMinutes, active: rule.isActive })])))
    };
  };
  const leftSummary = summarize(left);
  const rightSummary = summarize(right);
  return {
    left: publicStructurePassport(left),
    right: publicStructurePassport(right),
    categories: diffMap(leftSummary.categories, rightSummary.categories),
    tasks: diffMap(leftSummary.tasks, rightSummary.tasks),
    pricingRules: diffMap(leftSummary.prices, rightSummary.prices)
  };
}

function diffMap(left: Map<string, string>, right: Map<string, string>) {
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  return {
    added: keys.filter((key) => !left.has(key) && right.has(key)),
    removed: keys.filter((key) => left.has(key) && !right.has(key)),
    changed: keys.filter((key) => left.has(key) && right.has(key) && left.get(key) !== right.get(key))
  };
}

export async function updateDraftStructure(id: string, input: { title?: string; description?: string | null; qualityStatus?: string; comment?: string | null }, adminId: string) {
  const current = await prisma.categoryStructure.findUnique({ where: { id } });
  if (!current) throw new HttpError(404, "Структура категорий не найдена", "category_structure_not_found");
  if (current.status !== "draft") throw new HttpError(409, "Редактировать можно только черновик", "category_structure_not_draft");
  if (input.qualityStatus && !CATEGORY_QUALITY_STATUSES.includes(input.qualityStatus as never)) {
    throw new HttpError(400, "Некорректный статус качества", "category_quality_invalid");
  }
  const updated = await prisma.categoryStructure.update({ where: { id }, data: input });
  await writeAudit(adminId, "admin.category_structure.update", "category_structure", id, { fields: Object.keys(input) });
  return updated;
}

export async function publishCategoryStructure(id: string, adminId: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.categoryStructure.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, "Структура категорий не найдена", "category_structure_not_found");
    if (current.status !== "draft") throw new HttpError(409, "Опубликовать можно только черновик", "category_structure_not_draft");
    await tx.categoryStructure.updateMany({
      where: { scopeKey: current.scopeKey, status: "active", id: { not: current.id } },
      data: { status: "archived", archivedAt: new Date() }
    });
    const published = await tx.categoryStructure.update({
      where: { id },
      data: { status: "active", publishedAt: new Date(), activatedAt: new Date(), publishedByAdminId: adminId, archivedAt: null }
    });
    await writeAudit(adminId, "admin.category_structure.publish", "category_structure", id, { scopeKey: current.scopeKey, versionNumber: current.versionNumber }, tx);
    return published;
  });
}

export async function archiveCategoryStructure(id: string, adminId: string) {
  const current = await prisma.categoryStructure.findUnique({ where: { id } });
  if (!current) throw new HttpError(404, "Структура категорий не найдена", "category_structure_not_found");
  const archived = await prisma.categoryStructure.update({ where: { id }, data: { status: "archived", archivedAt: new Date() } });
  await writeAudit(adminId, "admin.category_structure.archive", "category_structure", id, { scopeKey: current.scopeKey });
  return archived;
}

export async function buildStructureExport(id: string, adminId: string) {
  const structure = await getCategoryStructure(id);
  await writeAudit(adminId, "admin.category_structure.export", "category_structure", id, { format: "xlsx" });
  return exportBundle(structure, { generatedBy: adminId });
}

export async function buildCityTemplateExport(cityId: string, adminId: string) {
  const effective = await getEffectiveCategoryStructure(cityId);
  if (!effective.structure) throw new HttpError(409, "Базовая структура не настроена", "category_structure_missing");
  const sourceStructure = await getCategoryStructure(effective.structure.id);
  const city = effective.city;
  const warning = effective.status === "uses_federal_fallback"
    ? "Для региона нет опубликованной структуры. Рекомендуется сначала создать региональную структуру, затем городскую."
    : effective.status === "uses_region_fallback"
      ? "Шаблон города подготовлен на основе региональной структуры."
      : "Экспортируется действующая городская структура.";
  await writeAudit(adminId, "admin.category_structure.export", "city", city.id, { format: "xlsx", template: true, effectiveStatus: effective.status });
  return exportBundle(sourceStructure, { targetCity: city, warning, generatedBy: adminId });
}

export async function buildRegionTemplateExport(regionId: string, adminId: string) {
  const region = await prisma.region.findUnique({ where: { id: regionId } });
  if (!region) throw new HttpError(404, "Регион не найден", "region_not_found");
  const regional = await findActiveStructure({ scopeRegionId: region.id, scopeType: "region" });
  const base = regional ?? await findActiveStructure({ scopeKey: "federal" });
  if (!base) throw new HttpError(409, "Базовая структура не настроена", "category_structure_missing");
  const sourceStructure = await getCategoryStructure(base.id);
  await writeAudit(adminId, "admin.category_structure.export", "region", region.id, { format: "xlsx", template: !regional });
  return exportBundle(sourceStructure, { targetRegion: region, warning: regional ? "" : "Шаблон региона подготовлен на основе базовой структуры РФ.", generatedBy: adminId });
}

export function validateCategoryImport(payload: CategoryImportPayload) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!CATEGORY_SCOPE_TYPES.includes(payload.scope?.type)) errors.push("Некорректный тип структуры.");
  if (payload.passport?.versionNumber && !/^\d+\.\d+$/.test(payload.passport.versionNumber)) errors.push("Версия структуры должна иметь формат 2.0.");
  if (payload.scope?.type === "region" && !payload.scope.regionId && !payload.scope.regionSlug) errors.push("Для региональной структуры нужен regionId или regionSlug.");
  if (payload.scope?.type === "city" && !payload.scope.cityId && !payload.scope.citySlug) errors.push("Для городской структуры нужен cityId или citySlug.");
  if (!Array.isArray(payload.categories) || payload.categories.length === 0) errors.push("Добавьте хотя бы одну категорию.");

  const slugs = new Set<string>();
  for (const category of payload.categories ?? []) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category.slug ?? "")) errors.push(`Некорректный slug категории: ${category.slug || "пусто"}.`);
    if (slugs.has(category.slug)) errors.push(`Slug категории повторяется: ${category.slug}.`);
    slugs.add(category.slug);
  }
  for (const category of payload.categories ?? []) {
    if (category.parentSlug && !slugs.has(category.parentSlug)) errors.push(`Родительская категория не найдена: ${category.parentSlug}.`);
    if (category.status && !["draft", "active", "hidden", "archived"].includes(category.status)) errors.push(`Некорректный статус категории ${category.slug}.`);
  }
  for (const row of [...(payload.taskTemplates ?? []), ...(payload.safetyRules ?? []), ...(payload.pricingRules ?? [])]) {
    if (!slugs.has(row.categorySlug)) errors.push(`Категория ${row.categorySlug} не найдена.`);
  }
  const taskKeys = new Set<string>();
  const taskSlugs = new Set<string>();
  for (const task of payload.taskTemplates ?? []) {
    const key = `${task.categorySlug}:${task.taskSlug}`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(task.taskSlug ?? "")) errors.push(`Некорректный slug задачи: ${task.taskSlug || "пусто"}.`);
    if (taskKeys.has(key)) errors.push(`Задача повторяется: ${key}.`);
    taskKeys.add(key);
    taskSlugs.add(task.taskSlug);
    if (task.taskKind && !["standard", "additional", "both"].includes(task.taskKind)) errors.push(`Некорректный тип задачи ${task.taskSlug}.`);
    const fieldIds = new Set<string>();
    for (const field of task.formFields ?? []) {
      if (!/^[a-z][a-z0-9_]*$/.test(field.id ?? "")) errors.push(`Некорректное id поля ${field.id || "пусто"} для ${task.taskSlug}.`);
      if (fieldIds.has(field.id)) errors.push(`Поле ${field.id} повторяется в ${task.taskSlug}.`);
      fieldIds.add(field.id);
      if (!["text", "textarea", "number", "select", "checkbox", "time"].includes(field.type)) errors.push(`Некорректный тип поля ${field.id} для ${task.taskSlug}.`);
      if (field.type === "select" && !(field.options?.length)) errors.push(`Для поля ${field.id} нужны options.`);
      if (field.requiredWhen && !fieldIds.has(field.requiredWhen.fieldId) && !(task.formFields ?? []).some((candidate) => candidate.id === field.requiredWhen!.fieldId)) {
        errors.push(`Условие поля ${field.id} ссылается на неизвестное поле ${field.requiredWhen.fieldId}.`);
      }
    }
  }
  for (const task of payload.taskTemplates ?? []) {
    for (const recommendation of task.recommendations ?? []) {
      if (!taskSlugs.has(recommendation.taskSlug)) errors.push(`Рекомендуемая задача ${recommendation.taskSlug} не найдена.`);
    }
  }
  const safetyRuleKeys = new Set<string>();
  for (const row of payload.safetyRules ?? []) {
    const normalizedRuleKey = row.ruleKey || slugify(row.title);
    const safetyKey = `${row.categorySlug}:${normalizedRuleKey}`;
    if (safetyRuleKeys.has(safetyKey)) errors.push(`Ограничение повторяется: ${safetyKey}.`);
    safetyRuleKeys.add(safetyKey);
    if (row.severity && !["info", "warning", "forbidden"].includes(row.severity)) errors.push(`Некорректная важность ограничения для ${row.categorySlug}.`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedRuleKey)) errors.push(`Некорректный ruleKey ограничения для ${row.categorySlug}.`);
    const applicability = row.applicability ?? {};
    const hasMachineCondition = Boolean(
      applicability.conditions?.length
      || applicability.forbiddenValues?.length
      || applicability.numericLimits?.length
      || applicability.requiredConfirmation?.length
    );
    if (row.isBlocking && !hasMachineCondition) errors.push(`Для блокирующего правила ${row.ruleKey || row.title} необходимо указать машиночитаемое условие применимости.`);
    for (const slug of applicability.appliesToTaskSlugs ?? []) if (!taskSlugs.has(slug)) errors.push(`Задача ${slug} для ограничения ${row.ruleKey} не найдена.`);
    for (const slug of applicability.appliesToCategorySlugs ?? []) if (!slugs.has(slug)) errors.push(`Категория ${slug} для ограничения ${row.ruleKey} не найдена.`);
    for (const condition of applicability.conditions ?? []) {
      if (!condition.fieldId || !["equals", "not_equals", "in", "not_in", "gt", "gte", "lt", "lte", "truthy", "falsy"].includes(condition.operator)) errors.push(`Некорректное условие ограничения ${row.ruleKey}.`);
    }
    for (const limit of applicability.numericLimits ?? []) {
      if (!limit.fieldId || (limit.minValue == null && limit.maxValue == null) || (limit.minValue != null && limit.maxValue != null && limit.minValue > limit.maxValue)) errors.push(`Некорректный числовой предел ограничения ${row.ruleKey}.`);
    }
  }
  for (const row of payload.pricingRules ?? []) {
    const min = row.recommendedMinPrice;
    const max = row.recommendedMaxPrice;
    if ((min ?? 0) < 0 || (max ?? 0) < 0) errors.push(`Рекомендуемые цены для ${row.categorySlug} не могут быть отрицательными.`);
    if (min != null && max != null && min > max) errors.push(`Минимальная цена больше максимальной для ${row.categorySlug}.`);
    if (row.taskSlug && !taskKeys.has(`${row.categorySlug}:${row.taskSlug}`)) errors.push(`Задача ${row.taskSlug} для ценового правила не найдена в ${row.categorySlug}.`);
  }

  const searchableText = JSON.stringify(payload).toLocaleLowerCase("ru-RU");
  for (const term of forbiddenImportTerms) {
    if (searchableText.includes(term)) {
      errors.push(term === "медицинские услуги"
        ? "Фразу «медицинские услуги» замените на «медицинские процедуры»."
        : `Запрещённый термин в пользовательском тексте: «${term}».`);
    }
  }
  for (const category of payload.categories ?? []) {
    const offeredText = [category.title, category.shortTitle, category.descriptionForCustomer, category.descriptionForHelper].filter(Boolean).join(" ").toLocaleLowerCase("ru-RU");
    for (const term of repairCategoryTerms) {
      if (offeredText.includes(term)) warnings.push(`Проверьте категорию ${category.slug}: ремонтные, технические и опасные работы не принимаются.`);
    }
  }
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    summary: {
      scopeType: payload.scope?.type,
      categories: payload.categories?.filter((item) => !item.parentSlug).length ?? 0,
      subcategories: payload.categories?.filter((item) => item.parentSlug).length ?? 0,
      taskTemplates: payload.taskTemplates?.length ?? 0,
      safetyRules: payload.safetyRules?.length ?? 0,
      pricingRules: payload.pricingRules?.length ?? 0
    }
  };
}

export async function createDraftFromImport(payload: CategoryImportPayload, adminId: string, fileName?: string) {
  const preview = validateCategoryImport(payload);
  if (!preview.valid) throw new HttpError(400, "Импорт содержит ошибки", "category_import_invalid", preview);
  const scope = await resolveTargetScope({ scopeType: payload.scope.type as "region" | "city", regionId: payload.scope.regionId ?? undefined, regionSlug: payload.scope.regionSlug ?? undefined, cityId: payload.scope.cityId ?? undefined, citySlug: payload.scope.citySlug ?? undefined }, payload.scope.type === "federal");
  const versionNumber = payload.passport?.versionNumber || await nextAvailableVersion(scope.scopeKey);
  const existingVersion = await prisma.categoryStructure.findUnique({ where: { scopeKey_versionNumber: { scopeKey: scope.scopeKey, versionNumber } } });
  if (existingVersion) throw new HttpError(409, "Такая версия структуры уже существует", "category_structure_version_exists");
  const importHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const duplicate = await prisma.categoryStructure.findFirst({ where: { importHash } });
  if (duplicate) throw new HttpError(409, "Этот файл уже был импортирован", "category_import_duplicate");

  const structure = await prisma.$transaction(async (tx) => {
    const created = await tx.categoryStructure.create({ data: {
      scopeType: payload.scope.type,
      scopeRegionId: scope.regionId,
      scopeCityId: scope.cityId,
      scopeKey: scope.scopeKey,
      parentStructureId: payload.passport?.parentStructureId,
      versionNumber,
      title: payload.passport?.title || scope.defaultTitle,
      description: payload.passport?.description,
      status: "draft",
      qualityStatus: CATEGORY_QUALITY_STATUSES.includes(payload.passport?.qualityStatus as never) ? payload.passport?.qualityStatus : "draft",
      source: "import",
      createdByAdminId: adminId,
      comment: payload.passport?.comment,
      importFileName: fileName,
      importHash,
      metadataJson: JSON.stringify({ warnings: preview.warnings })
    } });
    await populateStructureFromImportTx(tx, created.id, payload);
    await writeAudit(adminId, "admin.category_structure.import", "category_structure", created.id, { fileName, importHash, warnings: preview.warnings }, tx);
    return created;
  });
  return getCategoryStructure(structure.id);
}

export async function categoriesForCity(cityId: string, audience: "customer" | "helper", client: DbClient = prisma) {
  const effective = await getEffectiveCategoryStructure(cityId, client);
  if (!effective.structure) return { ...effective, categories: [] };
  const categories = await buildEffectiveCategories(effective.layers, audience, effective.city, client);
  return {
    status: effective.status,
    statusLabel: effective.statusLabel,
    structure: publicStructurePassport(effective.structure),
    layers: effective.layers.map(publicStructurePassport),
    categories
  };
}

async function buildEffectiveCategories(layers: any[], audience: "customer" | "helper", city: any, client: DbClient) {
  if (!layers.length) return [];
  const rows = await client.category.findMany({
    where: { structureId: { in: layers.map((layer) => layer.id) } },
    include: {
      taskTemplates: { orderBy: { sortOrder: "asc" } },
      pricingRules: { orderBy: { createdAt: "asc" }, include: { taskTemplate: true } },
      safetyRules: { orderBy: { sortOrder: "asc" } }
    },
    orderBy: [{ level: "asc" }, { sortOrder: "asc" }]
  });
  const byStructure = new Map<string, any[]>();
  for (const row of rows) byStructure.set(row.structureId, [...(byStructure.get(row.structureId) ?? []), row]);
  const categoryMap = new Map<string, any>();
  const taskMap = new Map<string, any>();
  const pricingMap = new Map<string, any[]>();
  const safetyMap = new Map<string, any>();

  for (const layer of layers) {
    const layerRows = byStructure.get(layer.id) ?? [];
    const rowById = new Map(layerRows.map((row) => [row.id, row]));
    for (const row of layerRows) {
      const parent = row.parentId ? rowById.get(row.parentId) : null;
      const logicalKey = parent ? `${parent.slug}/${row.slug}` : row.slug;
      categoryMap.set(logicalKey, { ...row, logicalKey, parentLogicalKey: parent?.slug ?? null, sourceStructure: publicStructurePassport(layer) });
      if (row.pricingRules.length) pricingMap.set(logicalKey, row.pricingRules.filter((rule: any) => rule.isActive).map((rule: any) => ({ ...rule, sourceStructure: publicStructurePassport(layer) })));
      for (const rule of row.safetyRules) {
        const ruleKey = rule.ruleKey || slugify(rule.title);
        safetyMap.set(`${logicalKey}/${ruleKey}`, { ...rule, ruleKey, logicalCategoryKey: logicalKey, categorySlug: row.slug, sourceStructure: publicStructurePassport(layer) });
      }
      for (const task of row.taskTemplates) taskMap.set(`${logicalKey}/${task.slug}`, { ...task, logicalCategoryKey: logicalKey, sourceStructure: publicStructurePassport(layer) });
    }
  }

  const visible = (category: any) => category.status === "active" && (audience === "customer" ? category.isVisibleForCustomer : category.isVisibleForHelper);
  const taskAllowed = (task: any) => {
    if (!task.isActive) return false;
    const allowed = jsonArray(task.allowedRegionsJson);
    if (!allowed.length) return true;
    return [city.regionId, city.regionRecord?.slug, city.region, city.id, city.slug, city.name].filter(Boolean).some((value) => allowed.includes(value));
  };
  const roots = [...categoryMap.values()].filter((row) => !row.parentLogicalKey && visible(row));
  return roots.sort((a, b) => a.sortOrder - b.sortOrder).map((root) => {
    const children = [...categoryMap.values()]
      .filter((row) => row.parentLogicalKey === root.slug && visible(row))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((child) => effectivePublicCategory(child, root.id, audience, taskMap, pricingMap, safetyMap, taskAllowed));
    return {
      ...effectivePublicCategory(root, null, audience, taskMap, pricingMap, safetyMap, taskAllowed),
      children
    };
  });
}

function effectivePublicCategory(category: any, parentId: string | null, audience: "customer" | "helper", taskMap: Map<string, any>, pricingMap: Map<string, any[]>, safetyMap: Map<string, any>, taskAllowed: (task: any) => boolean) {
  const descriptionField = audience === "customer" ? "descriptionForCustomer" : "descriptionForHelper";
  const hintField = audience === "customer" ? "customerHint" : "helperHint";
  const tasks = [...taskMap.values()]
    .filter((task) => task.logicalCategoryKey === category.logicalKey && taskAllowed(task))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((task) => ({
      id: task.id,
      slug: task.slug,
      title: task.title,
      description: task.description,
      [hintField]: task[hintField],
      safetyNote: task.safetyNote,
      taskKind: task.taskKind,
      aliases: jsonArray(task.aliasesJson),
      durationEffect: safeJson(task.durationEffectJson) ?? {},
      priceEffect: safeJson(task.priceEffectJson) ?? {},
      requiresComment: task.requiresComment,
      allowedRegions: jsonArray(task.allowedRegionsJson),
      formFields: safeJson(task.formFieldsJson) ?? [],
      recommendations: safeJson(task.recommendationsJson) ?? [],
      constraints: safeJson(task.constraintsJson) ?? {},
      sortOrder: task.sortOrder,
      sourceStructure: task.sourceStructure
    }));
  const rules = (pricingMap.get(category.logicalKey) ?? []).map((price) => ({
    id: price.id,
    taskTemplateId: price.taskTemplateId,
    taskSlug: price.taskTemplate?.slug ?? null,
    recommendedPackageCode: price.recommendedPackageCode,
    recommendedMinPrice: price.recommendedMinPrice,
    recommendedMaxPrice: price.recommendedMaxPrice,
    defaultDurationMinutes: price.defaultDurationMinutes,
    priceComment: price.priceComment,
    coveredTaskSlugs: jsonArray(price.coveredTaskSlugsJson),
    sourceStructure: price.sourceStructure
  }));
  const safetyRules = [...safetyMap.values()]
    .filter((rule) => rule.logicalCategoryKey === category.logicalKey && rule.isActive && (audience === "customer" ? rule.showToCustomer : rule.showToHelper))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.ruleKey.localeCompare(right.ruleKey))
    .map((rule) => ({ id: rule.id, ruleKey: rule.ruleKey, title: rule.title, description: rule.description, severity: rule.severity, isBlocking: rule.isBlocking, applicability: safeJson(rule.applicabilityJson) ?? {}, categorySlug: rule.categorySlug, sourceStructure: rule.sourceStructure, sortOrder: rule.sortOrder }));
  return {
    id: category.id,
    structureId: category.structureId,
    sourceStructure: category.sourceStructure,
    logicalKey: category.logicalKey,
    parentId,
    slug: category.slug,
    title: category.title,
    shortTitle: category.shortTitle,
    [descriptionField]: category[descriptionField],
    icon: category.icon,
    level: parentId ? 1 : 0,
    sortOrder: category.sortOrder,
    status: category.status,
    taskTemplates: tasks,
    safetyRules,
    pricingRules: rules
  };
}

export function calculateRecommendedAmount(
  minPrice: number | null,
  maxPrice: number | null,
  frequencyCode: RequestFrequencyCode,
  durationMinutes?: number | null,
  defaultDurationMinutes?: number | null
) {
  if (minPrice === null) return null;
  const max = maxPrice ?? minPrice;
  let mode: "simple" | "normal" | "extended" | "urgent" = frequencyCode === "urgent_today" ? "urgent" : "normal";
  if (durationMinutes && defaultDurationMinutes) {
    if (durationMinutes <= defaultDurationMinutes / 2) mode = "simple";
    else if (durationMinutes > defaultDurationMinutes) mode = "extended";
  }
  const raw = mode === "simple" ? minPrice : mode === "extended" || mode === "urgent" ? max : (minPrice + max) / 2;
  const step = raw < 1000 ? 50 : 100;
  return Math.round(raw / step) * step;
}

export async function calculateStructuredRequestPrice(input: StructuredRequestPriceInput, client: DbClient = prisma) {
  const effective = await getEffectiveCategoryStructure(input.cityId, client);
  if (!effective.structure) {
    return {
      baseRange: null,
      calculatedRecommendedPrice: null,
      additionalTask: null,
      finalCalculatedRecommendedPrice: null,
      breakdown: [],
      sourceStructure: null,
      fallbackStatus: effective.status,
      userMessage: "Для этого города база ориентиров пока не настроена. Итоговая сумма согласуется в чате.",
      warnings: safetyWarnings(input.queryText)
    };
  }

  const effectiveStructureIds = effective.layers.map((layer) => layer.id);
  const main = await resolveStructuredSelection(client, effectiveStructureIds, input);
  const additional = input.additionalTask
    ? await resolveStructuredSelection(client, effectiveStructureIds, input.additionalTask)
    : null;
  if (additional && additional.category.id === main.category.id) {
    throw new HttpError(400, "Дополнительная задача должна относиться к другому направлению", "request_additional_category_mismatch");
  }

  const mainAmount = calculateRecommendedAmount(
    main.pricing?.recommendedMinPrice ?? null,
    main.pricing?.recommendedMaxPrice ?? null,
    input.frequencyCode,
    input.durationMinutes,
    main.pricing?.defaultDurationMinutes
  );
  const additionalAmount = additional
    ? calculateRecommendedAmount(
        additional.pricing?.recommendedMinPrice ?? null,
        additional.pricing?.recommendedMaxPrice ?? null,
        input.frequencyCode,
        input.durationMinutes,
        additional.pricing?.defaultDurationMinutes
      )
    : null;
  const finalAmount = mainAmount === null ? null : mainAmount + (additionalAmount ?? 0);
  const sourceStructure = publicStructurePassport(effective.structure);
  const sourceMessage = calculationSourceMessage(effective.status, effective.city, sourceStructure);
  const breakdown = [
    calculationLine("main", main, mainAmount),
    ...(additional ? [calculationLine("additional", additional, additionalAmount)] : [])
  ];
  const warnings = [
    ...safetyWarnings(input.queryText),
    ...main.safetyRules.filter((rule) => rule.severity === "warning").map((rule) => rule.description)
  ];
  const userMessage = mainAmount === null
    ? "Для этой задачи ориентир пока не задан. Итоговая сумма согласуется в чате."
    : additional && additionalAmount === null
      ? `Ориентировочная сумма основной задачи: ${mainAmount} ₽. Дополнительная задача будет уточнена в чате.`
      : `Ориентировочная сумма: ${finalAmount} ₽. Итоговая сумма подтверждается Заказчиком и Помощником в чате.`;

  return {
    baseRange: main.pricing ? { min: main.pricing.recommendedMinPrice, max: main.pricing.recommendedMaxPrice } : null,
    calculatedRecommendedPrice: mainAmount,
    additionalTask: additional ? {
      category: categoryIdentity(additional.category),
      subcategory: additional.subcategory ? categoryIdentity(additional.subcategory) : null,
      taskTemplate: additional.taskTemplate ? taskIdentity(additional.taskTemplate) : null,
      baseRange: additional.pricing ? { min: additional.pricing.recommendedMinPrice, max: additional.pricing.recommendedMaxPrice } : null,
      calculatedRecommendedPrice: additionalAmount
    } : null,
    finalCalculatedRecommendedPrice: finalAmount,
    breakdown,
    sourceStructure,
    sourceMessage,
    fallbackStatus: effective.status,
    frequencyCode: input.frequencyCode,
    frequencyTitle: frequencyTitles[input.frequencyCode],
    categorySpecificFormatCode: input.categorySpecificFormatCode ?? null,
    categorySpecificFormatTitle: input.categorySpecificFormatCode ? categorySpecificFormatTitles[input.categorySpecificFormatCode] ?? "По согласованию" : null,
    userMessage,
    warnings
  };
}

export async function saveHelperCategoryPreferences(helperUserId: string, input: { cityId: string; categoryIds: string[]; comment?: string }) {
  const user = await prisma.user.findUnique({ where: { id: helperUserId } });
  if (!user || user.role !== "performer") throw new HttpError(403, "Доступно только Помощнику", "helper_required");
  const available = await categoriesForCity(input.cityId, "helper");
  const allowed = new Map(available.categories.map((category) => [category.id, category]));
  if (input.categoryIds.some((id) => !allowed.has(id))) throw new HttpError(400, "Выбрана недоступная категория", "helper_category_invalid");
  const rows = await prisma.$transaction(async (tx) => {
    await tx.helperCategoryPreference.updateMany({ where: { helperUserId, cityId: input.cityId }, data: { isEnabled: false } });
    for (const categoryId of input.categoryIds) {
      const category = allowed.get(categoryId)!;
      await tx.helperCategoryPreference.upsert({
        where: { helperUserId_cityId_categoryId: { helperUserId, cityId: input.cityId, categoryId } },
        create: { helperUserId, cityId: input.cityId, categoryId, categorySlug: category.slug, isEnabled: true, comment: input.comment },
        update: { categorySlug: category.slug, isEnabled: true, comment: input.comment }
      });
    }
    return tx.helperCategoryPreference.findMany({ where: { helperUserId, cityId: input.cityId }, include: { category: true, city: true } });
  });
  return rows.map(publicHelperCategoryPreference);
}

export async function getHelperCategoryPreferences(helperUserId: string, cityId?: string) {
  const rows = await prisma.helperCategoryPreference.findMany({
    where: { helperUserId, ...(cityId ? { cityId } : {}) },
    include: { category: true, city: true },
    orderBy: [{ cityId: "asc" }, { createdAt: "asc" }]
  });
  return rows.map(publicHelperCategoryPreference);
}

export async function createRequestCategorySnapshotTx(client: Prisma.TransactionClient, input: {
  requestId: string;
  cityId: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  taskTemplateId?: string | null;
  frequencyCode?: RequestFrequencyCode;
  categorySpecificFormatCode?: string | null;
  durationMinutes?: number | null;
  queryText?: string | null;
  additionalTask?: StructuredRequestPriceInput["additionalTask"];
}) {
  const effective = await getEffectiveCategoryStructure(input.cityId, client);
  if (!effective.structure) return null;
  const [category, subcategory, taskTemplate] = await Promise.all([
    input.categoryId ? client.category.findFirst({ where: { id: input.categoryId, structureId: { in: effective.layers.map((layer) => layer.id) } } }) : null,
    input.subcategoryId ? client.category.findFirst({ where: { id: input.subcategoryId, structureId: { in: effective.layers.map((layer) => layer.id) } } }) : null,
    input.taskTemplateId ? client.categoryTaskTemplate.findUnique({ where: { id: input.taskTemplateId }, include: { category: true } }) : null
  ]);
  if (input.categoryId && !category) throw new HttpError(400, "Выбрана недоступная категория", "request_category_invalid");
  if (input.subcategoryId && !subcategory) throw new HttpError(400, "Выбрана недоступная подкатегория", "request_subcategory_invalid");
  if (subcategory && category && subcategory.parentId !== category.id) {
    throw new HttpError(400, "Подкатегория не относится к выбранной категории", "request_subcategory_mismatch");
  }
  if (input.taskTemplateId && (!taskTemplate || !effective.layers.some((layer) => layer.id === taskTemplate.category.structureId))) {
    throw new HttpError(400, "Выбран недоступный шаблон задачи", "request_task_template_invalid");
  }
  const expectedTaskCategoryId = subcategory?.id ?? category?.id;
  if (taskTemplate && expectedTaskCategoryId && taskTemplate.categoryId !== expectedTaskCategoryId) {
    throw new HttpError(400, "Шаблон задачи не относится к выбранной категории", "request_task_template_mismatch");
  }
  const selectedCategory = category ?? (subcategory?.parentId ? await client.category.findUnique({ where: { id: subcategory.parentId } }) : null);
  const [categoryPricingRules, subcategoryPricingRules] = selectedCategory ? await Promise.all([
    client.categoryPricingRule.findMany({ where: { categoryId: selectedCategory.id, isActive: true }, include: { taskTemplate: true } }),
    subcategory ? client.categoryPricingRule.findMany({ where: { categoryId: subcategory.id, isActive: true }, include: { taskTemplate: true } }) : Promise.resolve([])
  ]) : [[], []];
  const pricing = selectStructuredPricingRule(categoryPricingRules, subcategoryPricingRules, taskTemplate);
  const safetyRules = selectedCategory ? await client.categorySafetyRule.findMany({ where: { categoryId: selectedCategory.id, showToCustomer: true }, orderBy: { sortOrder: "asc" } }) : [];
  const city = effective.city;
  const calculation = selectedCategory ? await calculateStructuredRequestPrice({
    cityId: input.cityId,
    categoryId: selectedCategory.id,
    subcategoryId: subcategory?.id,
    taskTemplateId: taskTemplate?.id,
    frequencyCode: input.frequencyCode ?? "unknown",
    categorySpecificFormatCode: input.categorySpecificFormatCode,
    durationMinutes: input.durationMinutes,
    queryText: input.queryText,
    additionalTask: input.additionalTask
  }, client) : null;
  const additional = calculation?.additionalTask;
  const calculatedAt = new Date().toISOString();
  return client.requestCategorySnapshot.create({ data: {
    requestId: input.requestId,
    structureId: effective.structure.id,
    categoryId: selectedCategory?.id,
    subcategoryId: subcategory?.id,
    taskTemplateId: taskTemplate?.id,
    snapshotJson: JSON.stringify({
      structure: publicStructurePassport(effective.structure),
      structureLayers: effective.layers.map(publicStructurePassport),
      effectiveStatus: effective.status,
      category: selectedCategory ? { id: selectedCategory.id, slug: selectedCategory.slug, title: selectedCategory.title } : null,
      subcategory: subcategory ? { id: subcategory.id, slug: subcategory.slug, title: subcategory.title } : null,
      taskTemplate: taskTemplate ? { id: taskTemplate.id, slug: taskTemplate.slug, title: taskTemplate.title } : null,
      recommendedPrice: pricing ? { min: pricing.recommendedMinPrice, max: pricing.recommendedMaxPrice, comment: pricing.priceComment } : null,
      safetyRules: safetyRules.map((rule) => ({ title: rule.title, description: rule.description, severity: rule.severity, isBlocking: rule.isBlocking })),
      city: { id: city.id, name: city.name, region: city.region },
      cityId: city.id,
      cityTitle: city.name,
      regionTitle: city.region,
      structureId: effective.structure.id,
      structureTitle: effective.structure.title,
      structureVersion: effective.structure.versionNumber,
      structureScopeType: effective.structure.scopeType,
      structureFallbackStatus: effective.status,
      categoryId: selectedCategory?.id ?? null,
      categoryTitle: selectedCategory?.title ?? null,
      categorySlug: selectedCategory?.slug ?? null,
      subcategoryId: subcategory?.id ?? null,
      subcategoryTitle: subcategory?.title ?? null,
      subcategorySlug: subcategory?.slug ?? null,
      taskTemplateId: taskTemplate?.id ?? null,
      taskTemplateTitle: taskTemplate?.title ?? null,
      frequencyCode: calculation?.frequencyCode ?? input.frequencyCode ?? "unknown",
      frequencyTitle: calculation?.frequencyTitle ?? frequencyTitles[input.frequencyCode ?? "unknown"],
      categorySpecificFormatCode: input.categorySpecificFormatCode ?? null,
      categorySpecificFormatTitle: input.categorySpecificFormatCode ? categorySpecificFormatTitles[input.categorySpecificFormatCode] ?? "По согласованию" : null,
      baseRecommendedMinPrice: calculation?.baseRange?.min ?? null,
      baseRecommendedMaxPrice: calculation?.baseRange?.max ?? null,
      calculatedRecommendedPrice: calculation?.calculatedRecommendedPrice ?? null,
      additionalTaskCategoryId: additional?.category.id ?? null,
      additionalTaskCategoryTitle: additional?.category.title ?? null,
      additionalTaskSubcategoryId: additional?.subcategory?.id ?? null,
      additionalTaskSubcategoryTitle: additional?.subcategory?.title ?? null,
      additionalTaskCalculatedPrice: additional?.calculatedRecommendedPrice ?? null,
      finalCalculatedRecommendedPrice: calculation?.finalCalculatedRecommendedPrice ?? null,
      pricingComment: pricing?.priceComment ?? null,
      calculationBreakdownJson: calculation?.breakdown ?? [],
      pricingSourceStructureId: calculation?.sourceStructure?.id ?? effective.structure.id,
      pricingSourceStructureTitle: calculation?.sourceStructure?.title ?? effective.structure.title,
      pricingSourceVersion: calculation?.sourceStructure?.versionNumber ?? effective.structure.versionNumber,
      pricingSourceScopeType: calculation?.sourceStructure?.scopeType ?? effective.structure.scopeType,
      fallbackStatus: calculation?.fallbackStatus ?? effective.status,
      safetyRulesShown: calculation?.warnings ?? [],
      calculatedAt,
      createdAt: calculatedAt
    })
  } });
}

export function serializeRequestCategorySnapshot(snapshot?: { id: string; structureId: string; categoryId: string | null; subcategoryId: string | null; taskTemplateId: string | null; snapshotJson: string; createdAt: Date } | null) {
  if (!snapshot) return null;
  return { ...snapshot, snapshot: safeJson(snapshot.snapshotJson), createdAt: snapshot.createdAt.toISOString() };
}

function findActiveStructure(where: Prisma.CategoryStructureWhereInput, client: DbClient = prisma) {
  return client.categoryStructure.findFirst({ where: { ...where, status: "active" }, include: structureListInclude, orderBy: { publishedAt: "desc" } });
}

function effectiveResult(structure: any, status: EffectiveCategoryStructureStatus, city: any, layers: any[]) {
  return { status, statusLabel: effectiveStatusLabel(status), structure, layers, city };
}

function effectiveStatusLabel(status: EffectiveCategoryStructureStatus) {
  if (status === "local_ready") return "Готово";
  if (status === "uses_region_fallback") return "Требуется локальная структура";
  if (status === "uses_federal_fallback") return "Требуется структура региона и города";
  return "Справочник не настроен";
}

function cityFallbackMessage(city: any, effective: any) {
  if (effective.status === "local_ready") return `Для города ${city.name} опубликована локальная структура.`;
  if (effective.status === "uses_region_fallback") return `Для города ${city.name} сейчас применяется общая структура региона: ${city.region} ${effective.structure.versionNumber}. Рекомендуется создать локальную структуру города, чтобы уточнить категории, рекомендуемые цены, ограничения и подсказки.`;
  if (effective.status === "uses_federal_fallback") return `Для региона ${city.region} ещё нет опубликованной структуры. Система может подготовить шаблон на основе базовой структуры РФ.`;
  return "Справочник категорий не настроен.";
}

async function resolveTargetScope(input: { scopeType: "region" | "city"; regionId?: string; regionSlug?: string; cityId?: string; citySlug?: string }, allowFederal = false) {
  if (allowFederal && (input.scopeType as string) === "federal") return { regionId: null, cityId: null, scopeKey: "federal", defaultTitle: "Базовая структура РФ" };
  if (input.scopeType === "region") {
    const region = input.regionId ? await prisma.region.findUnique({ where: { id: input.regionId } }) : input.regionSlug ? await prisma.region.findUnique({ where: { slug: input.regionSlug } }) : null;
    if (!region) throw new HttpError(400, "Выберите регион", "region_required");
    return { regionId: region.id, cityId: null, scopeKey: `region:${region.id}`, defaultTitle: `Структура региона ${region.name}` };
  }
  const city = input.cityId ? await prisma.city.findUnique({ where: { id: input.cityId }, include: { regionRecord: true } }) : input.citySlug ? await prisma.city.findUnique({ where: { slug: input.citySlug }, include: { regionRecord: true } }) : null;
  if (!city) throw new HttpError(400, "Выберите город", "city_required");
  return { regionId: city.regionId, cityId: city.id, scopeKey: `city:${city.id}`, defaultTitle: `Структура города ${city.name}` };
}

async function resolveParentStructure(regionId?: string | null, cityId?: string | null) {
  if (cityId && regionId) {
    const regional = await findActiveStructure({ scopeType: "region", scopeRegionId: regionId });
    if (regional) return regional;
  }
  return findActiveStructure({ scopeKey: "federal" });
}

async function nextAvailableVersion(scopeKey: string, fromVersion?: string) {
  const rows = await prisma.categoryStructure.findMany({ where: { scopeKey }, select: { versionNumber: true } });
  const versions = new Set(rows.map((row) => row.versionNumber));
  if (!fromVersion && rows.length === 0) return "1.0";
  const base = fromVersion ?? rows.map((row) => row.versionNumber.split(".").map((value) => Number(value) || 0) as [number, number])
    .sort((left, right) => right[0] - left[0] || right[1] - left[1])[0]
    .join(".");
  let [major, minor] = base.split(".").map((value) => Number(value) || 0);
  do {
    minor += 1;
  } while (versions.has(`${major}.${minor}`));
  return `${major}.${minor}`;
}

async function cloneStructureTx(tx: Prisma.TransactionClient, sourceId: string, target: { scopeType: CategoryScopeType; regionId?: string | null; cityId?: string | null; scopeKey: string; versionNumber: string; title: string; comment?: string; source: string; createdByAdminId: string }) {
  const source = await tx.categoryStructure.findUnique({ where: { id: sourceId }, include: structureDetailInclude });
  if (!source) throw new HttpError(404, "Родительская структура не найдена", "category_parent_missing");
  const structure = await tx.categoryStructure.create({ data: {
    scopeType: target.scopeType,
    scopeRegionId: target.regionId,
    scopeCityId: target.cityId,
    scopeKey: target.scopeKey,
    parentStructureId: source.id,
    versionNumber: target.versionNumber,
    title: target.title,
    description: source.description,
    status: "draft",
    qualityStatus: "draft",
    source: target.source,
    createdByAdminId: target.createdByAdminId,
    comment: target.comment
  } });
  const categoryIdMap = new Map<string, string>();
  for (const category of [...source.categories].sort((a, b) => a.level - b.level || a.sortOrder - b.sortOrder)) {
    const created = await tx.category.create({ data: {
      structureId: structure.id,
      parentId: category.parentId ? categoryIdMap.get(category.parentId) : null,
      slug: category.slug,
      title: category.title,
      shortTitle: category.shortTitle,
      descriptionForCustomer: category.descriptionForCustomer,
      descriptionForHelper: category.descriptionForHelper,
      descriptionForManager: category.descriptionForManager,
      descriptionForAdmin: category.descriptionForAdmin,
      icon: category.icon,
      level: category.level,
      sortOrder: category.sortOrder,
      status: category.status,
      isVisibleForCustomer: category.isVisibleForCustomer,
      isVisibleForHelper: category.isVisibleForHelper,
      isVisibleForManager: category.isVisibleForManager,
      isVisibleForAdmin: category.isVisibleForAdmin
    } });
    categoryIdMap.set(category.id, created.id);
    const taskIdMap = new Map<string, string>();
    for (const task of category.taskTemplates) {
      const clonedTask = await tx.categoryTaskTemplate.create({ data: {
        categoryId: created.id, slug: task.slug, title: task.title, description: task.description,
        customerHint: task.customerHint, helperHint: task.helperHint, managerHint: task.managerHint,
        safetyNote: task.safetyNote, taskKind: task.taskKind, aliasesJson: task.aliasesJson,
        durationEffectJson: task.durationEffectJson, priceEffectJson: task.priceEffectJson,
        requiresComment: task.requiresComment, allowedRegionsJson: task.allowedRegionsJson,
        formFieldsJson: task.formFieldsJson, recommendationsJson: task.recommendationsJson,
        constraintsJson: task.constraintsJson, sortOrder: task.sortOrder, isActive: task.isActive
      } });
      taskIdMap.set(task.id, clonedTask.id);
    }
    for (const rule of category.safetyRules) await tx.categorySafetyRule.create({ data: { categoryId: created.id, ruleKey: rule.ruleKey, title: rule.title, description: rule.description, severity: rule.severity, isBlocking: rule.isBlocking, applicabilityJson: rule.applicabilityJson, isActive: rule.isActive, showToCustomer: rule.showToCustomer, showToHelper: rule.showToHelper, showToManager: rule.showToManager, sortOrder: rule.sortOrder } });
    for (const price of category.pricingRules) await tx.categoryPricingRule.create({ data: { categoryId: created.id, taskTemplateId: price.taskTemplateId ? taskIdMap.get(price.taskTemplateId) : null, recommendedPackageCode: price.recommendedPackageCode, recommendedMinPrice: price.recommendedMinPrice, recommendedMaxPrice: price.recommendedMaxPrice, defaultDurationMinutes: price.defaultDurationMinutes, priceComment: price.priceComment, coveredTaskSlugsJson: price.coveredTaskSlugsJson, isActive: price.isActive } });
  }
  return structure;
}

async function populateStructureFromImportTx(tx: Prisma.TransactionClient, structureId: string, payload: CategoryImportPayload) {
  const bySlug = new Map<string, string>();
  const taskByKey = new Map<string, string>();
  const pending = [...payload.categories];
  while (pending.length) {
    const index = pending.findIndex((item) => !item.parentSlug || bySlug.has(item.parentSlug));
    if (index < 0) throw new HttpError(400, "Не удалось построить дерево категорий", "category_tree_invalid");
    const [row] = pending.splice(index, 1);
    const created = await tx.category.create({ data: {
      structureId,
      parentId: row.parentSlug ? bySlug.get(row.parentSlug) : null,
      slug: row.slug,
      title: row.title,
      shortTitle: row.shortTitle,
      descriptionForCustomer: row.descriptionForCustomer,
      descriptionForHelper: row.descriptionForHelper,
      descriptionForManager: row.descriptionForManager,
      descriptionForAdmin: row.descriptionForAdmin,
      icon: row.icon,
      level: row.parentSlug ? 1 : 0,
      sortOrder: row.sortOrder ?? 100,
      status: row.status ?? "active",
      isVisibleForCustomer: row.visibleForCustomer ?? true,
      isVisibleForHelper: row.visibleForHelper ?? true,
      isVisibleForManager: row.visibleForManager ?? true,
      isVisibleForAdmin: row.visibleForAdmin ?? true
    } });
    bySlug.set(row.slug, created.id);
  }
  for (const row of payload.taskTemplates ?? []) {
    const task = await tx.categoryTaskTemplate.create({ data: {
      categoryId: bySlug.get(row.categorySlug)!, slug: row.taskSlug, title: row.title,
      description: row.description ?? row.shortDescription, customerHint: row.customerHint,
      helperHint: row.helperHint, managerHint: row.managerHint, safetyNote: row.safetyNote,
      taskKind: row.taskKind ?? "standard", aliasesJson: JSON.stringify(row.aliases ?? []),
      durationEffectJson: JSON.stringify(row.durationEffect ?? {}), priceEffectJson: JSON.stringify(row.priceEffect ?? {}),
      requiresComment: row.requiresComment ?? false, allowedRegionsJson: JSON.stringify(row.allowedRegions ?? []),
      formFieldsJson: JSON.stringify(row.formFields ?? []), recommendationsJson: JSON.stringify(row.recommendations ?? []),
      constraintsJson: JSON.stringify(row.constraints ?? {}), sortOrder: row.sortOrder ?? 100, isActive: row.active ?? true
    } });
    taskByKey.set(`${row.categorySlug}:${row.taskSlug}`, task.id);
  }
  for (const row of payload.safetyRules ?? []) await tx.categorySafetyRule.create({ data: { categoryId: bySlug.get(row.categorySlug)!, ruleKey: row.ruleKey || slugify(row.title), title: row.title, description: row.description, severity: row.severity ?? "warning", isBlocking: row.isBlocking ?? false, applicabilityJson: JSON.stringify(row.applicability ?? {}), isActive: row.active ?? true, showToCustomer: row.showToCustomer ?? true, showToHelper: row.showToHelper ?? true, showToManager: row.showToManager ?? true, sortOrder: row.sortOrder ?? 100 } });
  for (const row of payload.pricingRules ?? []) await tx.categoryPricingRule.create({ data: { categoryId: bySlug.get(row.categorySlug)!, taskTemplateId: row.taskSlug ? taskByKey.get(`${row.categorySlug}:${row.taskSlug}`) : null, recommendedPackageCode: row.packageCode, recommendedMinPrice: row.recommendedMinPrice, recommendedMaxPrice: row.recommendedMaxPrice, defaultDurationMinutes: row.defaultDurationMinutes, priceComment: row.priceComment, coveredTaskSlugsJson: JSON.stringify(row.coveredTaskSlugs ?? []), isActive: row.active ?? true } });
}

function exportBundle(structure: any, options: { targetCity?: any; targetRegion?: any; warning?: string; generatedBy: string }) {
  const payload = structureToImportPayload(structure, options);
  const targetRegion = options.targetRegion ?? options.targetCity?.regionRecord ?? structure.scopeRegion;
  const targetCity = options.targetCity ?? structure.scopeCity;
  const baseName = targetCity
    ? `zabota_categories_${slugify(targetCity.region)}_${targetCity.slug}${
        structure.scopeCityId === targetCity.id
          ? `_v${structure.versionNumber}`
          : structure.scopeType === "region"
            ? `_from_region_v${structure.versionNumber}`
            : "_from_federal_template"
      }`
    : targetRegion
      ? `zabota_categories_${targetRegion.slug}${options.targetRegion && structure.scopeRegionId !== targetRegion.id ? "_from_federal_template" : `_v${structure.versionNumber}`}`
      : `zabota_categories_federal_v${structure.versionNumber}`;
  return {
    fileName: `${baseName}.xlsx`,
    jsonFileName: `${baseName}.json`,
    payload,
    sheets: exportSheets(payload, structure, options)
  };
}

function structureToImportPayload(structure: any, options: { targetCity?: any; targetRegion?: any; warning?: string }) : CategoryImportPayload {
  const categoryById = new Map(structure.categories.map((category: any) => [category.id, category]));
  return {
    version: "1",
    scope: { type: options.targetCity ? "city" : options.targetRegion ? "region" : structure.scopeType, regionId: options.targetRegion?.id ?? options.targetCity?.regionId ?? structure.scopeRegionId, cityId: options.targetCity?.id ?? structure.scopeCityId },
    passport: { title: options.targetCity ? `Структура города ${options.targetCity.name}` : options.targetRegion ? `Структура региона ${options.targetRegion.name}` : structure.title, description: structure.description, versionNumber: nextTemplateVersion(structure.versionNumber), qualityStatus: "draft", parentStructureId: structure.id, comment: options.warning },
    categories: structure.categories.map((category: any) => ({ slug: category.slug, parentSlug: category.parentId ? (categoryById.get(category.parentId) as any)?.slug : null, title: category.title, shortTitle: category.shortTitle, descriptionForCustomer: category.descriptionForCustomer, descriptionForHelper: category.descriptionForHelper, descriptionForManager: category.descriptionForManager, descriptionForAdmin: category.descriptionForAdmin, icon: category.icon, sortOrder: category.sortOrder, status: category.status, visibleForCustomer: category.isVisibleForCustomer, visibleForHelper: category.isVisibleForHelper, visibleForManager: category.isVisibleForManager, visibleForAdmin: category.isVisibleForAdmin })),
    taskTemplates: structure.categories.flatMap((category: any) => category.taskTemplates.map((task: any) => ({ categorySlug: category.slug, taskSlug: task.slug, title: task.title, description: task.description, customerHint: task.customerHint, helperHint: task.helperHint, managerHint: task.managerHint, safetyNote: task.safetyNote, taskKind: task.taskKind, aliases: safeJson(task.aliasesJson) ?? [], durationEffect: safeJson(task.durationEffectJson) ?? {}, priceEffect: safeJson(task.priceEffectJson) ?? {}, requiresComment: task.requiresComment, allowedRegions: safeJson(task.allowedRegionsJson) ?? [], formFields: safeJson(task.formFieldsJson) ?? [], recommendations: safeJson(task.recommendationsJson) ?? [], constraints: safeJson(task.constraintsJson) ?? {}, sortOrder: task.sortOrder, active: task.isActive }))),
    safetyRules: structure.categories.flatMap((category: any) => category.safetyRules.map((rule: any) => ({ categorySlug: category.slug, ruleKey: rule.ruleKey || slugify(rule.title), title: rule.title, description: rule.description, severity: rule.severity, isBlocking: rule.isBlocking, applicability: safeJson(rule.applicabilityJson) ?? {}, active: rule.isActive, showToCustomer: rule.showToCustomer, showToHelper: rule.showToHelper, showToManager: rule.showToManager, sortOrder: rule.sortOrder }))),
    pricingRules: structure.categories.flatMap((category: any) => category.pricingRules.map((price: any) => ({ categorySlug: category.slug, taskSlug: price.taskTemplate?.slug ?? category.taskTemplates.find((task: any) => task.id === price.taskTemplateId)?.slug ?? null, packageCode: price.recommendedPackageCode, coveredTaskSlugs: safeJson(price.coveredTaskSlugsJson) ?? [], recommendedMinPrice: price.recommendedMinPrice, recommendedMaxPrice: price.recommendedMaxPrice, defaultDurationMinutes: price.defaultDurationMinutes, priceComment: price.priceComment, active: price.isActive })))
  };
}

function exportSheets(payload: CategoryImportPayload, structure: any, options: any) {
  const passportRows = Object.entries({ scopeType: payload.scope.type, regionId: payload.scope.regionId ?? "", cityId: payload.scope.cityId ?? "", region: options.targetRegion?.name ?? options.targetCity?.region ?? structure.scopeRegion?.name ?? "", city: options.targetCity?.name ?? structure.scopeCity?.name ?? "", title: payload.passport?.title ?? structure.title, parentStructureId: payload.passport?.parentStructureId ?? structure.id, baseScopeType: structure.scopeType, baseRegion: structure.scopeRegion?.name ?? "", baseCity: structure.scopeCity?.name ?? "", baseVersion: structure.versionNumber, targetVersion: payload.passport?.versionNumber, status: "draft", qualityStatus: "draft", generatedAt: new Date().toISOString(), generatedBy: options.generatedBy, warning: options.warning ?? "" });
  return [
    { name: "Паспорт структуры", rows: [["Поле", "Значение"], ...passportRows] },
    { name: "Категории", rows: [["slug", "parentSlug", "title", "shortTitle", "descriptionForCustomer", "descriptionForHelper", "descriptionForManager", "descriptionForAdmin", "icon", "sortOrder", "status", "visibleForCustomer", "visibleForHelper", "visibleForManager", "visibleForAdmin"], ...payload.categories.map((row) => [row.slug, row.parentSlug ?? "", row.title, row.shortTitle ?? "", row.descriptionForCustomer ?? "", row.descriptionForHelper ?? "", row.descriptionForManager ?? "", row.descriptionForAdmin ?? "", row.icon ?? "", row.sortOrder ?? 100, row.status ?? "active", row.visibleForCustomer ?? true, row.visibleForHelper ?? true, row.visibleForManager ?? true, row.visibleForAdmin ?? true])] },
    { name: "Типовые задачи", rows: [["categorySlug", "taskSlug", "title", "description", "customerHint", "helperHint", "managerHint", "safetyNote", "taskKind", "aliases", "durationEffect", "priceEffect", "requiresComment", "allowedRegions", "formFields", "recommendations", "constraints", "sortOrder", "active"], ...(payload.taskTemplates ?? []).map((row) => [row.categorySlug, row.taskSlug, row.title, row.description ?? "", row.customerHint ?? "", row.helperHint ?? "", row.managerHint ?? "", row.safetyNote ?? "", row.taskKind ?? "standard", JSON.stringify(row.aliases ?? []), JSON.stringify(row.durationEffect ?? {}), JSON.stringify(row.priceEffect ?? {}), row.requiresComment ?? false, JSON.stringify(row.allowedRegions ?? []), JSON.stringify(row.formFields ?? []), JSON.stringify(row.recommendations ?? []), JSON.stringify(row.constraints ?? {}), row.sortOrder ?? 100, row.active ?? true])] },
    { name: "Ограничения", rows: [["categorySlug", "ruleKey", "title", "description", "severity", "isBlocking", "applicability", "active", "showToCustomer", "showToHelper", "showToManager", "sortOrder"], ...(payload.safetyRules ?? []).map((row) => [row.categorySlug, row.ruleKey, row.title, row.description, row.severity ?? "warning", row.isBlocking ?? false, JSON.stringify(row.applicability ?? {}), row.active ?? true, row.showToCustomer ?? true, row.showToHelper ?? true, row.showToManager ?? true, row.sortOrder ?? 100])] },
    { name: "Рекомендуемые цены", rows: [["categorySlug", "taskSlug", "packageCode", "coveredTaskSlugs", "recommendedMinPrice", "recommendedMaxPrice", "defaultDurationMinutes", "priceComment", "active"], ...(payload.pricingRules ?? []).map((row) => [row.categorySlug, row.taskSlug ?? "", row.packageCode ?? "", JSON.stringify(row.coveredTaskSlugs ?? []), row.recommendedMinPrice ?? "", row.recommendedMaxPrice ?? "", row.defaultDurationMinutes ?? "", row.priceComment ?? "", row.active ?? true])] },
    { name: "Инструкция", rows: [["Импорт создаёт новую черновую версию и не перезаписывает опубликованную структуру."], ["Цены являются рекомендуемым ориентиром; итоговая сумма согласуется в чате."], ["Медицинские процедуры, ремонтные, технические и опасные работы запрещены."], ["Не используйте запрещённые термины в пользовательских текстах."]] }
  ];
}

function publicStructurePassport(structure: any) {
  return { id: structure.id, scopeType: structure.scopeType, versionNumber: structure.versionNumber, title: structure.title, qualityStatus: structure.qualityStatus };
}

async function resolveStructuredSelection(client: DbClient, structureIds: string[], input: { categoryId: string; subcategoryId?: string | null; taskTemplateId?: string | null }) {
  const category = await client.category.findFirst({
    where: { id: input.categoryId, structureId: { in: structureIds }, parentId: null, status: "active", isVisibleForCustomer: true },
    include: { pricingRules: { where: { isActive: true }, include: { taskTemplate: true } }, safetyRules: { where: { showToCustomer: true }, orderBy: { sortOrder: "asc" } } }
  });
  if (!category) throw new HttpError(400, "Выбрана недоступная категория", "request_category_invalid");
  const subcategory = input.subcategoryId
    ? await client.category.findFirst({
        where: { id: input.subcategoryId, structureId: { in: structureIds }, parentId: category.id, status: "active", isVisibleForCustomer: true },
        include: { pricingRules: { where: { isActive: true }, include: { taskTemplate: true } }, safetyRules: { where: { showToCustomer: true }, orderBy: { sortOrder: "asc" } } }
      })
    : null;
  if (input.subcategoryId && !subcategory) throw new HttpError(400, "Подкатегория не относится к выбранной категории", "request_subcategory_mismatch");
  const taskCategoryId = subcategory?.id ?? category.id;
  const taskTemplate = input.taskTemplateId
    ? await client.categoryTaskTemplate.findFirst({ where: { id: input.taskTemplateId, categoryId: taskCategoryId, isActive: true } })
    : null;
  if (input.taskTemplateId && !taskTemplate) throw new HttpError(400, "Шаблон задачи не относится к выбранной категории", "request_task_template_mismatch");
  const pricing = selectStructuredPricingRule(category.pricingRules, subcategory?.pricingRules ?? [], taskTemplate);
  return { category, subcategory, taskTemplate, pricing, safetyRules: [...category.safetyRules, ...(subcategory?.safetyRules ?? [])] };
}

function selectStructuredPricingRule(categoryRules: any[], subcategoryRules: any[], taskTemplate: any | null) {
  const candidates = [
    ...subcategoryRules.map((rule) => ({ rule, specificity: pricingRuleMatchesTemplate(rule, taskTemplate) ? 3 : 2 })),
    ...categoryRules.map((rule) => ({ rule, specificity: pricingRuleMatchesTemplate(rule, taskTemplate) ? 3 : 1 }))
  ].filter((candidate) => pricingRuleMatchesTemplate(candidate.rule, taskTemplate) || (!candidate.rule.taskTemplateId && !candidate.rule.taskTemplate));
  return candidates.sort((left, right) => {
    if (left.specificity !== right.specificity) return right.specificity - left.specificity;
    const leftPackage = left.rule.recommendedPackageCode ? 1 : 0;
    const rightPackage = right.rule.recommendedPackageCode ? 1 : 0;
    if (leftPackage !== rightPackage) return rightPackage - leftPackage;
    const leftMax = left.rule.recommendedMaxPrice ?? left.rule.recommendedMinPrice ?? -1;
    const rightMax = right.rule.recommendedMaxPrice ?? right.rule.recommendedMinPrice ?? -1;
    if (leftMax !== rightMax) return rightMax - leftMax;
    const leftMin = left.rule.recommendedMinPrice ?? -1;
    const rightMin = right.rule.recommendedMinPrice ?? -1;
    if (leftMin !== rightMin) return rightMin - leftMin;
    return `${left.rule.taskTemplate?.slug ?? ""}:${left.rule.id}`.localeCompare(`${right.rule.taskTemplate?.slug ?? ""}:${right.rule.id}`);
  })[0]?.rule ?? null;
}

function pricingRuleMatchesTemplate(rule: any, taskTemplate: any | null) {
  return Boolean(taskTemplate && (rule.taskTemplateId === taskTemplate.id || rule.taskTemplate?.slug === taskTemplate.slug));
}

function calculationLine(kind: "main" | "additional", selection: Awaited<ReturnType<typeof resolveStructuredSelection>>, amount: number | null) {
  return {
    kind,
    categoryId: selection.category.id,
    categoryTitle: selection.category.title,
    subcategoryId: selection.subcategory?.id ?? null,
    subcategoryTitle: selection.subcategory?.title ?? null,
    taskTemplateId: selection.taskTemplate?.id ?? null,
    taskTemplateTitle: selection.taskTemplate?.title ?? null,
    baseRecommendedMinPrice: selection.pricing?.recommendedMinPrice ?? null,
    baseRecommendedMaxPrice: selection.pricing?.recommendedMaxPrice ?? null,
    calculatedRecommendedPrice: amount,
    pricingComment: selection.pricing?.priceComment ?? null
  };
}

function categoryIdentity(category: { id: string; slug: string; title: string }) {
  return { id: category.id, slug: category.slug, title: category.title };
}

function taskIdentity(task: { id: string; slug: string; title: string }) {
  return { id: task.id, slug: task.slug, title: task.title };
}

function safetyWarnings(text?: string | null) {
  const normalized = (text ?? "").toLocaleLowerCase("ru-RU");
  return medicalProcedureTerms.some((term) => normalized.includes(term)) ? [MEDICAL_PROCEDURE_WARNING] : [];
}

function calculationSourceMessage(status: EffectiveCategoryStructureStatus, city: any, structure: ReturnType<typeof publicStructurePassport>) {
  if (status === "local_ready") return `База расчёта: ${city.name} v${structure.versionNumber}.`;
  if (status === "uses_region_fallback") return `База расчёта: ${city.region} v${structure.versionNumber}. Для ${city.name} локальная структура пока не создана.`;
  return `База расчёта: базовая структура РФ v${structure.versionNumber}. Локальные ориентиры для города пока не заданы.`;
}

function publicCategory(category: any, audience: "customer" | "helper") {
  const descriptionField = audience === "customer" ? "descriptionForCustomer" : "descriptionForHelper";
  const hintField = audience === "customer" ? "customerHint" : "helperHint";
  return {
    id: category.id,
    structureId: category.structureId,
    parentId: category.parentId,
    slug: category.slug,
    title: category.title,
    shortTitle: category.shortTitle,
    [descriptionField]: category[descriptionField],
    icon: category.icon,
    level: category.level,
    sortOrder: category.sortOrder,
    status: category.status,
    children: (category.children ?? []).map((child: any) => ({
      id: child.id,
      structureId: child.structureId,
      parentId: child.parentId,
      slug: child.slug,
      title: child.title,
      shortTitle: child.shortTitle,
      [descriptionField]: child[descriptionField],
      icon: child.icon,
      level: child.level,
      sortOrder: child.sortOrder,
      status: child.status,
      taskTemplates: (child.taskTemplates ?? []).map((task: any) => ({
        id: task.id,
        slug: task.slug,
        title: task.title,
        description: task.description,
        [hintField]: task[hintField],
        safetyNote: task.safetyNote,
        sortOrder: task.sortOrder
      })),
      safetyRules: (child.safetyRules ?? []).map((rule: any) => ({
        id: rule.id,
        ruleKey: rule.ruleKey,
        title: rule.title,
        description: rule.description,
        severity: rule.severity,
        isBlocking: rule.isBlocking,
        applicability: safeJson(rule.applicabilityJson) ?? {},
        isActive: rule.isActive,
        sortOrder: rule.sortOrder
      })),
      pricingRules: (child.pricingRules ?? []).map((price: any) => ({
        id: price.id,
        recommendedPackageCode: price.recommendedPackageCode,
        recommendedMinPrice: price.recommendedMinPrice,
        recommendedMaxPrice: price.recommendedMaxPrice,
        defaultDurationMinutes: price.defaultDurationMinutes,
        priceComment: price.priceComment
      }))
    })),
    taskTemplates: (category.taskTemplates ?? []).map((task: any) => ({
      id: task.id,
      slug: task.slug,
      title: task.title,
      description: task.description,
      [hintField]: task[hintField],
      safetyNote: task.safetyNote,
      sortOrder: task.sortOrder
    })),
    safetyRules: (category.safetyRules ?? []).map((rule: any) => ({
      id: rule.id,
      ruleKey: rule.ruleKey,
      title: rule.title,
      description: rule.description,
      severity: rule.severity,
      isBlocking: rule.isBlocking,
      applicability: safeJson(rule.applicabilityJson) ?? {},
      isActive: rule.isActive,
      sortOrder: rule.sortOrder
    })),
    pricingRules: (category.pricingRules ?? []).map((price: any) => ({
      id: price.id,
      recommendedPackageCode: price.recommendedPackageCode,
      recommendedMinPrice: price.recommendedMinPrice,
      recommendedMaxPrice: price.recommendedMaxPrice,
      defaultDurationMinutes: price.defaultDurationMinutes,
      priceComment: price.priceComment
    }))
  };
}

function publicHelperCategoryPreference(preference: any) {
  return {
    id: preference.id,
    helperUserId: preference.helperUserId,
    cityId: preference.cityId,
    categoryId: preference.categoryId,
    categorySlug: preference.categorySlug,
    isEnabled: preference.isEnabled,
    comment: preference.comment,
    createdAt: preference.createdAt.toISOString(),
    updatedAt: preference.updatedAt.toISOString(),
    category: publicCategory(preference.category, "helper"),
    city: preference.city
      ? { id: preference.city.id, name: preference.city.name, slug: preference.city.slug, region: preference.city.region }
      : null
  };
}

function nextTemplateVersion(version: string) {
  const [major, minor] = version.split(".").map((value) => Number(value) || 0);
  return `${major || 1}.${minor + 1}`;
}

function slugify(value: string) {
  const map: Record<string, string> = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" };
  return value.toLocaleLowerCase("ru-RU").split("").map((char) => map[char] ?? char).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "category";
}

function safeJson(value: string) {
  try { return JSON.parse(value); } catch { return null; }
}

function jsonArray(value: string | null | undefined): string[] {
  const parsed = value ? safeJson(value) : [];
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

const structureListInclude = {
  scopeRegion: true,
  scopeCity: { include: { regionRecord: true } },
  parentStructure: { select: { id: true, title: true, versionNumber: true, scopeType: true } },
  _count: { select: { categories: true, requestSnapshots: true } }
} satisfies Prisma.CategoryStructureInclude;

const structureDetailInclude = {
  ...structureListInclude,
  categories: {
    orderBy: [{ level: "asc" as const }, { sortOrder: "asc" as const }],
    include: {
      taskTemplates: { orderBy: { sortOrder: "asc" as const } },
      safetyRules: { orderBy: { sortOrder: "asc" as const } },
      pricingRules: { orderBy: { createdAt: "asc" as const }, include: { taskTemplate: true } }
    }
  }
} satisfies Prisma.CategoryStructureInclude;
