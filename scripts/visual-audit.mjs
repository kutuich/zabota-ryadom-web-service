import { chromium } from "playwright";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const BASE_URL = (process.env.VISUAL_AUDIT_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
const OUT_DIR = path.join(ROOT, "visual-audit");
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const ERROR_SCREENSHOT_DIR = path.join(SCREENSHOT_DIR, "errors");
const REPORT_PATH = path.join(OUT_DIR, "VISUAL_AUDIT_REPORT.md");
const CONSOLE_ERRORS_PATH = path.join(OUT_DIR, "console-errors.json");
const NETWORK_ERRORS_PATH = path.join(OUT_DIR, "network-errors.json");

const credentials = {
  admin: { email: "admin@zabota.local", password: "password123", defaultPath: "/admin" },
  client: { email: "client@zabota.local", password: "password123", defaultPath: "/client/requests" },
  performer: { email: "performer@zabota.local", password: "password123", defaultPath: "/performer/requests" }
};

const roles = ["public", "client", "performer", "admin"];
const results = [];
const consoleErrors = [];
const networkErrors = [];

let screenshotCount = 0;
let errorScreenshotCount = 0;
let archiveCompleteness = null;

async function main() {
  await prepareOutput();

  const health = await checkHealth();
  if (!health.ok) {
    results.push({
      role: "system",
      title: "Проверка запуска приложения",
      route: `${BASE_URL}/api/health`,
      screenshot: "",
      checked: "Проверка доступности локального приложения перед визуальным аудитом.",
      opened: false,
      errors: [health.error],
      noticeableProblems: ["Запустите приложение перед аудитом: npm run dev или Docker/production-режим."]
    });
    await writeArtifacts();
    printSummary();
    process.exitCode = 1;
    return;
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    results.push({
      role: "system",
      title: "Запуск Playwright Chromium",
      route: BASE_URL,
      screenshot: "",
      checked: "Проверка установленного браузера Playwright.",
      opened: false,
      errors: [messageOf(error)],
      noticeableProblems: ["Если браузер не установлен, выполните: npx playwright install chromium"]
    });
    await writeArtifacts();
    printSummary();
    process.exitCode = 1;
    return;
  }

  try {
    await runRoleAudit("public", () => auditPublic(browser));
    await runRoleAudit("client", () => auditClient(browser));
    await runRoleAudit("performer", () => auditPerformer(browser));
    await runRoleAudit("admin", () => auditAdmin(browser));
  } finally {
    await browser.close();
  }

  await writeArtifacts();
  printSummary();
}

async function runRoleAudit(role, audit) {
  try {
    await audit();
  } catch (error) {
    results.push({
      role,
      title: "Критическая ошибка сценария роли",
      route: BASE_URL,
      screenshot: "",
      errorScreenshot: "",
      checked: "Сценарий роли должен продолжать общий visual audit даже при ошибке.",
      opened: false,
      optional: false,
      errors: [messageOf(error)],
      noticeableProblems: ["Сценарий роли завершился вне отдельного экрана. Следующая роль будет запущена отдельно."]
    });
  }
}

async function prepareOutput() {
  await mkdir(OUT_DIR, { recursive: true });
  await rm(SCREENSHOT_DIR, { recursive: true, force: true });
  for (const role of roles) {
    await mkdir(path.join(SCREENSHOT_DIR, role), { recursive: true });
  }
  await mkdir(ERROR_SCREENSHOT_DIR, { recursive: true });
}

async function checkHealth() {
  try {
    const response = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      return { ok: false, error: `Health endpoint вернул HTTP ${response.status}.` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

async function auditPublic(browser) {
  const { page, context } = await newTrackedPage(browser, "public");
  try {
    await capture(page, {
      role: "public",
      title: "Главная / стартовая страница",
      path: "/",
      file: "public/01-start.png",
      checked: "Публичная стартовая страница, позиционирование сервиса, форма входа."
    });
    await capture(page, {
      role: "public",
      title: "Экран входа",
      path: "/",
      file: "public/02-login.png",
      checked: "Форма входа и тестовые поля логина.",
      action: async (page) => {
        await fillLoginForm(page, "client@zabota.local", "password123");
      }
    });
    await capture(page, {
      role: "public",
      title: "Экран регистрации",
      path: "/",
      file: "public/03-register.png",
      checked: "Кнопки “Я заказчик” и “Я помощник”, регистрация выбранной роли и доступный вход.",
      action: async (page) => {
        await clickByRole(page, "button", /Я заказчик/);
        await clickByRole(page, "button", /Я помощник/);
      }
    });
    await capture(page, {
      role: "public",
      title: "Публичная база знаний / FAQ",
      path: "/help",
      expectedPath: "/help",
      optional: true,
      file: "public/04-public-faq.png",
      checked: "Проверка, доступен ли FAQ без входа."
    });
    await capture(page, {
      role: "public",
      title: "Юридические документы",
      path: "/legal",
      expectedPath: "/legal",
      file: "public/05-legal-index.png",
      checked: "Публичный список юридических документов сервиса.",
      action: async (page) => {
        const body = await page.locator("body").innerText();
        const required = [
          "Политика обработки персональных данных",
          "Согласие на обработку персональных данных",
          "Пользовательское соглашение заказчика",
          "Условия использования сервиса помощником",
          "Согласие на получение сервисных уведомлений",
          "Согласие на получение информационных сообщений",
          "Согласие на загрузку, хранение и проверку документов помощника",
          "Правила сервиса и запрещённые услуги"
        ];
        return required.filter((text) => !body.includes(text)).map((text) => `На странице /legal не найден документ: ${text}.`);
      }
    });
    for (const [index, doc] of [
      { slug: "privacy", title: "Политика обработки персональных данных" },
      { slug: "personal-data-consent", title: "Согласие на обработку персональных данных" },
      { slug: "customer-agreement", title: "Пользовательское соглашение заказчика" },
      { slug: "helper-terms", title: "Условия использования сервиса помощником" },
      { slug: "service-notifications-consent", title: "Согласие на получение сервисных уведомлений" },
      { slug: "marketing-notifications-consent", title: "Согласие на получение информационных сообщений" },
      { slug: "helper-documents-consent", title: "Согласие на загрузку, хранение и проверку документов помощника" },
      { slug: "service-rules", title: "Правила сервиса и запрещённые услуги" }
    ].entries()) {
      await capture(page, {
        role: "public",
        title: `Юридический документ: ${doc.slug}`,
        path: `/legal/${doc.slug}`,
        expectedPath: `/legal/${doc.slug}`,
        file: `public/${String(index + 6).padStart(2, "0")}-legal-${doc.slug}.png`,
        checked: "Публичная страница конкретного юридического документа.",
        action: async (page) => {
          const body = await page.locator("body").innerText();
          const problems = [];
          if (!body.includes(doc.title)) problems.push(`На странице юридического документа не найден заголовок: ${doc.title}.`);
          if (!/(Версия|Редакция)\s*1\.0/.test(body)) problems.push("На странице юридического документа не найдена версия 1.0.");
          if (!body.includes("Актуальная версия")) problems.push("На странице юридического документа не найден статус “Актуальная версия”.");
          return problems;
        }
      });
    }
    await capture(page, {
      role: "public",
      title: "Регистрация без обязательного согласия",
      path: "/",
      file: "public/14-registration-consent-error.png",
      checked: "Backend не создаёт активного пользователя без обязательных юридических чекбоксов.",
      action: async (page) => {
        await clickByRole(page, "button", /Я заказчик/);
        await fillControl(page, "Имя", "Тестовый заказчик");
        await fillControl(page, "Телефон", `+7900999${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`);
        await fillControl(page, "Email", `visual-consent-${Date.now()}@zabota.local`);
        await selectFirstValue(page, "Город");
        await fillControl(page, "Пароль", "password123");
        const checkbox = page.getByLabel(/Принимаю пользовательское соглашение заказчика/);
        if (await checkbox.count()) await checkbox.uncheck({ force: true });
        await clickByRole(page, "button", /Зарегистрироваться как заказчик/);
        await page.waitForTimeout(800);
        const body = await page.locator("body").innerText();
        return /Нужно принять обязательные юридические документы|MISSING_REQUIRED_CONSENT/.test(body)
          ? []
          : ["Не показана ошибка при регистрации без обязательного юридического согласия."];
      }
    });
  } finally {
    await context.close();
  }
}

async function auditClient(browser) {
  const { page, context } = await loginAs(browser, "client");
  try {
    await capture(page, {
      role: "client",
      title: "Главная заказчика / мои активные заявки",
      path: "/client/requests",
      file: "client/01-dashboard.png",
      checked: "Список активных заявок заказчика, статусы, действия и карточки."
    });
    await capture(page, {
      role: "client",
      title: "Профиль заказчика",
      path: "/client/profile",
      expectedPath: "/client/profile",
      file: "client/02-profile.png",
      checked: "Проверка наличия отдельного экрана профиля заказчика."
    });
    await capture(page, {
      role: "client",
      title: "Создание заявки: шаг 1",
      path: "/client/requests/new",
      file: "client/03-create-request-step-1.png",
      checked: "Начало формы заявки: город, контакты, категория, кому нужна помощь."
    });
    await capture(page, {
      role: "client",
      title: "Создание заявки: шаг 2",
      path: "/client/requests/new",
      file: "client/04-create-request-step-2.png",
      checked: "Заполненная форма заявки: адрес, задачи, состояние, дата и длительность.",
      action: async (page) => {
        await fillClientRequestDraft(page);
        await scrollToText(page, "Задачи и состояние подопечного");
        const body = await page.locator("body").innerText();
        const problems = [];
        if (!/Улица/.test(body) || !/Дом/.test(body) || !/Домофон/.test(body)) problems.push("В форме заявки не найдены новые поля структурного адреса.");
        if (!/\d{2}\.\d{2}\.\d{4}/.test(body)) problems.push("В форме заявки не найдено отображение даты в формате дд.мм.гггг.");
        if (/\b(?:AM|PM)\b/i.test(body)) problems.push("В форме заявки найдено AM/PM вместо 24-часового формата.");
        await fillControl(page, "Дом", "");
        await clickByRole(page, "button", /Создать и опубликовать/);
        await page.waitForTimeout(500);
        const bodyAfterSubmit = await page.locator("body").innerText();
        if (!/Укажите дом\./.test(bodyAfterSubmit)) problems.push("При пустом поле “Дом” не показана ошибка “Укажите дом.”.");
        return problems;
      }
    });
    await capture(page, {
      role: "client",
      title: "Экран расчёта стоимости",
      path: "/client/requests/new",
      file: "client/05-price-estimate.png",
      checked: "Блок рекомендуемой стоимости визита и подробности расчёта.",
      action: async (page) => {
        await fillClientRequestDraft(page);
        await page.waitForTimeout(700);
        await scrollToText(page, "Рекомендуемая стоимость");
      }
    });
    await capture(page, {
      role: "client",
      title: "Пересчёт стоимости при изменении условий",
      path: "/client/requests/new",
      file: "client/05a-price-recalculation.png",
      checked: "Изменение категории, гигиены, физической помощи, подгузника, простой еды, надбавок, длительности и удалённого адреса пересчитывает quote.",
      action: async (page) => {
        const problems = [];
        await fillClientRequestDraft(page);
        await page.waitForTimeout(700);
        const before = await readPriceAmount(page);
        await selectValueByLabel(page, "Уровень гигиенической помощи", "hygieneIntimate");
        await selectValueByLabel(page, "Уровень физической помощи", "physicalMedium");
        await selectValueByLabel(page, "Объём задач", "extended");
        await checkFirst(page, "смена подгузника");
        await checkFirst(page, "помощь с туалетом");
        await checkFirst(page, "Срочно сегодня/завтра");
        await checkFirst(page, "Вечер после 18:00");
        await selectValueByLabel(page, "Адрес и транспорт", "separate");
        await fillControl(page, "Длительность, часов", "3");
        await page.waitForTimeout(900);
        const after = await readPriceAmount(page);
        const body = await page.locator("body").innerText();
        if (before && after && before === after) problems.push("Цена не изменилась после изменения значимых условий.");
        if (!/Почему выбран формат|Почему выбран этот пакет/.test(body)) problems.push("Не показаны причины рекомендации формата.");
        if (!/Транспорт для СНТ|удалённых адресов/.test(body)) problems.push("Не показано предупреждение о транспорте для удалённого адреса.");
        if (!/Сервисный сбор заказчика:\s*50 ₽|Сервисный сбор заказчика\s*50 ₽/.test(body)) problems.push("Не найден сервисный сбор заказчика 50 ₽.");
        return problems;
      }
    });
    await capture(page, {
      role: "client",
      title: "Карточка заявки заказчика",
      path: "/client/requests",
      file: "client/06-request-card.png",
      checked: "Карточка заявки и открытие деталей/редактирования по номеру заявки.",
      action: async (page) => {
        const clicked = await clickFirst(page, page.locator(".card .link-button").first());
        if (!clicked) return ["Не найдена кликабельная карточка заявки."];
        await page.waitForTimeout(500);
        const body = await page.locator("body").innerText();
        const problems = [];
        if (!/Помощник увидит точный адрес/.test(body)) problems.push("В карточке заказчика не найдено пояснение о скрытии точного адреса.");
        if (!/Югорск, ул\. Мира, 10/.test(body) && !/Югорск, ул\. Мира, 1/.test(body)) problems.push("В карточке заказчика не найден полный адрес.");
        if (/\b(?:AM|PM)\b/i.test(body)) problems.push("В карточке заказчика найдено AM/PM вместо 24-часового формата.");
        return problems;
      }
    });
    await capture(page, {
      role: "client",
      title: "Редактирование заявки: адрес и формат даты",
      path: "/client/requests",
      file: "client/06a-edit-request-address.png",
      checked: "Форма редактирования заявки содержит структурный адрес, русскую дату/время и требует дом.",
      action: async (page) => {
        const clicked = await clickByRole(page, "button", /^Редактировать$/);
        if (!clicked) return ["Кнопка “Редактировать” не найдена у заявки заказчика."];
        await page.waitForTimeout(500);
        const body = await page.locator("body").innerText();
        const problems = [];
        if (!/Улица/.test(body) || !/Дом/.test(body) || !/Домофон/.test(body)) problems.push("В форме редактирования не найдены поля структурного адреса.");
        if (!/\d{2}\.\d{2}\.\d{4}/.test(body)) problems.push("В форме редактирования не найдено отображение даты в формате дд.мм.гггг.");
        if (/\b(?:AM|PM)\b/i.test(body)) problems.push("В форме редактирования найдено AM/PM вместо 24-часового формата.");
        await fillControl(page, "Дом", "");
        await clickByRole(page, "button", /Сохранить изменения/);
        await page.waitForTimeout(500);
        const bodyAfterSubmit = await page.locator("body").innerText();
        if (!/Укажите дом\./.test(bodyAfterSubmit)) problems.push("При пустом поле “Дом” в редактировании не показана ошибка “Укажите дом.”.");
        return problems;
      }
    });
    await capture(page, {
      role: "client",
      title: "Список заявок",
      path: "/client/requests",
      file: "client/07-requests-list.png",
      checked: "Общий список заявок заказчика."
    });
    await capture(page, {
      role: "client",
      title: "Отклики по заявке",
      path: "/client/requests",
      file: "client/08-request-responses.png",
      checked: "Отображение откликов помощников внутри заявки.",
      action: async (page) => {
        await scrollToText(page, "Открыть чат по заявке");
      }
    });
    await captureChat(page, {
      role: "client",
      title: "Чат по заявке",
      path: "/client/chats",
      file: "client/09-request-chat.png",
      checked: "Список чатов заказчика и конкретный чат по заявке."
    }, "client");
    await capture(page, {
      role: "client",
      title: "Баланс",
      path: "/client/balance",
      file: "client/10-balance.png",
      checked: "Основной баланс, бонусный баланс, доступно для заявок."
    });
    await capture(page, {
      role: "client",
      title: "Пополнение баланса",
      path: "/client/balance",
      file: "client/11-top-up.png",
      checked: "Блок тестового пополнения и пояснение mock payment.",
      action: async (page) => {
        await scrollToText(page, "Тестовое пополнение");
      }
    });
    await capture(page, {
      role: "client",
      title: "Связь с администратором",
      path: "/client/support",
      file: "client/12-support.png",
      checked: "Форма обращения к администратору и список обращений."
    });
    await capture(page, {
      role: "client",
      title: "Архив заявок / чатов",
      path: "/client/requests/completed",
      file: "client/13-archive.png",
      checked: "Выполненные заявки и архивная история заказчика."
    });
    await capture(page, {
      role: "client",
      title: "Форма отзыва",
      path: "/client/requests/completed",
      file: "client/14-review-form.png",
      checked: "Открытие формы оценки помощника без сохранения отзыва.",
      action: async (page) => {
        const clicked = await clickByRole(page, "button", /Оценить помощника/);
        return clicked ? [] : ["Кнопка “Оценить помощника” не найдена на выполненных заявках."];
      }
    });
    await capture(page, {
      role: "client",
      title: "Помощь / FAQ",
      path: "/client/help",
      file: "client/15-help.png",
      checked: "FAQ заказчика."
    });
    await capture(page, {
      role: "client",
      title: "Согласия и правила",
      path: "/client/consents",
      file: "client/16-consents.png",
      checked: "Согласия и правила сервиса.",
      action: async (page) => {
        const body = await page.locator("body").innerText();
        const problems = [];
        for (const text of ["Согласия и документы", "Принято", "Требуется", "Требуется новая версия"]) {
          if (!body.includes(text)) problems.push(`В блоке согласий заказчика не найден текст: ${text}.`);
        }
        return problems;
      }
    });
  } finally {
    await context.close();
  }
}

async function auditPerformer(browser) {
  const { page, context } = await loginAs(browser, "performer");
  try {
    await capture(page, {
      role: "performer",
      title: "Главная помощника / доступные заявки",
      path: "/performer/requests",
      file: "performer/01-dashboard.png",
      checked: "Доступные заявки, фильтры, соответствие профилю и отсутствие временного блока карты.",
      action: async (page) => {
        const body = await page.locator("body").innerText();
        return /Карта-заглушка|заглушка|демо-карта/i.test(body)
          ? ["На главной помощника найден пользовательский текст временной карты."]
          : [];
      }
    });
    await capture(page, {
      role: "performer",
      title: "Профиль помощника",
      path: "/performer/profile",
      file: "performer/02-profile.png",
      checked: "Рейтинг, статус профиля, выполненные заявки и юридические согласия.",
      action: async (page) => {
        const body = await page.locator("body").innerText();
        const problems = [];
        for (const text of ["Согласия и документы", "Принято", "Требуется", "Требуется новая версия"]) {
          if (!body.includes(text)) problems.push(`В профиле помощника не найден блок или статус: ${text}.`);
        }
        return problems;
      }
    });
    await capture(page, {
      role: "performer",
      title: "Анкета помощника",
      path: "/performer/profile",
      file: "performer/03-questionnaire.png",
      checked: "Поля анкеты помощника.",
      action: async (page) => {
        await scrollToText(page, "Анкета помощника");
      }
    });
    await capture(page, {
      role: "performer",
      title: "Документы / проверки",
      path: "/performer/profile",
      file: "performer/04-documents.png",
      checked: "Карточки самозанятости и справки об отсутствии судимости.",
      action: async (page) => {
        await scrollToText(page, "Проверки и документы");
      }
    });
    await capture(page, {
      role: "performer",
      title: "Доступные заявки",
      path: "/performer/requests",
      file: "performer/05-available-requests.png",
      checked: "Список доступных заявок без временного блока карты."
    });
    await capture(page, {
      role: "performer",
      title: "Карточка заявки для помощника",
      path: "/performer/requests",
      file: "performer/06-request-details.png",
      checked: "Открытие подробных условий заявки для помощника.",
      action: async (page) => {
        const target = page.locator("article.card").filter({ hasText: /ZR-2026-1001|ZR-2026-0901/ }).getByRole("button", { name: /Посмотреть заявку|Открыть условия заявки/ }).first();
        const clicked = await clickFirst(page, target) || await clickByRole(page, "button", /Посмотреть заявку|Открыть условия заявки/);
        if (!clicked) return ["Кнопка открытия условий заявки не найдена."];
        await page.waitForTimeout(500);
        const body = await page.locator("body").innerText();
        const problems = [];
        if (!/Открыть на Яндекс.Картах/.test(body)) problems.push("В карточке помощника до согласования не найдена публичная ссылка на Яндекс.Карты.");
        if (/ул\. Мира,\s*10/.test(body)) problems.push("До перехода в работу помощник видит дом в адресе.");
        problems.push(...await verifyYandexHref(page, {
          label: "Открыть на Яндекс.Картах",
          shouldContain: ["Югорск", "ул. Мира"],
          shouldNotContain: ["10", "15", "подъезд", "этаж", "домофон"]
        }));
        if (problems.some((problem) => /Яндекс|href/i.test(problem))) throw new Error(problems.join(" "));
        return problems;
      }
    });
    await capture(page, {
      role: "performer",
      title: "Почему заявка подходит / не подходит",
      path: "/performer/requests?match=all",
      file: "performer/07-match-explanation.png",
      checked: "Пояснение соответствия заявки профилю помощника."
    });
    await capture(page, {
      role: "performer",
      title: "Отклик на заявку",
      path: "/performer/requests",
      file: "performer/08-response-action.png",
      checked: "Кнопка перехода в чат с заказчиком для согласования условий без отправки нового отклика.",
      action: async (page) => {
        await scrollToText(page, "Перейти в чат с заказчиком");
      }
    });
    await capture(page, {
      role: "performer",
      title: "Список откликов",
      path: "/performer/responses",
      file: "performer/09-responses.png",
      checked: "Группы откликов и кнопка открытия условий заявки."
    });
    await capture(page, {
      role: "performer",
      title: "Карточка заявки в работе для помощника",
      path: "/performer/responses",
      file: "performer/09a-in-work-exact-address.png",
      checked: "Помощник после перехода заявки в работу видит дом и точную ссылку на Яндекс.Карты без квартиры и служебных деталей.",
      action: async (page) => {
        const target = page.locator("article.card").filter({ hasText: /ZR-2026-1006|ZR-2026-0906/ }).getByRole("button", { name: /Открыть условия заявки/ }).first();
        const clicked = await clickFirst(page, target) || await clickFirst(page, page.locator("article.card:has-text('В работе')").getByRole("button", { name: /Открыть условия заявки/ }).first());
        if (!clicked) return ["Не найдена карточка отклика в работе для проверки точного адреса."];
        await page.waitForTimeout(500);
        const body = await page.locator("body").innerText();
        const problems = [];
        if (!/Открыть точный адрес на Яндекс.Картах/.test(body)) problems.push("В карточке заявки в работе не найдена точная ссылка на Яндекс.Карты.");
        if (!/Югорск, ул\. Мира,\s*10/.test(body)) problems.push("После перехода в работу помощник не видит дом в адресе.");
        problems.push(...await verifyYandexHref(page, {
          label: "Открыть точный адрес на Яндекс.Картах",
          shouldContain: ["Югорск", "ул. Мира", "10"],
          shouldNotContain: ["квартира 15", "подъезд 2", "этаж 3", "домофон 15", "вход со двора"]
        }));
        if (problems.some((problem) => /Яндекс|href/i.test(problem))) throw new Error(problems.join(" "));
        return problems;
      }
    });
    await captureChat(page, {
      role: "performer",
      title: "Чат по заявке",
      path: "/performer/chats",
      file: "performer/10-request-chat.png",
      checked: "Список чатов помощника и конкретный чат."
    }, "performer");
    await capture(page, {
      role: "performer",
      title: "Баланс",
      path: "/performer/balance",
      file: "performer/11-balance.png",
      checked: "Баланс помощника и операции."
    });
    await capture(page, {
      role: "performer",
      title: "Связь с администратором",
      path: "/performer/support",
      file: "performer/12-support.png",
      checked: "Форма жалобы или предложения помощника."
    });
    await captureChat(page, {
      role: "performer",
      title: "Архивные чаты",
      path: "/performer/chats",
      file: "performer/13-archived-chats.png",
      checked: "Наличие архивных чатов и статусов."
    }, "performer");
    await capture(page, {
      role: "performer",
      title: "Отзывы",
      path: "/performer/responses",
      file: "performer/14-reviews.png",
      checked: "Проверка доступности отзывов/истории через кабинет помощника."
    });
    await capture(page, {
      role: "performer",
      title: "Помощь / FAQ",
      path: "/performer/help",
      file: "performer/15-help.png",
      checked: "FAQ помощника."
    });
  } finally {
    await context.close();
  }
}

async function auditAdmin(browser) {
  const { page, context } = await loginAs(browser, "admin");
  try {
    await capture(page, {
      role: "admin",
      title: "Панель администратора / главная",
      path: "/admin",
      file: "admin/01-dashboard.png",
      checked: "Dashboard администратора и ключевые показатели."
    });
    await capture(page, {
      role: "admin",
      title: "Пользователи",
      path: "/admin/users",
      file: "admin/02-users.png",
      checked: "Список пользователей, действия, статусы."
    });
    await capture(page, {
      role: "admin",
      title: "Города",
      path: "/admin/cities",
      file: "admin/02a-cities.png",
      checked: "Выпадающий список города, сводка и кнопка экспорта по городу.",
      action: async (page) => {
        const bodyBefore = await page.locator("body").innerText();
        const expectedCities = ["Югорск", "Советский", "Екатеринбург", "Санкт-Петербург", "Москва", "Тюмень", "Волгоград", "Нижний Новгород"];
        const problems = expectedCities.filter((city) => !bodyBefore.includes(city)).map((city) => `Город ${city} не отображается в справочнике.`);
        const select = page.locator("select").first();
        if (!(await select.count())) return [...problems, "В разделе городов не найден выпадающий список."];
        const options = await select.locator("option").evaluateAll((items) => items.map((item) => item.getAttribute("value")).filter(Boolean));
        if (!options[0]) return [...problems, "В списке городов нет доступных значений."];
        await select.selectOption(String(options[0]));
        await clickByRole(page, "button", /Показать информацию/);
        await page.waitForTimeout(500);
        const hasExport = await page.getByRole("button", { name: /Экспорт по городу в Excel/ }).count();
        const bodyAfter = await page.locator("body").innerText();
        if (!/Тарифная зона/.test(bodyAfter)) problems.push("В сводке города не показана тарифная зона.");
        if (!/будущих отдельных тарифов/.test(bodyAfter)) problems.push("В сводке города не найдено пояснение про будущие тарифы.");
        if (!hasExport) problems.push("Не найдена кнопка “Экспорт по городу в Excel”.");
        return problems;
      }
    });
    await capture(page, {
      role: "admin",
      title: "Заказчики",
      path: "/admin/clients",
      file: "admin/03-clients.png",
      checked: "Фильтр/раздел заказчиков."
    });
    await capture(page, {
      role: "admin",
      title: "Помощники",
      path: "/admin/performers",
      file: "admin/04-performers.png",
      checked: "Список помощников и статусы проверок."
    });
    await capture(page, {
      role: "admin",
      title: "Профиль пользователя",
      path: "/admin/users",
      file: "admin/05-user-profile.png",
      checked: "Открытие профиля пользователя по имени.",
      action: async (page) => {
        const clicked = await clickFirst(page, page.locator(".data-row .link-button").first());
        if (!clicked) return ["Не найдено кликабельное имя пользователя."];
        await page.waitForTimeout(500);
        const body = await page.locator("body").innerText();
        const problems = [];
        for (const text of ["Юридические согласия", "Скачать согласия пользователя Excel", "Скачать полный legal-архив пользователя ZIP"]) {
          if (!body.includes(text)) problems.push(`В карточке пользователя не найден текст: ${text}.`);
        }
        return problems;
      }
    });
    await capture(page, {
      role: "admin",
      title: "Заявки",
      path: "/admin/requests",
      file: "admin/06-requests.png",
      checked: "Список заявок, заказчики, статусы, номера заявок и экспорт заявок.",
      action: async (page) => {
        const hasExport = await page.getByRole("button", { name: /Экспорт заявок в Excel/ }).count();
        return hasExport ? [] : ["Не найдена кнопка “Экспорт заявок в Excel”."];
      }
    });
    await capture(page, {
      role: "admin",
      title: "Карточка заявки",
      path: "/admin/requests",
      file: "admin/07-request-card.png",
      checked: "Открытие подробной информации заявки по номеру.",
      action: async (page) => {
        const target = page.locator(".data-row").filter({ hasText: /ZR-2026-1006|ZR-2026-0906/ }).locator(".link-button").first();
        const clicked = await clickFirst(page, target) || await clickFirst(page, page.locator(".data-row .link-button").first());
        if (!clicked) return ["Не найден кликабельный номер заявки."];
        await page.waitForTimeout(500);
        const body = await page.locator("body").innerText();
        const problems = [];
        if (!/Полный адрес/.test(body) || !/Публичный адрес/.test(body)) problems.push("В карточке заявки администратора не показаны полный и публичный адреса.");
        if (!/Открыть на Яндекс.Картах/.test(body) || !/Открыть точный адрес на Яндекс.Картах/.test(body)) problems.push("В карточке заявки администратора не найдены обе ссылки на Яндекс.Карты.");
        problems.push(...await verifyYandexHref(page, {
          label: "Открыть на Яндекс.Картах",
          shouldContain: ["Югорск", "ул. Мира"],
          shouldNotContain: ["10", "15", "подъезд", "этаж", "домофон"]
        }));
        problems.push(...await verifyYandexHref(page, {
          label: "Открыть точный адрес на Яндекс.Картах",
          shouldContain: ["Югорск", "ул. Мира", "10"],
          shouldNotContain: ["квартира 15", "подъезд 2", "этаж 3", "домофон 15", "вход со двора"]
        }));
        if (problems.some((problem) => /Яндекс|href/i.test(problem))) throw new Error(problems.join(" "));
        return problems;
      }
    });
    await capture(page, {
      role: "admin",
      title: "Отклики",
      path: "/admin/responses",
      file: "admin/08-responses.png",
      checked: "Отклики с номером заявки, заказчиком, помощником, подбором и экспортом.",
      action: async (page) => {
        const hasExport = await page.getByRole("button", { name: /Экспорт откликов в Excel/ }).count();
        return hasExport ? [] : ["Не найдена кнопка “Экспорт откликов в Excel”."];
      }
    });
    await capture(page, {
      role: "admin",
      title: "Подбор заказчик / помощник",
      path: "/admin/responses",
      file: "admin/09-match-details.png",
      checked: "Модальное окно сопоставления данных заказчика и помощника.",
      action: async (page) => {
        const clicked = await clickByRole(page, "button", /Подбор/);
        if (!clicked) return ["Кнопка “Подбор” не найдена."];
        await page.waitForTimeout(500);
        return [];
      }
    });
    await captureChat(page, {
      role: "admin",
      title: "Чаты по заявкам",
      path: "/admin/chats",
      file: "admin/10-request-chats.png",
      checked: "Список чатов, поиск, выбранный чат."
    }, "admin");
    await capture(page, {
      role: "admin",
      title: "Обращения к администратору",
      path: "/admin/support",
      file: "admin/11-support.png",
      checked: "Обращения, переходы в чат, статусы."
    });
    await captureChat(page, {
      role: "admin",
      title: "Флагованные сообщения",
      path: "/admin/chats",
      file: "admin/12-flagged-messages.png",
      checked: "Проверка отображения флагованных сообщений и кнопки удаления сообщения в админском чате.",
      action: async (page) => {
        const hasDelete = await page.getByRole("button", { name: /Удалить/ }).count();
        return hasDelete ? [] : ["В админском чате не найдена кнопка удаления сообщения."];
      }
    }, "admin");
    await capture(page, {
      role: "admin",
      title: "Балансы пользователей",
      path: "/admin/balances",
      file: "admin/13-balances.png",
      checked: "Список пользователей и общий баланс."
    });
    await capture(page, {
      role: "admin",
      title: "История операций",
      path: "/admin/balances",
      file: "admin/14-balance-history.png",
      checked: "Раскрытие истории списаний и начислений пользователя.",
      action: async (page) => {
        const clicked = await clickFirst(page, page.locator(".balance-group .data-row--button").first());
        if (!clicked) return ["Не найден пользователь для раскрытия истории баланса."];
        await page.waitForTimeout(500);
        return [];
      }
    });
    await capture(page, {
      role: "admin",
      title: "Бонусное начисление",
      path: "/admin/bonuses",
      file: "admin/15-bonus-grant.png",
      checked: "Форма начисления бонусного баланса."
    });
    await capture(page, {
      role: "admin",
      title: "Категории",
      path: "/admin/categories",
      file: "admin/16-categories.png",
      checked: "Список категорий, статусы активности, кнопки включения/выключения."
    });
    await capture(page, {
      role: "admin",
      title: "Настройки сервиса",
      path: "/admin/settings",
      file: "admin/17-settings.png",
      checked: "Редактируемые настройки сервиса с переключателями Да/Нет вместо true/false.",
      action: async (page) => {
        const body = await page.locator("body").innerText();
        return /\btrue\b|\bfalse\b/.test(body) ? ["В настройках видны true/false вместо Да/Нет."] : [];
      }
    });
    await capture(page, {
      role: "admin",
      title: "База знаний",
      path: "/admin/knowledge",
      file: "admin/18-knowledge.png",
      checked: "Управление статьями базы знаний, статус справа и изменение порядка.",
      action: async (page) => {
        const hasStatus = await page.locator(".knowledge-title-row").count();
        const clicked = await clickByRole(page, "button", /Изменить порядок/);
        await page.waitForTimeout(400);
        const hasOrderSelect = await page.getByLabel(/Позиция в списке/).count();
        const errors = [];
        if (!hasStatus) errors.push("Не найден компактный статус статьи справа от заголовка.");
        if (!clicked || !hasOrderSelect) errors.push("Не найдено управление порядком статьи.");
        return errors;
      }
    });
    await capture(page, {
      role: "admin",
      title: "Юридические документы",
      path: "/admin/legal",
      expectedPath: "/admin/legal",
      file: "admin/19-legal-documents.png",
      checked: "Админский раздел юридических документов, согласий и экспортов.",
      action: async (page) => {
        await clickByRole(page, "button", /Выгрузки/);
        await page.waitForTimeout(300);
        const body = await page.locator("body").innerText();
        const problems = [];
        for (const text of ["Юридические документы", "Документы", "Согласия пользователей", "Выгрузки", "Экспорт всех согласий в Excel", "Скачать полный legal-архив ZIP"]) {
          if (!body.includes(text)) problems.push(`В legal-разделе не найден текст: ${text}.`);
        }
        return problems;
      }
    });
    await capture(page, {
      role: "admin",
      title: "Архив",
      path: "/admin/archive",
      file: "admin/20-archive.png",
      checked: "Общий архив администратора."
    });
    await capture(page, {
      role: "admin",
      title: "Audit log",
      path: "/admin/audit",
      expectedPath: "/admin/audit",
      optional: true,
      file: "admin/21-audit-log.png",
      checked: "Проверка наличия отдельного audit log, если он реализован."
    });
  } finally {
    await context.close();
  }
}

async function loginAs(browser, role) {
  const { page, context } = await newTrackedPage(browser, role);
  const user = credentials[role];
  const loginRecord = await capture(page, {
    role,
    title: "Вход",
    path: "/",
    file: `${role}/00-login.png`,
    checked: `Форма входа для роли ${role}.`,
    action: async (page) => {
      await fillLoginForm(page, user.email, user.password);
    }
  });

  try {
    await page.locator("form.auth-panel button.primary-button").click();
    await page.waitForURL((url) => url.pathname.startsWith(user.defaultPath), { timeout: 12000 });
    await settle(page);
  } catch (error) {
    loginRecord.opened = false;
    loginRecord.errors.push(`Не удалось войти под ${user.email}: ${messageOf(error)}`);
  }

  return { page, context };
}

async function newTrackedPage(browser, role) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "ru-RU"
  });
  const page = await createTrackedPage(context, role);
  return { context, page };
}

async function createTrackedPage(context, role) {
  const page = await context.newPage();
  page.__auditContext = context;
  page.__auditRole = role;
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push({
        role,
        url: page.url(),
        text: message.text(),
        location: message.location()
      });
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push({
      role,
      url: page.url(),
      text: messageOf(error),
      location: null
    });
  });
  page.on("requestfailed", (request) => {
    networkErrors.push({
      role,
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText ?? "request failed",
      pageUrl: page.url()
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      networkErrors.push({
        role,
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        statusText: response.statusText(),
        pageUrl: page.url()
      });
    }
  });
  return page;
}

