import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const projectRoot = path.resolve(projectDir, "..");
const defaultReportDir = path.join(projectRoot, "audits", "visual", `visual-audit-${timestamp()}`);
const reportDir = path.resolve(process.argv[2] ?? defaultReportDir);
const screenshotDir = path.join(reportDir, "screenshots");
const reportPath = path.join(reportDir, "visual-audit-report.md");

const localhostBase = (process.env.VISUAL_AUDIT_LOCAL_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
if (!/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(localhostBase)) {
  throw new Error("VISUAL_AUDIT_LOCAL_BASE_URL может указывать только на localhost или 127.0.0.1.");
}

const pages = [
  { slug: "home", path: "/", label: "Главная", summary: "home" },
  { slug: "prices", path: "/prices.html", label: "Цены", summary: "prices" },
  { slug: "security", path: "/security.html", label: "Безопасность", summary: "security" },
  { slug: "contacts", path: "/contacts.html", label: "Контакты", summary: "contacts" },
  { slug: "how-it-works", path: "/how-it-works.html", label: "Как это работает", summary: "how" },
  { slug: "legal", path: "/legal.html", label: "Юридическая информация", summary: "legal" }
];

const cabinetAuditRoutes = [
  { role: "client", path: "/app/audit/client", label: "Кабинет Заказчика", summary: "audit-client" },
  { role: "performer", path: "/app/audit/performer", label: "Кабинет Помощника", summary: "audit-performer" },
  { role: "admin", path: "/app/audit/admin", label: "Админка", summary: "audit-admin" }
];

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 }
];

const critical = [];
const important = [];
const screenshots = [];
const checks = [];
const summaryProblems = new Map();
let localChecked = false;
let browser;

await mkdir(screenshotDir, { recursive: true });

try {
  localChecked = await isReachable(`${localhostBase}/`);
  if (!localChecked) {
    console.error("Локальный сайт не запущен.");
    console.error("Для визуального аудита сначала запустите start-zabota-local.command.");
    addCritical("local", `Локальная версия ${localhostBase} недоступна. Для визуального аудита сначала запустите start-zabota-local.command.`);
    process.exitCode = 1;
  } else {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      addCritical("system", `Playwright Chromium не запустился: ${messageOf(error)}. Выполните npx playwright install chromium.`);
      process.exitCode = 1;
    }
    if (browser) {
      await auditEnvironment("local", localhostBase);
      await auditLocalCabinetRoutes();
    }
  }
} catch (error) {
  addCritical("system", `Аудит завершился с неожиданной ошибкой: ${messageOf(error)}`);
} finally {
  if (browser) await browser.close();
  await writeReport();
  printSummary();
}

async function auditLocalCabinetRoutes() {
  console.log(`Проверяю локальные audit routes: ${localhostBase}`);
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      locale: "ru-RU"
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(25000);
    try {
      for (const route of cabinetAuditRoutes) {
        await captureCabinetAuditRoute(page, route, viewport);
      }
    } finally {
      await context.close();
    }
  }
}

async function captureCabinetAuditRoute(page, route, viewport) {
  const fileName = `audit-${route.role}-${viewport.name}.png`;
  const url = `${localhostBase}${route.path}`;
  const contextLabel = `localhost / ${route.label} / ${viewport.name}`;
  const apiRequests = [];
  const trackApiRequest = (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      apiRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  };
  page.on("request", trackApiRequest);

  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    await settle(page);
    const status = response?.status() ?? 0;
    const finalPath = new URL(page.url()).pathname.replace(/\/$/, "");
    if (!response || status < 200 || status >= 400) {
      addCritical(route.summary, `${contextLabel}: audit route не открылся (HTTP ${status || "нет ответа"}).`);
    }
    if (finalPath !== route.path) {
      addCritical(route.summary, `${contextLabel}: audit route недоступен или перенаправил на ${finalPath || "/"}. Проверьте VITE_ENABLE_VISUAL_AUDIT_ROUTES=true до локальной сборки.`);
    }

    await inspectPage(page, contextLabel, route.summary, viewport);
    await inspectCabinetAuditRoute(page, contextLabel, route);
    if (apiRequests.length) {
      addCritical(route.summary, `${contextLabel}: sandbox обратился к API (${[...new Set(apiRequests)].join(", ")}). Audit routes должны быть frontend-only.`);
    }
    await saveScreenshot(page, fileName);
    checks.push({ environment: "local", page: route.label, viewport: viewport.name, url, status, finalUrl: page.url(), fileName });
  } catch (error) {
    addCritical(route.summary, `${contextLabel}: ошибка audit route — ${messageOf(error)}.`);
    await saveScreenshot(page, fileName);
    checks.push({ environment: "local", page: route.label, viewport: viewport.name, url, status: 0, finalUrl: page.url(), fileName });
  } finally {
    page.off("request", trackApiRequest);
  }
}

