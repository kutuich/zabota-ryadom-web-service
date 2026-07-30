import { chromium } from "playwright";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const baseUrl = (process.env.VISUAL_AUDIT_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
const outDir = path.join(root, "visual-audit");
const screenshotDir = path.join(outDir, "screenshots");
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
  { name: "mobile-small", width: 360, height: 800 }
];
const auditRoutes = [
  { role: "client", path: "/app/audit/client", marker: "client" },
  { role: "performer", path: "/app/audit/performer", marker: "performer" },
  { role: "admin", path: "/app/audit/admin", marker: "admin" }
];
const publicRoutes = ["/", "/app", "/prices.html", "/security.html", "/contacts.html", "/how-it-works.html", "/legal.html"];
const results = [];
const consoleErrors = [];
const networkErrors = [];
let screenshotCount = 0;

async function main() {
  await rm(screenshotDir, { recursive: true, force: true });
  await mkdir(screenshotDir, { recursive: true });
  const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!health?.ok) throw new Error("Локальный сайт не запущен или /api/health недоступен.");
  const browser = await chromium.launch({ headless: true });
  try {
    await auditPublic(browser);
    for (const route of auditRoutes) {
      for (const viewport of viewports) await auditWorkflowRoute(browser, route, viewport);
    }
  } finally {
    await browser.close();
  }
  await writeArtifacts();
  const failed = results.filter((result) => !result.ok);
  console.log(`Visual audit completed. Screenshots: ${screenshotCount}. Failed screens: ${failed.length}. Console errors: ${consoleErrors.length}. Network errors: ${networkErrors.length}.`);
  if (failed.length || consoleErrors.length || networkErrors.length) process.exitCode = 1;
}

async function auditPublic(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const page = trackedPage(await context.newPage(), "public");
  try {
    for (const [index, route] of publicRoutes.entries()) {
      await capture(page, {
        role: "public",
        route,
        viewport: "desktop",
        file: `public-${String(index + 1).padStart(2, "0")}.png`,
        assertions: async () => basicLayoutAssertions(page)
      });
    }
  } finally {
    await context.close();
  }
}

async function auditWorkflowRoute(browser, route, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, locale: "ru-RU" });
  const page = trackedPage(await context.newPage(), route.role);
  try {
    await capture(page, {
      role: route.role,
      route: route.path,
      viewport: viewport.name,
      file: `${route.role}-${viewport.name}.png`,
      assertions: async () => workflowAssertions(page, route.marker, viewport)
    });
    if (route.role === "client") {
      await capture(page, {
        role: route.role,
        route: route.path,
        viewport: `${viewport.name}-validation`,
        file: `${route.role}-${viewport.name}-validation.png`,
        action: async () => page.getByRole("button", { name: "Проверить ошибки формы" }).click(),
        assertions: async () => validationAssertions(page)
      });
    }
  } finally {
    await context.close();
  }
}

async function capture(page, options) {
  const record = { role: options.role, route: options.route, viewport: options.viewport, screenshot: options.file, ok: false, problems: [], skipped: [] };
  results.push(record);
  try {
    await page.goto(`${baseUrl}${options.route}`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => undefined);
    if (options.action) await options.action();
    await page.waitForTimeout(100);
    record.problems.push(...await options.assertions());
    const file = path.join(screenshotDir, options.file);
    await page.screenshot({ path: file, fullPage: true });
    screenshotCount += 1;
    record.ok = record.problems.length === 0;
  } catch (error) {
    record.problems.push(error instanceof Error ? error.message : String(error));
  }
}

async function workflowAssertions(page, marker, viewport) {
  const problems = await basicLayoutAssertions(page);
  if (await page.locator(`[data-visual-audit-route="${marker}"]`).count() !== 1) problems.push(`Не найден marker ${marker}.`);
  if (await page.locator("main h1").count() < 1) problems.push("Не найден main h1.");
  if (await page.locator("[data-audit-card]").count() < 3) problems.push("Найдено меньше трёх audit cards.");
  if (await page.locator("[data-audit-table]").count() < 1) problems.push("Не найдена audit table.");
  const body = await page.locator("body").innerText();
  for (const forbidden of ["комиссия", "выплата Помощнику", "доход после удержания"]) {
    if (body.toLocaleLowerCase("ru-RU").includes(forbidden.toLocaleLowerCase("ru-RU"))) problems.push(`Найдена устаревшая формулировка: ${forbidden}.`);
  }
  if (!body.includes("15") || !body.includes("30")) problems.push("Не показаны 15 визитов и 30 часов.");
  if (marker === "client") {
    if (await page.locator(".audit-workflow-step").count() !== 8) problems.push("Форма не содержит восемь последовательных разделов.");
    for (const text of ["Лёгкая уборка", "Мытьё посуды", "Приготовить простую еду", "Купить продукты", "750 ₽", "14 250 ₽"]) if (!body.includes(text)) problems.push(`Не найдено значение: ${text}.`);
  }
  if (marker === "performer" && !body.includes("Оплата помощи производится Заказчиком Помощнику напрямую")) problems.push("Нет пояснения о прямой оплате помощи.");
  if (marker === "admin") for (const text of ["Batch", "30", "950 ₽", "550 ₽", "Спорный визит", "Сверить визиты вручную"]) if (!body.includes(text)) problems.push(`Admin fixture не содержит: ${text}.`);
  if (viewport.width <= 390) {
    const position = await page.locator(".audit-showcase__topbar").evaluate((element) => getComputedStyle(element).position);
    if (position !== "sticky") problems.push("Мобильная верхняя навигация не sticky.");
    const fixedBottom = await page.locator("body *").evaluateAll((elements) => elements.filter((element) => { const style = getComputedStyle(element); return style.position === "fixed" && (style.bottom === "0px" || Number.parseFloat(style.bottom) <= 4); }).length);
    if (fixedBottom) problems.push("Найдена нижняя fixed-панель, способная перекрыть форму.");
  }
  return problems;
}