async function captureChat(page, screen, role) {
  await capture(page, {
    ...screen,
    action: async (page) => {
      const problems = [];
      const clicked = await clickFirst(page, page.locator(".side-list button, .side-list__item").first());
      if (!clicked) {
        problems.push("В списке чатов нет доступного чата для открытия.");
      } else {
        await page.waitForTimeout(700);
        const url = new URL(page.url());
        if (!url.pathname.startsWith(`/${role}/chats/`)) {
          problems.push("После выбора чат не открыл URL конкретного чата.");
        }
      }
      if (screen.action) {
        const extraProblems = await screen.action(page);
        if (Array.isArray(extraProblems)) problems.push(...extraProblems);
      }
      return problems;
    }
  });
}

async function capture(page, screen) {
  const screenshotPath = path.join(SCREENSHOT_DIR, screen.file);
  const result = {
    role: screen.role,
    title: screen.title,
    route: `${BASE_URL}${screen.path}`,
    screenshot: path.relative(ROOT, screenshotPath),
    errorScreenshot: "",
    checked: screen.checked,
    opened: false,
    optional: Boolean(screen.optional),
    errors: [],
    noticeableProblems: []
  };
  results.push(result);

  try {
    page = await ensurePage(page);
    await page.goto(`${BASE_URL}${screen.path}`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await settle(page);
    if (screen.action) {
      const actionProblems = await screen.action(page);
      if (Array.isArray(actionProblems)) result.noticeableProblems.push(...actionProblems);
      await settle(page);
    }

    const actualPath = new URL(page.url()).pathname;
    if (screen.expectedPath && actualPath !== screen.expectedPath) {
      const message = `Ожидался маршрут ${screen.expectedPath}, открыт ${actualPath}.`;
      if (screen.optional) {
        result.noticeableProblems.push(`Опциональный экран не доступен: ${message}`);
      } else {
        result.errors.push(message);
      }
    }

    result.noticeableProblems.push(...await obviousProblems(page));
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    screenshotCount += 1;
    result.opened = result.errors.length === 0;
    if (result.errors.length > 0) {
      await saveErrorScreenshot(page, result);
    }
  } catch (error) {
    result.errors.push(messageOf(error));
    try {
      page = await ensurePage(page);
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      screenshotCount += 1;
      await saveErrorScreenshot(page, result);
    } catch (screenshotError) {
      result.errors.push(`Не удалось сохранить скриншот: ${messageOf(screenshotError)}`);
      result.screenshot = "";
    }
  }

  return result;
}

async function ensurePage(page) {
  if (!page.isClosed()) return page;
  const context = page.__auditContext;
  const role = page.__auditRole ?? "unknown";
  if (!context) throw new Error("Страница закрыта, context для восстановления не найден.");
  return createTrackedPage(context, role);
}

async function saveErrorScreenshot(page, result) {
  if (page.isClosed()) return;
  const fileName = `${String(results.indexOf(result) + 1).padStart(2, "0")}-${result.role}-${slugify(result.title)}.png`;
  const errorPath = path.join(ERROR_SCREENSHOT_DIR, fileName);
  await mkdir(path.dirname(errorPath), { recursive: true });
  await page.screenshot({ path: errorPath, fullPage: true });
  result.errorScreenshot = path.relative(ROOT, errorPath);
  errorScreenshotCount += 1;
}

async function fillLoginForm(page, email, password) {
  await clickByRole(page, "button", /^Войти$/);
  await fillControl(page, "Телефон или email", email);
  await fillControl(page, "Пароль", password);
}

async function fillClientRequestDraft(page) {
  await selectFirstValue(page, "Город");
  await selectOptionContaining(page, "Категория", "Помощь по дому");
  await selectValueByLabel(page, "Кому нужна помощь", "elderly");
  await fillControl(page, "Коротко опишите, какая помощь нужна", "Помощь с уборкой и приготовлением еды");
  await fillControl(page, "Улица", "ул. Мира");
  await fillControl(page, "Дом", "1");
  await fillControl(page, "Квартира", "15");
  await fillControl(page, "Подъезд", "2");
  await fillControl(page, "Этаж", "3");
  await fillControl(page, "Домофон", "15");
  await fillControl(page, "Комментарий к адресу", "Ориентир рядом с остановкой");
  await fillControl(page, "Район или ориентир", "Центр");
  await fillControl(page, "Описание", "Нужна бытовая помощь, лёгкая уборка и приготовление простой еды.");
  await checkFirst(page, "лёгкая уборка");
  await checkFirst(page, "простая еда");
  await fillControl(page, "Возраст подопечного", "72");
  await selectValueByLabel(page, "График помощи", "once");
  await fillControl(page, "Дата", futureDate());
  await fillControl(page, "С", "10:00");
  await fillControl(page, "До", "12:00");
  await fillControl(page, "Длительность, часов", "2");
}

async function fillControl(page, labelText, value) {
  const control = labelControl(page, labelText, "input, textarea, select");
  if ((await control.count()) === 0) return false;
  await control.fill(value);
  return true;
}

async function selectValueByLabel(page, labelText, value) {
  const select = labelControl(page, labelText, "select");
  if ((await select.count()) === 0) return false;
  await select.selectOption(value).catch(() => null);
  return true;
}

async function selectFirstValue(page, labelText) {
  const select = labelControl(page, labelText, "select");
  if ((await select.count()) === 0) return false;
  const value = await select.locator("option").evaluateAll((options) => {
    const option = options.find((item) => item.value);
    return option?.value ?? "";
  });
  if (!value) return false;
  await select.selectOption(value);
  return true;
}

async function selectOptionContaining(page, labelText, optionText) {
  const select = labelControl(page, labelText, "select");
  if ((await select.count()) === 0) return false;
  const value = await select.locator("option").evaluateAll((options, text) => {
    const option = options.find((item) => item.textContent?.includes(String(text)));
    return option?.value ?? "";
  }, optionText);
  if (!value) return selectFirstValue(page, labelText);
  await select.selectOption(value);
  return true;
}

function labelControl(page, labelText, selector) {
  if (labelText.length <= 3) {
    return page.locator("label").filter({ hasText: new RegExp(`^\\s*${escapeRegex(labelText)}\\s*$`) }).locator(selector).first();
  }
  return page.locator(`label:has-text("${labelText}")`).locator(selector).first();
}

async function checkFirst(page, text) {
  const checkbox = page.locator(`label:has-text("${text}") input[type="checkbox"]`).first();
  if ((await checkbox.count()) === 0) return false;
  if (!(await checkbox.isChecked())) await checkbox.check();
  return true;
}

async function clickByRole(page, role, name) {
  return clickFirst(page, page.getByRole(role, { name }).first());
}

async function clickFirst(page, locator) {
  try {
    if ((await locator.count()) === 0) return false;
    await locator.click({ timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function scrollToText(page, text) {
  const locator = page.getByText(text, { exact: false }).first();
  if ((await locator.count()) === 0) return false;
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  return true;
}

async function readPriceAmount(page) {
  const text = await page.locator(".price-summary strong").first().innerText({ timeout: 2000 }).catch(() => "");
  const match = text.match(/\d+/);
  return match?.[0] ?? "";
}

async function verifyYandexHref(page, { label, shouldContain = [], shouldNotContain = [] }) {
  const problems = [];
  const link = page.getByRole("link", { name: label }).first();
  if ((await link.count()) === 0) {
    return [`Не найдена ссылка “${label}” для проверки href Яндекс.Карт.`];
  }
  const href = await link.getAttribute("href");
  if (!href) return [`У ссылки “${label}” нет href.`];
  if (!href.startsWith("https://yandex.ru/maps/?text=")) {
    problems.push(`href ссылки “${label}” не начинается с https://yandex.ru/maps/?text=`);
  }

  let decodedHref = "";
  try {
    decodedHref = decodeURIComponent(href);
  } catch {
    problems.push(`href ссылки “${label}” не удалось декодировать.`);
  }

  for (const expected of shouldContain) {
    if (!decodedHref.includes(expected)) {
      problems.push(`href ссылки “${label}” не содержит “${expected}”.`);
    }
  }
  for (const forbidden of shouldNotContain) {
    if (decodedHref.toLowerCase().includes(String(forbidden).toLowerCase())) {
      problems.push(`href ссылки “${label}” содержит скрытую деталь адреса “${forbidden}”.`);
    }
  }
  return problems;
}

async function settle(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => null);
  await page.waitForTimeout(400);
}

async function obviousProblems(page) {
  const problems = [];
  const body = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  if (!body.trim()) problems.push("Экран пустой.");
  if (/Внутренняя ошибка сервера|Unhandled|Cannot read|NetworkError/i.test(body)) {
    problems.push("На экране виден текст ошибки.");
  }
  if (/Загрузка$/.test(body.trim())) {
    problems.push("Экран остался в состоянии загрузки.");
  }
  const visibleBody = body
    .replace(/client@zabota\.local/gi, "")
    .replace(/performer@zabota\.local/gi, "");
  if (/комисси/i.test(visibleBody)) {
    problems.push("В пользовательском интерфейсе найдено слово “комиссия”; используйте термин “сервисный сбор”.");
  }
  if (/(^|[^а-яё])клиент|Клиент|исполнител|Исполнител/i.test(visibleBody)) {
    problems.push("В пользовательском интерфейсе найден старый публичный термин “клиент/исполнитель”; используйте “заказчик/помощник”.");
  }
  return problems;
}

function futureDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

async function writeArtifacts() {
  archiveCompleteness = await buildArchiveCompleteness();
  await writeFile(CONSOLE_ERRORS_PATH, JSON.stringify(consoleErrors, null, 2), "utf8");
  await writeFile(NETWORK_ERRORS_PATH, JSON.stringify(networkErrors, null, 2), "utf8");
  await writeFile(REPORT_PATH, reportMarkdown(), "utf8");
}

function reportMarkdown() {
  const failed = results.filter((item) => !item.opened);
  const successful = results.filter((item) => item.opened);
  const lines = [
    "# Visual Audit Report",
    "",
    `Дата: ${new Date().toLocaleString("ru-RU")}`,
    `Base URL: ${BASE_URL}`,
    `Скриншотов создано: ${screenshotCount}`,
    `Error screenshots: ${errorScreenshotCount}`,
    `Экранов проверено: ${results.length}`,
    `Экранов успешно открыто: ${successful.length}`,
    `Не удалось открыть: ${failed.length}`,
    "",
    "## Итог",
    "",
    failed.length === 0
      ? "Все сценарии открылись без критических ошибок маршрута."
      : failed.map((item) => `- ${item.role}: ${item.title} — ${item.errors.join("; ")}`).join("\n"),
    "",
    "## Проверка полноты архива",
    "",
    `- Записей экранов в отчёте: ${archiveCompleteness?.reportEntries ?? results.length}`,
    `- Обычных PNG по отчёту найдено: ${archiveCompleteness?.regularScreenshotsFound ?? 0}`,
    `- Error PNG найдено: ${archiveCompleteness?.errorScreenshotsFound ?? 0}`,
    `- Всего PNG реально найдено: ${archiveCompleteness?.totalPngFound ?? 0}`,
    `- Успешно открыто экранов: ${successful.length}`,
    `- Не удалось открыть экранов: ${failed.length}`,
    `- Полностью проверенные роли: ${archiveCompleteness?.completeRoles.join(", ") || "нет"}`,
    `- Неполностью проверенные роли: ${archiveCompleteness?.incompleteRoles.join(", ") || "нет"}`,
    `- Отсутствующие PNG из отчёта: ${archiveCompleteness?.missingScreenshots.length ? archiveCompleteness.missingScreenshots.join(", ") : "нет"}`,
    "",
    "## Экраны",
    ""
  ];

  for (const item of results) {
    lines.push(`### ${item.role} — ${item.title}`);
    lines.push("");
    lines.push(`- URL / маршрут: ${item.route}`);
    lines.push(`- Файл скриншота: ${item.screenshot || "не сохранён"}`);
    if (item.errorScreenshot) lines.push(`- Error screenshot: ${item.errorScreenshot}`);
    lines.push(`- Что проверялось: ${item.checked}`);
    lines.push(`- Удалось открыть экран: ${item.opened ? "да" : "нет"}`);
    lines.push(`- Ошибки: ${item.errors.length ? item.errors.join("; ") : "нет"}`);
    lines.push(`- Заметные проблемы: ${item.noticeableProblems.length ? item.noticeableProblems.join("; ") : "не отмечены"}`);
    lines.push("");
  }

  lines.push("## Диагностика");
  lines.push("");
  lines.push(`- Console errors: ${path.relative(ROOT, CONSOLE_ERRORS_PATH)}`);
  lines.push(`- Network errors: ${path.relative(ROOT, NETWORK_ERRORS_PATH)}`);
  lines.push("");
  return lines.join("\n");
}

function printSummary() {
  const failed = results.filter((item) => !item.opened);
  console.log(`Visual audit completed.`);
  console.log(`Screenshots: ${screenshotCount}`);
  console.log(`Error screenshots: ${errorScreenshotCount}`);
  console.log(`PNG files found: ${archiveCompleteness?.totalPngFound ?? 0}`);
  console.log(`Report: ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(`Console errors: ${consoleErrors.length}`);
  console.log(`Network errors: ${networkErrors.length}`);
  if (failed.length > 0) {
    console.log("Screens not opened:");
    for (const item of failed) {
      console.log(`- ${item.role}: ${item.title}`);
    }
  } else {
    console.log("Screens not opened: 0");
  }
}

async function buildArchiveCompleteness() {
  const pngFiles = await listPngFiles(SCREENSHOT_DIR);
  const pngSet = new Set(pngFiles.map((file) => path.relative(ROOT, file)));
  const expectedScreenshots = results.filter((item) => item.screenshot);
  const missingScreenshots = [];
  for (const item of expectedScreenshots) {
    if (!pngSet.has(item.screenshot)) {
      missingScreenshots.push(item.screenshot);
    }
  }

  const roleSummaries = roles.map((role) => {
    const roleResults = results.filter((item) => item.role === role && !item.optional);
    const complete = roleResults.length > 0 && roleResults.every((item) => item.opened && item.screenshot && pngSet.has(item.screenshot));
    return { role, complete };
  });

  return {
    reportEntries: results.length,
    regularScreenshotsFound: expectedScreenshots.length - missingScreenshots.length,
    errorScreenshotsFound: pngFiles.filter((file) => path.relative(ROOT, file).startsWith("visual-audit/screenshots/errors/")).length,
    totalPngFound: pngFiles.length,
    missingScreenshots,
    completeRoles: roleSummaries.filter((item) => item.complete).map((item) => item.role),
    incompleteRoles: roleSummaries.filter((item) => !item.complete).map((item) => item.role)
  };
}

async function listPngFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listPngFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".png")) {
      files.push(fullPath);
    }
  }
  return files;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "screen";
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch(async (error) => {
  results.push({
    role: "system",
    title: "Непредвиденная ошибка visual audit",
    route: BASE_URL,
    screenshot: "",
    checked: "Глобальное выполнение сценария.",
    opened: false,
    errors: [messageOf(error)],
    noticeableProblems: []
  });
  await writeArtifacts().catch(() => null);
  console.error(error);
  process.exit(1);
});