async function inspectCabinetAuditRoute(page, contextLabel, route) {
  const result = await page.evaluate((expectedRole) => {
    const bodyText = document.body?.innerText ?? "";
    const emailMatches = bodyText.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? [];
    const phoneMatches = bodyText.match(/\+7\s*\([^)]{3}\)\s*[\d-]{9,}/g) ?? [];
    return {
      expectedShowcase: document.querySelector(`[data-visual-audit-route="${expectedRole}"]`) !== null,
      heading: Boolean(document.querySelector("main h1")),
      cards: document.querySelectorAll("[data-audit-card]").length,
      tables: document.querySelectorAll("[data-audit-table]").length,
      forbiddenWords: ["комиссия", "исполнитель", "клиент", "работник", "трудоустроим", "медицинские услуги"].filter((word) => new RegExp(`(^|[^\p{L}])${word}([^\p{L}]|$)`, "iu").test(bodyText)),
      unexpectedEmails: emailMatches.filter((email) => email !== "test@example.local"),
      unexpectedPhones: phoneMatches.filter((phone) => phone.replace(/\s/g, "") !== "+7(900)000-00-00"),
      unsafeAddressDetails: /(?:квартира|домофон|подъезд)\s*[:№]?\s*\d+/i.test(bodyText)
    };
  }, route.role);

  if (!result.expectedShowcase) addCritical(route.summary, `${contextLabel}: не найдена безопасная mock-витрина.`);
  if (!result.heading) addCritical(route.summary, `${contextLabel}: нет основного заголовка.`);
  if (result.cards < 3) addCritical(route.summary, `${contextLabel}: недостаточно карточек для насыщенного состояния (${result.cards}).`);
  if (result.tables < 1) addCritical(route.summary, `${contextLabel}: нет mock-таблицы.`);
  if (result.forbiddenWords.length) addCritical(route.summary, `${contextLabel}: найдены запрещённые слова: ${result.forbiddenWords.join(", ")}.`);
  if (result.unexpectedEmails.length || result.unexpectedPhones.length || result.unsafeAddressDetails) {
    addCritical(route.summary, `${contextLabel}: найдены похожие на реальные персональные или адресные данные.`);
  }
}

async function isReachable(url) {
  try {
    await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000) });
    return true;
  } catch {
    return false;
  }
}

async function auditEnvironment(environment, baseUrl) {
  console.log(`Проверяю ${environment}: ${baseUrl}`);
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      locale: "ru-RU"
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(25000);

    try {
      for (const pageInfo of pages) {
        await capturePage(page, environment, baseUrl, pageInfo, viewport);
      }
      await auditApp(page, environment, baseUrl, viewport);
    } finally {
      await context.close();
    }
  }
}

