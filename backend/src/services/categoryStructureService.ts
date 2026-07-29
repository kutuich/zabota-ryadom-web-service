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

const forbiddenImportTerms = ["клиент", "исполнитель", "комиссия", "работник", "трудоустроим", "медицинские услуги"];
const repairCategoryTerms = ["электрик", "электрика", "сантехник", "сантехника", "газ", "ремонт", "бытовая техника", "строительные работы"];

const federalCategories = [
  ["home-help", "Помощь по дому", 700, 1100, ["Лёгкая уборка", "Мытьё посуды", "Вынос мусора", "Полив растений", "Помощь с вещами", "Простая подготовка еды"]],
  ["shopping-delivery", "Покупки и доставка", 400, 700, ["Купить продукты", "Купить товары для дома", "Купить в аптеке по готовому списку", "Получить заказ", "Доставить вещи"]],
  ["accompaniment", "Сопровождение", 800, 1500, ["В поликлинику без медицинских процедур", "В магазин", "В МФЦ, банк или организацию", "На прогулку", "До транспорта или такси", "Встреча или проводы"]],
  ["supervision", "Присмотр без медицинских процедур", 700, 1200, ["Побыть рядом 1–2 часа", "Побыть рядом 3–4 часа", "Присмотр во время отсутствия родственников", "Прогулка и присмотр", "Бытовая поддержка рядом"]],
  ["documents-household", "Помощь с документами и организацией быта", null, null, ["Записаться на приём", "Распечатать или отсканировать документы", "Помочь разобраться с квитанцией", "Сопроводить в организацию", "Помочь заполнить простую форму"]],
  ["regular-help", "Регулярная помощь", 700, null, ["Регулярные покупки", "Регулярная помощь по дому", "Регулярное сопровождение", "Регулярный присмотр без медицинских процедур"]],
  ["urgent-help", "Срочная помощь", null, null, ["Срочные покупки", "Срочное сопровождение", "Срочная бытовая помощь", "Срочно забрать или передать вещь"]],
  ["other", "Другое", null, null, ["Задача по описанию Заказчика"]]
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
  scope: { type: CategoryScopeType; regionId?: string | null; cityId?: string | null };
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
  taskTemplates?: Array<{ categorySlug: string; taskSlug: string; title: string; description?: string | null; customerHint?: string | null; helperHint?: string | null; managerHint?: string | null; safetyNote?: string | null; sortOrder?: number; active?: boolean }>;
  safetyRules?: Array<{ categorySlug: string; title: string; description: string; severity?: string; isBlocking?: boolean; showToCustomer?: boolean; showToHelper?: boolean; showToManager?: boolean; sortOrder?: number }>;
  pricingRules?: Array<{ categorySlug: string; packageCode?: string | null; recommendedMinPrice?: number | null; recommendedMaxPrice?: number | null; defaultDurationMinutes?: number | null; priceComment?: string | null; active?: boolean }>;
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
        await client.categorySafetyRule.create({ data: { categoryId: root.id, title: ruleTitle, description, severity, isBlocking, sortOrder: (index + 1) * 10 } });
      }
    }

    const priceComment = rootSlug === "regular-help"
      ? "По согласованию, обычно от 700 ₽ за выход. Федеральный ориентир требует регионального уточнения."
      : rootSlug === "urgent-help"
        ? "Зависит от задачи; ориентир доплаты за срочность 200–500 ₽."
        : minPrice === null
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

  const local = await findActiveStructure({ scopeCityId: city.id }, client);
  if (local) return effectiveResult(local, "local_ready", city);

  if (city.regionId) {
    const regional = await findActiveStructure({ scopeRegionId: city.regionId, scopeType: "region" }, client);
    if (regional) return effectiveResult(regional, "uses_region_fallback", city);
  }

  const federal = await findActiveStructure({ scopeKey: "federal" }, client);
  if (federal) return effectiveResult(federal, "uses_federal_fallback", city);
  return { status: "missing_structure" as const, statusLabel: effectiveStatusLabel("missing_structure"), structure: null, city };
}

