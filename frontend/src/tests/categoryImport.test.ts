import { describe, expect, test } from "vitest";
import { readCategoryImportFile } from "../utils/categoryImport";
import { createXlsxBlob } from "../utils/xlsx";

const requiredSheets = [
  {
    name: "Паспорт структуры",
    rows: [
      ["Поле", "Значение"],
      ["scopeType", "CITY"],
      ["regionId", "region-1"],
      ["cityId", "city-1"],
      ["title", "Тестовая структура"],
      ["targetVersion", "2.4"],
      ["qualityStatus", "review"],
      ["warning", "Проверить перед публикацией"],
      ["parentStructureId", "parent-1"]
    ]
  },
  {
    name: "Категории",
    rows: [
      ["slug", "parentSlug", "title", "shortTitle", "sortOrder", "status", "visibleForCustomer", "visibleForHelper", "visibleForManager", "visibleForAdmin"],
      ["home-help", "", "Помощь по дому", "Дом", 7, "active", "нет", "да", 0, 1],
      ["home-help", "", "Дубликат для backend validation", "", "not-an-integer", "", "unexpected", "", "", ""]
    ]
  },
  {
    name: "Типовые задачи",
    rows: [
      ["categorySlug", "taskSlug", "title", "aliases", "durationEffect", "requiresComment", "allowedRegions", "formFields", "recommendations", "constraints", "sortOrder", "active"],
      ["home-help", "clean", "Уборка", "[\"порядок\"]", "{\"minutes\":30}", "да", "[\"region-1\"]", "[]", "invalid-json", "{}", 20, false]
    ]
  },
  {
    name: "Ограничения",
    rows: [
      ["categorySlug", "ruleKey", "title", "description", "severity", "isBlocking", "applicability", "active", "showToCustomer", "showToHelper", "showToManager", "sortOrder"],
      ["home-help", "no-danger", "Без опасных работ", "Описание", "warning", true, "{}", true, true, true, true, 10]
    ]
  },
  {
    name: "Рекомендуемые цены",
    rows: [
      ["categorySlug", "taskSlug", "packageCode", "coveredTaskSlugs", "recommendedMinPrice", "recommendedMaxPrice", "defaultDurationMinutes", "priceComment", "active"],
      ["home-help", "clean", "", "[]", 500, "", 60, "", "да"]
    ]
  }
];

function projectFile(sheets = requiredSheets, name = "categories.xlsx") {
  return new File([createXlsxBlob(sheets)], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

describe("category XLSX import characterization", () => {
  test("imports a project-generated workbook and preserves current value conversions", async () => {
    const result = await readCategoryImportFile(projectFile()) as any;

    expect(result).toMatchObject({
      schemaVersion: "2",
      version: "1",
      scope: { type: "city", regionId: "region-1", cityId: "city-1" },
      passport: {
        title: "Тестовая структура",
        versionNumber: "2.4",
        qualityStatus: "review",
        comment: "Проверить перед публикацией",
        parentStructureId: "parent-1"
      }
    });
    expect(result.categories).toEqual([
      expect.objectContaining({ slug: "home-help", title: "Помощь по дому", shortTitle: "Дом", sortOrder: 7, visibleForCustomer: false, visibleForHelper: true, visibleForManager: false, visibleForAdmin: true }),
      expect.objectContaining({ slug: "home-help", title: "Дубликат для backend validation", shortTitle: null, sortOrder: 100, status: "active", visibleForCustomer: true })
    ]);
    expect(result.taskTemplates[0]).toEqual(expect.objectContaining({
      aliases: ["порядок"],
      durationEffect: { minutes: 30 },
      requiresComment: true,
      allowedRegions: ["region-1"],
      recommendations: [],
      sortOrder: 20,
      active: false
    }));
    expect(result.pricingRules[0]).toEqual(expect.objectContaining({
      recommendedMinPrice: 500,
      recommendedMaxPrice: null,
      defaultDurationMinutes: 60,
      active: true
    }));
  });

  test("keeps duplicate and invalid domain rows for the existing backend preview validation", async () => {
    const result = await readCategoryImportFile(projectFile()) as any;

    expect(result.categories.map((row: any) => row.slug)).toEqual(["home-help", "home-help"]);
    expect(result.taskTemplates[0].recommendations).toEqual([]);
  });

  test("recognizes schema v3 sheets and their project column names", async () => {
    const result = await readCategoryImportFile(projectFile([
      ...requiredSheets,
      {
        name: "Узлы",
        rows: [
          ["slug", "stableKey", "parentSlug", "nodeType", "title", "sortOrder", "selectable", "active", "visible", "selectionMode", "aliases", "formFields", "constraints", "durationEffect", "metadata"],
          ["cleaning", "cleaning", "", "task", "Уборка", 30, true, true, false, "single", "[\"чистота\"]", "[]", "{}", "{\"minutes\":15}", "{}"]
        ]
      }
    ])) as any;

    expect(result.schemaVersion).toBe("3");
    expect(result.version).toBe("2");
    expect(result.nodes).toEqual([expect.objectContaining({
      slug: "cleaning",
      stableKey: "cleaning",
      nodeType: "task",
      sortOrder: 30,
      selectable: true,
      visible: false,
      aliases: ["чистота"],
      durationEffect: { minutes: 15 }
    })]);
  });

  test("rejects a workbook without a required sheet with the current error", async () => {
    const withoutPricing = requiredSheets.filter((sheet) => sheet.name !== "Рекомендуемые цены");

    await expect(readCategoryImportFile(projectFile(withoutPricing))).rejects.toThrow("В файле нет листа «Рекомендуемые цены».");
  });

  test("rejects unsupported and malformed files", async () => {
    await expect(readCategoryImportFile(new File(["text"], "categories.csv", { type: "text/csv" }))).rejects.toThrow("Разрешены только файлы JSON и XLSX.");
    await expect(readCategoryImportFile(new File(["not a zip"], "categories.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))).rejects.toThrow("Содержимое файла не соответствует формату XLSX.");
    await expect(readCategoryImportFile(new File([createXlsxBlob(requiredSheets)], "categories.xlsx", { type: "text/plain" }))).rejects.toThrow("Содержимое файла не соответствует формату XLSX.");
  });

  test("rejects adversarial-like files at size, sheet and row boundaries", async () => {
    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "categories.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    await expect(readCategoryImportFile(oversized)).rejects.toThrow("Файл больше 5 МБ.");

    const tooManySheets = Array.from({ length: 13 }, (_, index) => ({ name: `Лист ${index + 1}`, rows: [["value"]] }));
    await expect(readCategoryImportFile(projectFile(tooManySheets))).rejects.toThrow("В XLSX недопустимое число листов: 13.");

    const tooManyRows = [{ name: "Паспорт структуры", rows: Array.from({ length: 5_001 }, (_, index) => [index]) }];
    await expect(readCategoryImportFile(projectFile(tooManyRows))).rejects.toThrow("В листе «Паспорт структуры» больше 5000 строк.");
  });
});
