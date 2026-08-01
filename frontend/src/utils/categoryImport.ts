import type { WorkBook } from "xlsx";

type XlsxModule = typeof import("xlsx");

export async function readCategoryImportFile(file: File) {
  if (file.name.toLocaleLowerCase().endsWith(".json")) {
    return JSON.parse(await file.text()) as Record<string, unknown>;
  }
  if (!file.name.toLocaleLowerCase().endsWith(".xlsx")) {
    throw new Error("Разрешены только файлы JSON и XLSX.");
  }

  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const passportRows = rows(XLSX, workbook, "Паспорт структуры").slice(1);
  const passport = Object.fromEntries(passportRows.map((row) => [String(row[0] ?? ""), row[1]]));
  const categories = objects(XLSX, workbook, "Категории").map((row) => ({
    slug: text(row.slug), parentSlug: optionalText(row.parentSlug), title: text(row.title), shortTitle: optionalText(row.shortTitle),
    descriptionForCustomer: optionalText(row.descriptionForCustomer), descriptionForHelper: optionalText(row.descriptionForHelper),
    descriptionForManager: optionalText(row.descriptionForManager), descriptionForAdmin: optionalText(row.descriptionForAdmin), icon: optionalText(row.icon),
    sortOrder: integer(row.sortOrder, 100), status: optionalText(row.status) ?? "active",
    visibleForCustomer: bool(row.visibleForCustomer, true), visibleForHelper: bool(row.visibleForHelper, true),
    visibleForManager: bool(row.visibleForManager, true), visibleForAdmin: bool(row.visibleForAdmin, true)
  }));
  const taskTemplates = objects(XLSX, workbook, "Типовые задачи").map((row) => ({
    categorySlug: text(row.categorySlug), taskSlug: text(row.taskSlug), title: text(row.title), description: optionalText(row.description),
    customerHint: optionalText(row.customerHint), helperHint: optionalText(row.helperHint), managerHint: optionalText(row.managerHint),
    safetyNote: optionalText(row.safetyNote), taskKind: optionalText(row.taskKind) ?? "standard", aliases: json(row.aliases, []),
    durationEffect: json(row.durationEffect, {}), priceEffect: json(row.priceEffect, {}), requiresComment: bool(row.requiresComment, false),
    allowedRegions: json(row.allowedRegions, []), formFields: json(row.formFields, []), recommendations: json(row.recommendations, []),
    constraints: json(row.constraints, {}), sortOrder: integer(row.sortOrder, 100), active: bool(row.active, true)
  }));
  const safetyRules = objects(XLSX, workbook, "Ограничения").map((row) => ({
    categorySlug: text(row.categorySlug), ruleKey: text(row.ruleKey), title: text(row.title), description: text(row.description), severity: optionalText(row.severity) ?? "warning",
    isBlocking: bool(row.isBlocking, false), applicability: json(row.applicability, {}), active: bool(row.active, true), showToCustomer: bool(row.showToCustomer, true), showToHelper: bool(row.showToHelper, true),
    showToManager: bool(row.showToManager, true), sortOrder: integer(row.sortOrder, 100)
  }));
  const pricingRules = objects(XLSX, workbook, "Рекомендуемые цены").map((row) => ({
    categorySlug: text(row.categorySlug), taskSlug: optionalText(row.taskSlug), packageCode: optionalText(row.packageCode), coveredTaskSlugs: json(row.coveredTaskSlugs, []), recommendedMinPrice: optionalNumber(row.recommendedMinPrice),
    recommendedMaxPrice: optionalNumber(row.recommendedMaxPrice), defaultDurationMinutes: optionalNumber(row.defaultDurationMinutes),
    priceComment: optionalText(row.priceComment), active: bool(row.active, true)
  }));

  const scopeType = String(passport.scopeType || "").toLocaleLowerCase() as "federal" | "region" | "city";
  return {
    version: "1",
    scope: { type: scopeType, regionId: optionalText(passport.regionId), cityId: optionalText(passport.cityId) },
    passport: {
      title: optionalText(passport.title),
      versionNumber: optionalText(passport.targetVersion),
      qualityStatus: optionalText(passport.qualityStatus) ?? "draft",
      comment: optionalText(passport.warning),
      parentStructureId: optionalText(passport.parentStructureId)
    },
    categories,
    taskTemplates,
    safetyRules,
    pricingRules
  };
}

function rows(XLSX: XlsxModule, workbook: WorkBook, name: string) {
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`В файле нет листа «${name}».`);
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
}

function objects(XLSX: XlsxModule, workbook: WorkBook, name: string) {
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`В файле нет листа «${name}».`);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

function text(value: unknown) { return String(value ?? "").trim(); }
function optionalText(value: unknown) { const result = text(value); return result || null; }
function integer(value: unknown, fallback: number) { const result = Number(value); return Number.isInteger(result) ? result : fallback; }
function optionalNumber(value: unknown) { const result = text(value); return result === "" ? null : Number(result); }
function json<T>(value: unknown, fallback: T): T { const source = text(value); if (!source) return fallback; try { return JSON.parse(source) as T; } catch { return fallback; } }
function bool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  const normalized = text(value).toLocaleLowerCase();
  if (["true", "да", "1"].includes(normalized)) return true;
  if (["false", "нет", "0"].includes(normalized)) return false;
  return fallback;
}
