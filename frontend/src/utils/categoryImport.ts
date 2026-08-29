import type { Sheet, SheetData } from "read-excel-file/browser";

const XLSX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/octet-stream"
]);
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 256;
const MAX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 200;
const MAX_SHEETS = 12;
const MAX_ROWS_PER_SHEET = 5_000;
const MAX_COLUMNS_PER_SHEET = 64;
const MAX_CELLS_PER_SHEET = 100_000;
const MAX_TOTAL_CELLS = 250_000;
const textDecoder = new TextDecoder();

export async function readCategoryImportFile(file: File) {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error("Файл больше 5 МБ.");
  }
  if (file.name.toLocaleLowerCase().endsWith(".json")) {
    return JSON.parse(await file.text()) as Record<string, unknown>;
  }
  if (!file.name.toLocaleLowerCase().endsWith(".xlsx")) {
    throw new Error("Разрешены только файлы JSON и XLSX.");
  }

  if (file.type && !XLSX_MIME_TYPES.has(file.type.toLocaleLowerCase())) {
    throw new Error("Содержимое файла не соответствует формату XLSX.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  inspectXlsxArchive(bytes);
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const workbook = await readXlsxFile(file);
  inspectWorkbookBounds(workbook);

  const passportRows = rows(workbook, "Паспорт структуры").slice(1);
  const passport = Object.fromEntries(passportRows.map((row) => [String(row[0] ?? ""), row[1]]));
  const categories = objects(workbook, "Категории").map((row) => ({
    slug: text(row.slug), parentSlug: optionalText(row.parentSlug), title: text(row.title), shortTitle: optionalText(row.shortTitle),
    descriptionForCustomer: optionalText(row.descriptionForCustomer), descriptionForHelper: optionalText(row.descriptionForHelper),
    descriptionForManager: optionalText(row.descriptionForManager), descriptionForAdmin: optionalText(row.descriptionForAdmin), icon: optionalText(row.icon),
    sortOrder: integer(row.sortOrder, 100), status: optionalText(row.status) ?? "active",
    visibleForCustomer: bool(row.visibleForCustomer, true), visibleForHelper: bool(row.visibleForHelper, true),
    visibleForManager: bool(row.visibleForManager, true), visibleForAdmin: bool(row.visibleForAdmin, true)
  }));
  const taskTemplates = objects(workbook, "Типовые задачи").map((row) => ({
    categorySlug: text(row.categorySlug), taskSlug: text(row.taskSlug), title: text(row.title), description: optionalText(row.description),
    customerHint: optionalText(row.customerHint), helperHint: optionalText(row.helperHint), managerHint: optionalText(row.managerHint),
    safetyNote: optionalText(row.safetyNote), taskKind: optionalText(row.taskKind) ?? "standard", aliases: json(row.aliases, []),
    durationEffect: json(row.durationEffect, {}), priceEffect: json(row.priceEffect, {}), requiresComment: bool(row.requiresComment, false),
    allowedRegions: json(row.allowedRegions, []), formFields: json(row.formFields, []), recommendations: json(row.recommendations, []),
    constraints: json(row.constraints, {}), sortOrder: integer(row.sortOrder, 100), active: bool(row.active, true)
  }));
  const safetyRules = objects(workbook, "Ограничения").map((row) => ({
    categorySlug: text(row.categorySlug), ruleKey: text(row.ruleKey), title: text(row.title), description: text(row.description), severity: optionalText(row.severity) ?? "warning",
    isBlocking: bool(row.isBlocking, false), applicability: json(row.applicability, {}), active: bool(row.active, true), showToCustomer: bool(row.showToCustomer, true), showToHelper: bool(row.showToHelper, true),
    showToManager: bool(row.showToManager, true), sortOrder: integer(row.sortOrder, 100)
  }));
  const pricingRules = objects(workbook, "Рекомендуемые цены").map((row) => ({
    categorySlug: text(row.categorySlug), taskSlug: optionalText(row.taskSlug), packageCode: optionalText(row.packageCode), coveredTaskSlugs: json(row.coveredTaskSlugs, []), recommendedMinPrice: optionalNumber(row.recommendedMinPrice),
    recommendedMaxPrice: optionalNumber(row.recommendedMaxPrice), defaultDurationMinutes: optionalNumber(row.defaultDurationMinutes),
    priceComment: optionalText(row.priceComment), active: bool(row.active, true)
  }));
  const nodes = optionalObjects(workbook, "Узлы").map((row) => ({
    slug: text(row.slug), stableKey: optionalText(row.stableKey) ?? text(row.slug), parentSlug: optionalText(row.parentSlug), nodeType: optionalText(row.nodeType) ?? "task",
    title: text(row.title), descriptionForCustomer: optionalText(row.descriptionForCustomer), descriptionForHelper: optionalText(row.descriptionForHelper),
    sortOrder: integer(row.sortOrder, 100), selectable: bool(row.selectable, false), active: bool(row.active, true), visible: bool(row.visible, true),
    selectionMode: optionalText(row.selectionMode) ?? "multiple", aliases: json(row.aliases, []), formFields: json(row.formFields, []),
    constraints: json(row.constraints, {}), durationEffect: json(row.durationEffect, {}), metadata: json(row.metadata, {})
  }));
  const relations = optionalObjects(workbook, "Связи узлов").map((row) => ({
    sourceSlug: text(row.sourceSlug), targetSlug: text(row.targetSlug), relationType: text(row.relationType), active: bool(row.active, true),
    sortOrder: integer(row.sortOrder, 100), conditions: json(row.conditions, {}), pricingBehavior: optionalText(row.pricingBehavior), uiBehavior: optionalText(row.uiBehavior), metadata: json(row.metadata, {})
  }));
  const nodePricingRules = optionalObjects(workbook, "Цены узлов").map((row) => ({
    nodeSlug: text(row.nodeSlug), packageCode: optionalText(row.packageCode), coveredNodeSlugs: json(row.coveredNodeSlugs, []),
    recommendedMinPrice: optionalNumber(row.recommendedMinPrice), recommendedMaxPrice: optionalNumber(row.recommendedMaxPrice),
    defaultDurationMinutes: optionalNumber(row.defaultDurationMinutes), priceComment: optionalText(row.priceComment), conditions: json(row.conditions, {}), active: bool(row.active, true)
  }));
  const nodeSafetyRules = optionalObjects(workbook, "Ограничения узлов").map((row) => ({
    nodeSlug: optionalText(row.nodeSlug), ruleKey: text(row.ruleKey), title: text(row.title), description: text(row.description),
    severity: optionalText(row.severity) ?? "warning", isBlocking: bool(row.isBlocking, false), applicability: json(row.applicability, {}), active: bool(row.active, true), sortOrder: integer(row.sortOrder, 100)
  }));

  const scopeType = String(passport.scopeType || "").toLocaleLowerCase() as "federal" | "region" | "city";
  return {
    schemaVersion: nodes.length ? "3" : "2",
    version: nodes.length ? "2" : "1",
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
    pricingRules,
    ...(nodes.length ? { nodes, relations, nodePricingRules, nodeSafetyRules } : {})
  };
}

function rows(workbook: Sheet[], name: string) {
  const sheet = workbook.find((item) => item.sheet === name);
  if (!sheet) throw new Error(`В файле нет листа «${name}».`);
  return sheet.data.map((row) => row.map((value) => value ?? ""));
}

function objects(workbook: Sheet[], name: string) {
  return rowsToObjects(rows(workbook, name));
}

function optionalObjects(workbook: Sheet[], name: string) {
  const sheet = workbook.find((item) => item.sheet === name);
  return sheet ? rowsToObjects(sheet.data) : [];
}

function rowsToObjects(data: SheetData) {
  const [header = [], ...dataRows] = data;
  const keys = header.map((value) => String(value ?? ""));
  return dataRows
    .filter((row) => row.some((value) => value !== null && value !== ""))
    .map((row) => Object.fromEntries(keys.map((key, index) => [key, row[index] ?? ""])));
}

function inspectWorkbookBounds(workbook: Sheet[]) {
  if (workbook.length > MAX_SHEETS) throw new Error(`В XLSX больше ${MAX_SHEETS} листов.`);
  let totalCells = 0;
  for (const sheet of workbook) {
    if (sheet.data.length > MAX_ROWS_PER_SHEET) throw new Error(`В листе «${sheet.sheet}» больше ${MAX_ROWS_PER_SHEET} строк.`);
    const columns = sheet.data.reduce((maximum, row) => Math.max(maximum, row.length), 0);
    if (columns > MAX_COLUMNS_PER_SHEET) throw new Error(`В листе «${sheet.sheet}» больше ${MAX_COLUMNS_PER_SHEET} колонок.`);
    const cells = sheet.data.reduce((count, row) => count + row.length, 0);
    if (cells > MAX_CELLS_PER_SHEET) throw new Error(`Лист «${sheet.sheet}» содержит слишком много ячеек.`);
    totalCells += cells;
  }
  if (totalCells > MAX_TOTAL_CELLS) throw new Error("XLSX содержит слишком много ячеек.");
}

function inspectXlsxArchive(bytes: Uint8Array) {
  if (bytes.length < 4 || readUint32(bytes, 0) !== 0x04034b50) {
    throw new Error("Содержимое файла не соответствует формату XLSX.");
  }
  const eocdOffset = findEndOfCentralDirectory(bytes);
  if (eocdOffset < 0) throw new Error("Повреждённая структура XLSX archive.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const entries = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (diskNumber !== 0 || centralDisk !== 0 || entries === 0 || entries > MAX_ZIP_ENTRIES) {
    throw new Error("Недопустимая структура XLSX archive.");
  }
  if (centralOffset + centralSize > eocdOffset) throw new Error("Повреждённая структура XLSX archive.");

  let cursor = centralOffset;
  let totalUncompressed = 0;
  const paths = new Set<string>();
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error("Повреждённая структура XLSX archive.");
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > bytes.length || (flags & 1) !== 0 || ![0, 8].includes(method)) {
      throw new Error("XLSX использует неподдерживаемую ZIP-структуру.");
    }
    const path = textDecoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)).replace(/\\/g, "/");
    if (!path || path.startsWith("/") || path.split("/").includes("..") || paths.has(path)) {
      throw new Error("XLSX содержит небезопасный путь archive entry.");
    }
    if (/^(xl\/(vbaProject\.bin|macrosheets\/|externalLinks\/|embeddings\/|activeX\/))/i.test(path)) {
      throw new Error("XLSX с macros, external links или embedded objects не поддерживается.");
    }
    if (uncompressedSize > 10 * 1024 * 1024 || (uncompressedSize > 0 && uncompressedSize / Math.max(compressedSize, 1) > MAX_COMPRESSION_RATIO)) {
      throw new Error("XLSX превышает безопасные ограничения распаковки.");
    }
    paths.add(path);
    totalUncompressed += uncompressedSize;
    cursor = next;
  }
  if (cursor !== centralOffset + centralSize || totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
    throw new Error("XLSX превышает безопасные ограничения archive.");
  }
  if (!paths.has("[Content_Types].xml") || !paths.has("xl/workbook.xml")) {
    throw new Error("Содержимое файла не соответствует формату XLSX.");
  }
  const worksheetCount = [...paths].filter((path) => /^xl\/worksheets\/[^/]+\.xml$/i.test(path)).length;
  if (worksheetCount === 0 || worksheetCount > MAX_SHEETS) throw new Error(`В XLSX недопустимое число листов: ${worksheetCount}.`);
}

function findEndOfCentralDirectory(bytes: Uint8Array) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (readUint32(bytes, offset) === 0x06054b50) return offset;
  }
  return -1;
}

function readUint32(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 4 > bytes.length) return -1;
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
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