async function capturePage(page, environment, baseUrl, pageInfo, viewport) {
  const fileName = `${pageInfo.slug}-${viewport.name}.png`;
  const url = `${baseUrl}${pageInfo.path}`;
  const contextLabel = `${environment} / ${pageInfo.label} / ${viewport.name}`;

  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    await settle(page);
    const status = response?.status() ?? 0;
    if (!response || status < 200 || status >= 400) {
      addCritical(pageInfo.summary, `${contextLabel}: страница не открылась успешно (HTTP ${status || "нет ответа"}).`);
    }
    await inspectPage(page, contextLabel, pageInfo.summary, viewport);
    await saveScreenshot(page, fileName);
    checks.push({ environment, page: pageInfo.label, viewport: viewport.name, url, status, finalUrl: page.url(), fileName });
  } catch (error) {
    addCritical(pageInfo.summary, `${contextLabel}: страница не открылась — ${messageOf(error)}.`);
    await saveScreenshot(page, fileName);
    checks.push({ environment, page: pageInfo.label, viewport: viewport.name, url, status: 0, finalUrl: page.url(), fileName });
  }
}

async function auditApp(page, environment, baseUrl, viewport) {
  const summaryKey = "app";
  const loginContext = `${environment} / Приложение / вход / ${viewport.name}`;
  const loginFile = `app-login-${viewport.name}.png`;

  try {
    const response = await page.goto(`${baseUrl}/app`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const status = response?.status() ?? 0;
    if (!response || status < 200 || status >= 400) {
      addCritical(summaryKey, `${loginContext}: /app не открылся успешно (HTTP ${status || "нет ответа"}).`);
    }
    await inspectPage(page, loginContext, summaryKey, viewport);
    const loginVisible = await visibleByText(page, /^\s*Войти\s*$/i);
    if (!loginVisible) addCritical(summaryKey, `${loginContext}: не видна кнопка входа.`);
    await saveScreenshot(page, loginFile);
    checks.push({ environment, page: "Приложение: вход", viewport: viewport.name, url: `${baseUrl}/app`, status, finalUrl: page.url(), fileName: loginFile });
  } catch (error) {
    addCritical(summaryKey, `${loginContext}: экран входа не открылся — ${messageOf(error)}.`);
    await saveScreenshot(page, loginFile);
    return;
  }

  await auditRegistration(page, environment, baseUrl, viewport, "customer");
  await returnToLogin(page, baseUrl);
  await auditRegistration(page, environment, baseUrl, viewport, "helper");
}

async function auditRegistration(page, environment, baseUrl, viewport, role) {
  const isCustomer = role === "customer";
  const roleLabel = isCustomer ? "Регистрация заказчика" : "Регистрация помощника";
  const summaryKey = isCustomer ? "customer" : "helper";
  const contextLabel = `${environment} / ${roleLabel} / ${viewport.name}`;
  const fileName = `app-register-${role}-${viewport.name}.png`;

  try {
    const pattern = isCustomer ? /Зарегистрироваться как заказчик/i : /(?:Зарегистрироваться\s+)?как помощник/i;
    const trigger = page.getByRole("button", { name: pattern }).first();
    if (!(await trigger.count()) || !(await trigger.isVisible())) {
      addCritical(summaryKey, `${contextLabel}: не видна кнопка перехода к регистрации.`);
      return;
    }

    await trigger.click();
    await page.getByRole("heading", { name: new RegExp(roleLabel, "i") }).waitFor({ state: "visible" });
    await settle(page);
    await inspectPage(page, contextLabel, summaryKey, viewport);
    await inspectRegistration(page, contextLabel, summaryKey);
    await saveScreenshot(page, fileName);
    checks.push({ environment, page: roleLabel, viewport: viewport.name, url: `${baseUrl}/app`, status: 200, finalUrl: page.url(), fileName });

    const city = page.getByRole("combobox", { name: /Город/i }).first();
    if (await city.count() && await city.isVisible() && await city.evaluate((element) => element.matches("input, textarea, [contenteditable=true]"))) {
      await city.fill("Югор");
      const yugorsk = page.getByRole("option", { name: /Югорск/i }).first();
      if (!(await yugorsk.count()) || !(await yugorsk.isVisible())) {
        addCritical(summaryKey, `${contextLabel}: после ввода «Югор» в поле города не появился «Югорск».`);
      }
      await city.press("Escape");
    }
  } catch (error) {
    addCritical(summaryKey, `${contextLabel}: регистрация не открылась или не проверена — ${messageOf(error)}.`);
    await saveScreenshot(page, fileName);
  }
}

async function returnToLogin(page, baseUrl) {
  const back = page.getByRole("button", { name: /Назад ко входу|Войти/i }).first();
  if (await back.count() && await back.isVisible()) {
    await back.click();
    await settle(page);
    return;
  }
  await page.goto(`${baseUrl}/app`, { waitUntil: "domcontentloaded" });
  await settle(page);
}

async function inspectRegistration(page, contextLabel, summaryKey) {
  const registration = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const form = document.querySelector("form");
    const fields = [...document.querySelectorAll("input, select, textarea")].filter(visible);
    const buttons = [...document.querySelectorAll("button")].filter(visible);
    const text = document.body.innerText;
    return {
      formOverflow: Boolean(form && form.scrollWidth > form.clientWidth + 1),
      visibleFields: fields.length,
      createButton: buttons.some((button) => /(?:Создать аккаунт|Зарегистрироваться как (?:заказчик|помощник))/i.test(button.innerText)),
      documents: /Документы и согласия/i.test(text),
      city: fields.some((field) => field.getAttribute("role") === "combobox" || /Город/i.test(field.closest("label, div")?.innerText ?? ""))
    };
  });

  if (registration.formOverflow) addCritical(summaryKey, `${contextLabel}: форма имеет горизонтальный скролл.`);
  if (registration.visibleFields < 5) addCritical(summaryKey, `${contextLabel}: поля регистрации не видны или их недостаточно (${registration.visibleFields}).`);
  if (!registration.createButton) addCritical(summaryKey, `${contextLabel}: не видна кнопка «Создать аккаунт».`);
  if (!registration.documents) addCritical(summaryKey, `${contextLabel}: не виден блок документов и согласий.`);
  if (!registration.city) addCritical(summaryKey, `${contextLabel}: не видно поле города.`);
}