async function validationAssertions(page) {
  const problems = await basicLayoutAssertions(page);
  const errors = page.locator("[data-audit-field-error]");
  if (await errors.count() < 5) problems.push("Показано недостаточно конкретных ошибок формы.");
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-audit-field-error"));
  if (!focused) problems.push("Первое ошибочное поле не получило focus.");
  const cityValue = await page.locator(".audit-field input").first().inputValue();
  if (cityValue !== "Югорск") problems.push("Введённые данные потерялись после validation error.");
  return problems;
}

async function basicLayoutAssertions(page) {
  return page.evaluate(() => {
    const problems = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) problems.push(`Horizontal overflow: ${root.scrollWidth - root.clientWidth}px.`);
    const viewportWidth = root.clientWidth;
    const visible = [...document.querySelectorAll("body *")].filter((element) => { const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1; });
    const outside = visible.filter((element) => { const rect = element.getBoundingClientRect(); return rect.left < -2 || rect.right > viewportWidth + 2; }).slice(0, 5);
    if (outside.length) problems.push(`Элементы выходят за viewport: ${outside.map((element) => element.tagName.toLowerCase()).join(", ")}.`);
    const unlabeled = [...document.querySelectorAll("input, select, textarea")].filter((control) => !control.closest("label") && !control.getAttribute("aria-label") && !control.getAttribute("aria-labelledby"));
    if (unlabeled.length) problems.push(`Поля без подписи: ${unlabeled.length}.`);
    return problems;
  });
}

function trackedPage(page, role) {
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push({ role, url: page.url(), text: message.text() }); });
  page.on("pageerror", (error) => consoleErrors.push({ role, url: page.url(), text: error.message }));
  page.on("requestfailed", (request) => networkErrors.push({ role, url: request.url(), method: request.method(), error: request.failure()?.errorText }));
  page.on("response", (response) => { if (response.status() >= 400) networkErrors.push({ role, url: response.url(), method: response.request().method(), status: response.status() }); });
  return page;
}

async function writeArtifacts() {
  const pngFiles = await listPng(screenshotDir);
  const successful = results.filter((result) => result.ok).length;
  const failed = results.length - successful;
  const report = [
    "# Visual Audit Report — workflow v2",
    "",
    `Дата: ${new Date().toLocaleString("ru-RU")}`,
    `Base URL: ${baseUrl}`,
    `Страниц/состояний проверено: ${results.length}`,
    `Успешно: ${successful}`,
    `С ошибками: ${failed}`,
    `Скриншотов: ${screenshotCount}`,
    `PNG найдено: ${pngFiles.length}`,
    `Console errors: ${consoleErrors.length}`,
    `Network/failed requests: ${networkErrors.length}`,
    "",
    "## Экраны",
    "",
    ...results.flatMap((result) => [
      `### ${result.role} · ${result.viewport}`,
      `- Маршрут: ${result.route}`,
      `- Скриншот: visual-audit/screenshots/${result.screenshot}`,
      `- Результат: ${result.ok ? "успешно" : "есть проблемы"}`,
      `- Проблемы: ${result.problems.length ? result.problems.join("; ") : "нет"}`,
      `- Пропущенные проверки: ${result.skipped.length ? result.skipped.join("; ") : "нет"}`,
      ""
    ]),
    "## Ограничения",
    "",
    "- Audit routes используют только детерминированные frontend mock-данные и не проверяют сохранение в БД.",
    "- Поведение экранной клавиатуры iOS проверяется косвенно через отсутствие fixed bottom UI и доступность последней кнопки; реальная системная клавиатура headless Chromium не открывается.",
    "- Backend E2E расчёта, финализации, ledger, спора и reconciliation выполняется отдельно в npm test.",
    ""
  ].join("\n");
  await writeFile(path.join(outDir, "VISUAL_AUDIT_REPORT.md"), report, "utf8");
  await writeFile(path.join(outDir, "console-errors.json"), JSON.stringify(consoleErrors, null, 2), "utf8");
  await writeFile(path.join(outDir, "network-errors.json"), JSON.stringify(networkErrors, null, 2), "utf8");
}

async function listPng(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listPng(file));
    else if (entry.name.endsWith(".png")) files.push(file);
  }
  return files;
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