export async function listCategoryStructures() {
  return prisma.categoryStructure.findMany({
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
      data: { status: "active", publishedAt: new Date(), publishedByAdminId: adminId, archivedAt: null }
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
  if (payload.scope?.type === "region" && !payload.scope.regionId) errors.push("Для региональной структуры нужен regionId.");
  if (payload.scope?.type === "city" && !payload.scope.cityId) errors.push("Для городской структуры нужен cityId.");
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
  for (const row of payload.safetyRules ?? []) {
    if (row.severity && !["info", "warning", "forbidden"].includes(row.severity)) errors.push(`Некорректная важность ограничения для ${row.categorySlug}.`);
  }
  for (const row of payload.pricingRules ?? []) {
    const min = row.recommendedMinPrice;
    const max = row.recommendedMaxPrice;
    if ((min ?? 0) < 0 || (max ?? 0) < 0) errors.push(`Рекомендуемые цены для ${row.categorySlug} не могут быть отрицательными.`);
    if (min != null && max != null && min > max) errors.push(`Минимальная цена больше максимальной для ${row.categorySlug}.`);
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
  const scope = await resolveTargetScope({ scopeType: payload.scope.type as "region" | "city", regionId: payload.scope.regionId ?? undefined, cityId: payload.scope.cityId ?? undefined }, payload.scope.type === "federal");
  const versionNumber = payload.passport?.versionNumber || await nextAvailableVersion(scope.scopeKey);
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

export async function categoriesForCity(cityId: string, audience: "customer" | "helper") {
  const effective = await getEffectiveCategoryStructure(cityId);
  if (!effective.structure) return { ...effective, categories: [] };
  const visibilityField = audience === "customer" ? "isVisibleForCustomer" : "isVisibleForHelper";
  const categories = await prisma.category.findMany({
    where: { structureId: effective.structure.id, parentId: null, status: "active", [visibilityField]: true },
    include: {
      children: { where: { status: "active", [visibilityField]: true }, orderBy: { sortOrder: "asc" }, include: { taskTemplates: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } } },
      safetyRules: { where: audience === "customer" ? { showToCustomer: true } : { showToHelper: true }, orderBy: { sortOrder: "asc" } },
      pricingRules: { where: { isActive: true } }
    },
    orderBy: { sortOrder: "asc" }
  });
  return {
    status: effective.status,
    statusLabel: effective.statusLabel,
    structure: publicStructurePassport(effective.structure),
    categories: categories.map((category) => publicCategory(category, audience))
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

export async function createRequestCategorySnapshotTx(client: Prisma.TransactionClient, input: { requestId: string; cityId: string; categoryId?: string | null; subcategoryId?: string | null; taskTemplateId?: string | null }) {
  const effective = await getEffectiveCategoryStructure(input.cityId, client);
  if (!effective.structure) return null;
  const [category, subcategory, taskTemplate] = await Promise.all([
    input.categoryId ? client.category.findFirst({ where: { id: input.categoryId, structureId: effective.structure.id } }) : null,
    input.subcategoryId ? client.category.findFirst({ where: { id: input.subcategoryId, structureId: effective.structure.id } }) : null,
    input.taskTemplateId ? client.categoryTaskTemplate.findUnique({ where: { id: input.taskTemplateId }, include: { category: true } }) : null
  ]);
  if (input.categoryId && !category) throw new HttpError(400, "Выбрана недоступная категория", "request_category_invalid");
  if (input.subcategoryId && !subcategory) throw new HttpError(400, "Выбрана недоступная подкатегория", "request_subcategory_invalid");
  if (subcategory && category && subcategory.parentId !== category.id) {
    throw new HttpError(400, "Подкатегория не относится к выбранной категории", "request_subcategory_mismatch");
  }
  if (input.taskTemplateId && (!taskTemplate || taskTemplate.category.structureId !== effective.structure.id)) {
    throw new HttpError(400, "Выбран недоступный шаблон задачи", "request_task_template_invalid");
  }
  const expectedTaskCategoryId = subcategory?.id ?? category?.id;
  if (taskTemplate && expectedTaskCategoryId && taskTemplate.categoryId !== expectedTaskCategoryId) {
    throw new HttpError(400, "Шаблон задачи не относится к выбранной категории", "request_task_template_mismatch");
  }
  const selectedCategory = category ?? (subcategory?.parentId ? await client.category.findUnique({ where: { id: subcategory.parentId } }) : null);
  const pricing = selectedCategory ? await client.categoryPricingRule.findFirst({ where: { categoryId: selectedCategory.id, isActive: true } }) : null;
  const safetyRules = selectedCategory ? await client.categorySafetyRule.findMany({ where: { categoryId: selectedCategory.id, showToCustomer: true }, orderBy: { sortOrder: "asc" } }) : [];
  const city = effective.city;
  return client.requestCategorySnapshot.create({ data: {
    requestId: input.requestId,
    structureId: effective.structure.id,
    categoryId: selectedCategory?.id,
    subcategoryId: subcategory?.id,
    taskTemplateId: taskTemplate?.id,
    snapshotJson: JSON.stringify({
      structure: publicStructurePassport(effective.structure),
      effectiveStatus: effective.status,
      category: selectedCategory ? { id: selectedCategory.id, slug: selectedCategory.slug, title: selectedCategory.title } : null,
      subcategory: subcategory ? { id: subcategory.id, slug: subcategory.slug, title: subcategory.title } : null,
      taskTemplate: taskTemplate ? { id: taskTemplate.id, slug: taskTemplate.slug, title: taskTemplate.title } : null,
      recommendedPrice: pricing ? { min: pricing.recommendedMinPrice, max: pricing.recommendedMaxPrice, comment: pricing.priceComment } : null,
      safetyRules: safetyRules.map((rule) => ({ title: rule.title, description: rule.description, severity: rule.severity, isBlocking: rule.isBlocking })),
      city: { id: city.id, name: city.name, region: city.region },
      createdAt: new Date().toISOString()
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

function effectiveResult(structure: any, status: EffectiveCategoryStructureStatus, city: any) {
  return { status, statusLabel: effectiveStatusLabel(status), structure, city };
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

async function resolveTargetScope(input: { scopeType: "region" | "city"; regionId?: string; cityId?: string }, allowFederal = false) {
  if (allowFederal && (input.scopeType as string) === "federal") return { regionId: null, cityId: null, scopeKey: "federal", defaultTitle: "Базовая структура РФ" };
  if (input.scopeType === "region") {
    const region = input.regionId ? await prisma.region.findUnique({ where: { id: input.regionId } }) : null;
    if (!region) throw new HttpError(400, "Выберите регион", "region_required");
    return { regionId: region.id, cityId: null, scopeKey: `region:${region.id}`, defaultTitle: `Структура региона ${region.name}` };
  }
  const city = input.cityId ? await prisma.city.findUnique({ where: { id: input.cityId }, include: { regionRecord: true } }) : null;
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
  let [major, minor] = (fromVersion ?? "1.0").split(".").map((value) => Number(value) || 0);
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
    for (const task of category.taskTemplates) await tx.categoryTaskTemplate.create({ data: { categoryId: created.id, slug: task.slug, title: task.title, description: task.description, customerHint: task.customerHint, helperHint: task.helperHint, managerHint: task.managerHint, safetyNote: task.safetyNote, sortOrder: task.sortOrder, isActive: task.isActive } });
    for (const rule of category.safetyRules) await tx.categorySafetyRule.create({ data: { categoryId: created.id, title: rule.title, description: rule.description, severity: rule.severity, isBlocking: rule.isBlocking, showToCustomer: rule.showToCustomer, showToHelper: rule.showToHelper, showToManager: rule.showToManager, sortOrder: rule.sortOrder } });
    for (const price of category.pricingRules) await tx.categoryPricingRule.create({ data: { categoryId: created.id, recommendedPackageCode: price.recommendedPackageCode, recommendedMinPrice: price.recommendedMinPrice, recommendedMaxPrice: price.recommendedMaxPrice, defaultDurationMinutes: price.defaultDurationMinutes, priceComment: price.priceComment, isActive: price.isActive } });
  }
  return structure;
}

async function populateStructureFromImportTx(tx: Prisma.TransactionClient, structureId: string, payload: CategoryImportPayload) {
  const bySlug = new Map<string, string>();
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
  for (const row of payload.taskTemplates ?? []) await tx.categoryTaskTemplate.create({ data: { categoryId: bySlug.get(row.categorySlug)!, slug: row.taskSlug, title: row.title, description: row.description, customerHint: row.customerHint, helperHint: row.helperHint, managerHint: row.managerHint, safetyNote: row.safetyNote, sortOrder: row.sortOrder ?? 100, isActive: row.active ?? true } });
  for (const row of payload.safetyRules ?? []) await tx.categorySafetyRule.create({ data: { categoryId: bySlug.get(row.categorySlug)!, title: row.title, description: row.description, severity: row.severity ?? "warning", isBlocking: row.isBlocking ?? false, showToCustomer: row.showToCustomer ?? true, showToHelper: row.showToHelper ?? true, showToManager: row.showToManager ?? true, sortOrder: row.sortOrder ?? 100 } });
  for (const row of payload.pricingRules ?? []) await tx.categoryPricingRule.create({ data: { categoryId: bySlug.get(row.categorySlug)!, recommendedPackageCode: row.packageCode, recommendedMinPrice: row.recommendedMinPrice, recommendedMaxPrice: row.recommendedMaxPrice, defaultDurationMinutes: row.defaultDurationMinutes, priceComment: row.priceComment, isActive: row.active ?? true } });
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
    taskTemplates: structure.categories.flatMap((category: any) => category.taskTemplates.map((task: any) => ({ categorySlug: category.slug, taskSlug: task.slug, title: task.title, description: task.description, customerHint: task.customerHint, helperHint: task.helperHint, managerHint: task.managerHint, safetyNote: task.safetyNote, sortOrder: task.sortOrder, active: task.isActive }))),
    safetyRules: structure.categories.flatMap((category: any) => category.safetyRules.map((rule: any) => ({ categorySlug: category.slug, title: rule.title, description: rule.description, severity: rule.severity, isBlocking: rule.isBlocking, showToCustomer: rule.showToCustomer, showToHelper: rule.showToHelper, showToManager: rule.showToManager, sortOrder: rule.sortOrder }))),
    pricingRules: structure.categories.flatMap((category: any) => category.pricingRules.map((price: any) => ({ categorySlug: category.slug, packageCode: price.recommendedPackageCode, recommendedMinPrice: price.recommendedMinPrice, recommendedMaxPrice: price.recommendedMaxPrice, defaultDurationMinutes: price.defaultDurationMinutes, priceComment: price.priceComment, active: price.isActive })))
  };
}

function exportSheets(payload: CategoryImportPayload, structure: any, options: any) {
  const passportRows = Object.entries({ scopeType: payload.scope.type, regionId: payload.scope.regionId ?? "", cityId: payload.scope.cityId ?? "", region: options.targetRegion?.name ?? options.targetCity?.region ?? structure.scopeRegion?.name ?? "", city: options.targetCity?.name ?? structure.scopeCity?.name ?? "", title: payload.passport?.title ?? structure.title, parentStructureId: payload.passport?.parentStructureId ?? structure.id, baseScopeType: structure.scopeType, baseRegion: structure.scopeRegion?.name ?? "", baseCity: structure.scopeCity?.name ?? "", baseVersion: structure.versionNumber, targetVersion: payload.passport?.versionNumber, status: "draft", qualityStatus: "draft", generatedAt: new Date().toISOString(), generatedBy: options.generatedBy, warning: options.warning ?? "" });
  return [
    { name: "Паспорт структуры", rows: [["Поле", "Значение"], ...passportRows] },
    { name: "Категории", rows: [["slug", "parentSlug", "title", "shortTitle", "descriptionForCustomer", "descriptionForHelper", "descriptionForManager", "descriptionForAdmin", "icon", "sortOrder", "status", "visibleForCustomer", "visibleForHelper", "visibleForManager", "visibleForAdmin"], ...payload.categories.map((row) => [row.slug, row.parentSlug ?? "", row.title, row.shortTitle ?? "", row.descriptionForCustomer ?? "", row.descriptionForHelper ?? "", row.descriptionForManager ?? "", row.descriptionForAdmin ?? "", row.icon ?? "", row.sortOrder ?? 100, row.status ?? "active", row.visibleForCustomer ?? true, row.visibleForHelper ?? true, row.visibleForManager ?? true, row.visibleForAdmin ?? true])] },
    { name: "Типовые задачи", rows: [["categorySlug", "taskSlug", "title", "description", "customerHint", "helperHint", "managerHint", "safetyNote", "sortOrder", "active"], ...(payload.taskTemplates ?? []).map((row) => [row.categorySlug, row.taskSlug, row.title, row.description ?? "", row.customerHint ?? "", row.helperHint ?? "", row.managerHint ?? "", row.safetyNote ?? "", row.sortOrder ?? 100, row.active ?? true])] },
    { name: "Ограничения", rows: [["categorySlug", "title", "description", "severity", "isBlocking", "showToCustomer", "showToHelper", "showToManager", "sortOrder"], ...(payload.safetyRules ?? []).map((row) => [row.categorySlug, row.title, row.description, row.severity ?? "warning", row.isBlocking ?? false, row.showToCustomer ?? true, row.showToHelper ?? true, row.showToManager ?? true, row.sortOrder ?? 100])] },
    { name: "Рекомендуемые цены", rows: [["categorySlug", "packageCode", "recommendedMinPrice", "recommendedMaxPrice", "defaultDurationMinutes", "priceComment", "active"], ...(payload.pricingRules ?? []).map((row) => [row.categorySlug, row.packageCode ?? "", row.recommendedMinPrice ?? "", row.recommendedMaxPrice ?? "", row.defaultDurationMinutes ?? "", row.priceComment ?? "", row.active ?? true])] },
    { name: "Инструкция", rows: [["Импорт создаёт новую черновую версию и не перезаписывает опубликованную структуру."], ["Цены являются рекомендуемым ориентиром; итоговая сумма согласуется в чате."], ["Медицинские процедуры, ремонтные, технические и опасные работы запрещены."], ["Не используйте запрещённые термины в пользовательских текстах."]] }
  ];
}

function publicStructurePassport(structure: any) {
  return { id: structure.id, scopeType: structure.scopeType, versionNumber: structure.versionNumber, title: structure.title, qualityStatus: structure.qualityStatus };
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
      }))
    })),
    safetyRules: (category.safetyRules ?? []).map((rule: any) => ({
      id: rule.id,
      title: rule.title,
      description: rule.description,
      severity: rule.severity,
      isBlocking: rule.isBlocking,
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
      pricingRules: { orderBy: { createdAt: "asc" as const } }
    }
  }
} satisfies Prisma.CategoryStructureInclude;