async function inspectPage(page, contextLabel, summaryKey, viewport) {
  const audit = await page.evaluate(({ viewportWidth }) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const selector = "body *:not(script):not(style):not(meta):not(link):not(path):not(svg)";
    const elements = [...document.querySelectorAll(selector)].filter(visible);
    const overflowing = elements.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left < -2 || rect.right > viewportWidth + 2;
    }).slice(0, 8).map((element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.classList.length ? `.${[...element.classList].slice(0, 2).join(".")}` : ""}`);
    const narrowControls = elements.filter((element) => {
      if (!element.matches("button, input:not([type=checkbox]):not([type=radio]), select, textarea, a.primary-button")) return false;
      if (element.matches(".link-button")) return false;
      const rect = element.getBoundingClientRect();
      const text = (element.innerText || element.getAttribute("value") || element.getAttribute("placeholder") || "").trim();
      return text.length > 6 && (rect.width < 72 || rect.height < 28);
    }).slice(0, 6).map((element) => (element.innerText || element.getAttribute("placeholder") || element.tagName).trim().slice(0, 60));
    const clippedText = elements.filter((element) => {
      const style = getComputedStyle(element);
      const text = (element.textContent || "").trim();
      return text.length > 20 && /hidden|clip/.test(style.overflow) && element.scrollHeight > element.clientHeight + 2;
    }).slice(0, 6).map((element) => (element.textContent || element.tagName).trim().replace(/\s+/g, " ").slice(0, 70));
    const brokenImages = [...document.images].filter((image) => visible(image) && image.complete && image.naturalWidth === 0).slice(0, 6).map((image) => image.currentSrc || image.src || image.alt || "img");
    const bodyText = document.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
    const visibleIndexLinks = [...document.querySelectorAll('a[href*="/index.html"]')].filter(visible).filter((link) => link.matches(".button, .btn, [role=button]") || /button|btn|cta/i.test(link.className) || Boolean(link.closest("nav"))).map((link) => link.getAttribute("href"));
    return {
      title: document.title.trim(),
      bodyText,
      hasMain: Boolean(document.querySelector("main")) || bodyText.length >= 80,
      horizontalScroll: document.documentElement.scrollWidth > viewportWidth + 1 || document.body.scrollWidth > viewportWidth + 1,
      bodyTooWide: document.body.getBoundingClientRect().width > viewportWidth + 1,
      overflowing,
      narrowControls,
      clippedText,
      brokenImages,
      visibleIndexLinks
    };
  }, { viewportWidth: viewport.width });

  if (!audit.title) addCritical(summaryKey, `${contextLabel}: у страницы нет title.`);
  if (!audit.hasMain) addCritical(summaryKey, `${contextLabel}: не найден основной контент.`);
  if (audit.horizontalScroll) addCritical(summaryKey, `${contextLabel}: есть горизонтальная прокрутка.`);
  if (audit.bodyTooWide) addCritical(summaryKey, `${contextLabel}: ширина body больше viewport (${viewport.width}px).`);
  if (audit.overflowing.length) addCritical(summaryKey, `${contextLabel}: видимые элементы выходят за экран: ${audit.overflowing.join(", ")}.`);

  const errorMarkers = [
    [/(?:^|\s)Not found(?:\s|$)/i, "Not found"],
    [/Internal Server Error/i, "Internal Server Error"],
    [/Application error/i, "Application error"],
    [/Юридический документ customer_agreement не найден/i, "юридический документ customer_agreement не найден"],
    [/(?:На главнуюВойти|НазадВойти|ВойтиЗарегистрироваться)/i, "склеенные слова (например, «На главнуюВойти»)"]
  ];
  for (const [pattern, label] of errorMarkers) {
    if (pattern.test(audit.bodyText)) addCritical(summaryKey, `${contextLabel}: найден текст «${label}».`);
  }
  if (audit.visibleIndexLinks.length) addCritical(summaryKey, `${contextLabel}: видимые кнопки/ссылки ведут на /index.html: ${audit.visibleIndexLinks.join(", ")}.`);
  if (audit.narrowControls.length) addImportant(summaryKey, `${contextLabel}: элементы управления могут быть слишком сжаты: ${audit.narrowControls.join("; ")}.`);
  if (audit.clippedText.length) addImportant(summaryKey, `${contextLabel}: текст может обрезаться: ${audit.clippedText.join("; ")}.`);
  if (audit.brokenImages.length) addImportant(summaryKey, `${contextLabel}: изображения не загрузились: ${audit.brokenImages.join(", ")}.`);
}

async function visibleByText(page, pattern) {
  const locator = page.getByRole("button", { name: pattern }).first();
  return Boolean(await locator.count()) && await locator.isVisible();
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(350);
}

async function saveScreenshot(page, fileName) {
  try {
    await page.screenshot({ path: path.join(screenshotDir, fileName), fullPage: true });
    if (!screenshots.includes(fileName)) screenshots.push(fileName);
  } catch (error) {
    important.push(`Не удалось сохранить скриншот ${fileName}: ${messageOf(error)}.`);
  }
}

function addCritical(summaryKey, text) {
  critical.push(text);
  markProblem(summaryKey);
}

function addImportant(summaryKey, text) {
  important.push(text);
  markProblem(summaryKey);
}

function markProblem(summaryKey) {
  summaryProblems.set(summaryKey, true);
}

function status(summaryKey) {
  if (!localChecked) return "не выполнено";
  return summaryProblems.get("system") || summaryProblems.get(summaryKey) ? "есть замечания" : "успешно";
}

function cabinetAuditStatus(summaryKey) {
  if (!localChecked) return "не выполнено";
  if (summaryProblems.get("system") || summaryProblems.get(summaryKey)) return "ошибка";
  return "успешно";
}

async function writeReport() {
  const mobileHasProblems = summaryProblems.get("system") || [...critical, ...important].some((item) => item.includes(" / mobile"));
  const executionStatus = localChecked && browser ? "выполнен" : "не выполнен";
  const lines = [
    "# Визуальный аудит «Забота Рядом»",
    "",
    `Дата: ${new Date().toLocaleString("ru-RU")}`,
    `Проверяемая локальная версия: ${localhostBase}`,
    `Папка отчёта: ${reportDir}`,
    "",
    "## 1. Краткий итог",
    "",
    `- Визуальный аудит: ${executionStatus}.`,
    ...(!localChecked ? ["- Причина: localhost недоступен. Для визуального аудита сначала запустите `start-zabota-local.command`."] : []),
    `- Мобильная версия: ${mobileHasProblems ? "есть замечания" : localChecked ? "успешно" : "не выполнено"}`,
    "",
    "## Проверенные страницы",
    "",
    `- Главная: ${status("home")}`,
    `- Приложение /app: ${status("app")}`,
    `- Регистрация Заказчика: ${status("customer")}`,
    `- Регистрация Помощника: ${status("helper")}`,
    `- Цены: ${status("prices")}`,
    `- Безопасность: ${status("security")}`,
    `- Контакты: ${status("contacts")}`,
    `- Как это работает: ${status("how")}`,
    `- Юридическая информация: ${status("legal")}`,
    `- Кабинет Заказчика: ${cabinetAuditStatus("audit-client")}`,
    `- Кабинет Помощника: ${cabinetAuditStatus("audit-performer")}`,
    `- Админка: ${cabinetAuditStatus("audit-admin")}`,
    "",
    "## 2. Критичные визуальные проблемы",
    "",
    ...(critical.length ? critical.map((item) => `- ${item}`) : ["- Не найдены."]),
    "",
    "## 3. Важные замечания",
    "",
    ...(important.length ? important.map((item) => `- ${item}`) : ["- Не найдены."]),
    "",
    "## 4. Скриншоты",
    "",
    "### Скриншоты кабинетов",
    "",
    ...(screenshots.filter((fileName) => fileName.startsWith("audit-")).length
      ? screenshots.filter((fileName) => fileName.startsWith("audit-")).sort().map((fileName) => `- [${fileName}](screenshots/${fileName})`)
      : ["- Нет: локальные audit routes не проверены."]),
    "",
    "### Все скриншоты",
    "",
    ...(screenshots.length ? screenshots.sort().map((fileName) => `- [${fileName}](screenshots/${fileName})`) : ["- Скриншоты не созданы."]),
    "",
    "### Технический журнал открытия страниц",
    "",
    "| Среда | Страница | Экран | HTTP | Итоговый URL |",
    "| --- | --- | --- | ---: | --- |",
    ...checks.map((item) => `| ${item.environment} | ${escapeCell(item.page)} | ${item.viewport} | ${item.status || "—"} | ${escapeCell(item.finalUrl)} |`),
    "",
    "## 5. Что проверить вручную",
    "",
    "- Открыть скриншоты всех трёх размеров и сравнить отступы, переносы и визуальную иерархию.",
    "- Проверить, что кнопки и ссылки не слипаются и легко нажимаются на телефоне.",
    "- Проверить, что изображения не обрезаны неудачно и текст не выходит за блоки.",
    "- Пройти обе формы регистрации без отправки данных и оценить удобство формы.",
    "- Проверить читаемость юридических документов и согласий.",
    "",
    "> Аудит только открывает страницы, читает DOM и сохраняет файлы отчёта. Он не изменяет код, базу данных или production.",
    ""
  ];
  await writeFile(reportPath, lines.join("\n"), "utf8");
}

function printSummary() {
  console.log("");
  console.log("Визуальный аудит завершён.");
  console.log(`Критичные проблемы: ${critical.length}`);
  console.log(`Важные замечания: ${important.length}`);
  console.log(`Скриншоты сохранены: ${screenshotDir}`);
  console.log(`Отчёт сохранён: ${reportPath}`);
}

function escapeCell(value) {
  return String(value ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function messageOf(error) {
  return error instanceof Error ? error.message.split("\n")[0] : String(error);
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
