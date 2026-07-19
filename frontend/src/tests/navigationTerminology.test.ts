import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPublicAddressFromRequest,
  buildYandexExactAddressFromRequest,
  buildYandexMapsSearchUrl
} from "../utils/address";
import {
  adminNavigation,
  canRoleOpenPath,
  chatPathForRole,
  clientNavigation,
  defaultPathForRole,
  isKnownPathForRole,
  legacyAppRedirectPath,
  performerNavigation,
  sectionTitleForPath
} from "../routes/navigation";
import { formatDateRu, formatTimeRu, parseDateRu } from "../utils/dateTime";

const sourceRoot = fileURLToPath(new URL("..", import.meta.url));

function walkFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return walkFiles(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

function read(relativePath: string) {
  return readFileSync(join(sourceRoot, relativePath), "utf8");
}

const clientPaths = [
  "/app/client/requests",
  "/app/client/requests/completed",
  "/app/client/requests/new",
  "/app/client/balance",
  "/app/client/chats",
  "/app/client/chats/chat-1",
  "/app/client/profile",
  "/app/client/support",
  "/app/client/help",
  "/app/client/consents"
];

const performerPaths = [
  "/app/performer/requests",
  "/app/performer/responses",
  "/app/performer/balance",
  "/app/performer/chats",
  "/app/performer/chats/chat-1",
  "/app/performer/profile",
  "/app/performer/support",
  "/app/performer/help"
];

const adminPaths = [
  "/app/admin",
  "/app/admin/cities",
  "/app/admin/users",
  "/app/admin/clients",
  "/app/admin/performers",
  "/app/admin/requests",
  "/app/admin/responses",
  "/app/admin/chats",
  "/app/admin/chats/chat-1",
  "/app/admin/support",
  "/app/admin/balances",
  "/app/admin/payments",
  "/app/admin/bonuses",
  "/app/admin/blocked",
  "/app/admin/categories",
  "/app/admin/legal",
  "/app/admin/archive",
  "/app/admin/settings",
  "/app/admin/knowledge"
];

for (const path of clientPaths) {
  assert.equal(isKnownPathForRole("client", path), true, `client direct URL: ${path}`);
  assert.equal(canRoleOpenPath("client", path), true, `client can open own URL: ${path}`);
}

for (const path of performerPaths) {
  assert.equal(isKnownPathForRole("performer", path), true, `performer direct URL: ${path}`);
  assert.equal(canRoleOpenPath("performer", path), true, `performer can open own URL: ${path}`);
}

for (const path of adminPaths) {
  assert.equal(isKnownPathForRole("admin", path), true, `admin direct URL: ${path}`);
  assert.equal(canRoleOpenPath("admin", path), true, `admin can open own URL: ${path}`);
  assert.equal(canRoleOpenPath("superadmin", path), true, `superadmin can open admin URL: ${path}`);
}

assert.equal(defaultPathForRole("client"), "/app/client/requests");
assert.equal(defaultPathForRole("performer"), "/app/performer/requests");
assert.equal(defaultPathForRole("admin"), "/app/admin");
assert.equal(defaultPathForRole("superadmin"), "/app/admin");

assert.equal(canRoleOpenPath("client", "/app/admin"), false);
assert.equal(canRoleOpenPath("client", "/app/performer/requests"), false);
assert.equal(canRoleOpenPath("performer", "/app/client/requests"), false);
assert.equal(canRoleOpenPath("admin", "/app/client/requests"), false);
assert.equal(isKnownPathForRole("client", "/app/client/unknown"), false);
assert.equal(isKnownPathForRole("admin", "/app/admin/unknown"), false);

assert.equal(sectionTitleForPath("/app/client/requests/completed", clientNavigation), "Выполненные");
assert.equal(sectionTitleForPath("/app/performer/chats/chat-1", performerNavigation), "Чаты");
assert.equal(sectionTitleForPath("/app/admin/chats/chat-1", adminNavigation), "Чаты");
assert.equal(chatPathForRole("client", "chat-1"), "/app/client/chats/chat-1");
assert.equal(chatPathForRole("performer", "chat-1"), "/app/performer/chats/chat-1");
assert.equal(chatPathForRole("admin", "chat-1"), "/app/admin/chats/chat-1");
assert.equal(legacyAppRedirectPath("/client/requests"), "/app/client/requests");
assert.equal(legacyAppRedirectPath("/performer/requests"), "/app/performer/requests");
assert.equal(legacyAppRedirectPath("/admin"), "/app/admin");
assert.equal(legacyAppRedirectPath("/admin/payments"), "/app/admin/payments");

const appLayout = read("components/AppLayout.tsx");
assert.match(appLayout, /logout\(\);/);
assert.match(appLayout, /navigate\("\/app", \{ replace: true \}\)/);

const clientDashboard = read("pages/ClientDashboard.tsx");
assert.match(clientDashboard, /navigate\(chatPathForRole\("client", result\.chat\.id\)\)/);
assert.match(clientDashboard, /navigate\("\/app\/client\/requests"\)/);

const performerDashboard = read("pages/PerformerDashboard.tsx");
assert.match(performerDashboard, /navigate\("\/app\/performer\/responses"\)/);
assert.match(performerDashboard, /chatPathForRole\("performer", chat\.id\)/);
assert.doesNotMatch(performerDashboard, /MapPreview/);
assert.doesNotMatch(performerDashboard, /Карта-заглушка|заглушка|демо-карта/i);
assert.doesNotMatch(performerDashboard, /yandexExactMapAddress\s*\?\?\s*request\.fullAddress/);
assert.doesNotMatch(performerDashboard, /yandexPublicMapAddress\s*\?\?\s*request\.approximateAddressText/);

const chatPanel = read("components/ChatPanel.tsx");
assert.doesNotMatch(chatPanel, /50\s*₽/);
assert.match(chatPanel, /Согласованная оплата за визит/);
assert.match(chatPanel, /Сервисный сбор заказчика/);
assert.match(chatPanel, /Сервисный сбор помощника/);

const priceSummary = read("components/PriceSummary.tsx");
assert.match(priceSummary, /Рекомендуемая стоимость визита/);
assert.match(priceSummary, /Рекомендуемая оплата помощнику/);
assert.match(priceSummary, /Ориентировочные общие расходы/);
assert.match(priceSummary, /Ориентировочный доход после сервисного сбора/);
assert.doesNotMatch(priceSummary, /комисси/i);

assert.equal(formatDateRu("2026-07-25"), "25.07.2026");
assert.equal(formatDateRu("2026-07-25T00:00:00.000Z"), "25.07.2026");
assert.equal(parseDateRu("25.07.2026"), "2026-07-25");
assert.equal(formatTimeRu("10:00"), "10:00");
assert.equal(formatTimeRu("12:00"), "12:00");
assert.equal(buildPublicAddressFromRequest({ addressCity: "Югорск", addressStreet: "ул. Мира", addressHouse: "10" }), "Югорск, ул. Мира");
assert.equal(buildYandexExactAddressFromRequest({ addressCity: "Югорск", addressStreet: "ул. Мира", addressHouse: "10" }), "Югорск, ул. Мира, 10");
assert.equal(buildYandexMapsSearchUrl("Югорск, ул. Мира, 10"), `https://yandex.ru/maps/?text=${encodeURIComponent("Югорск, ул. Мира, 10")}`);

assert.match(clientDashboard, /Укажите дом\./);
assert.match(clientDashboard, /Формат даты: дд\.мм\.гггг/);
assert.match(clientDashboard, /Формат времени: 10:00/);

const adminDashboard = read("pages/AdminDashboard.tsx");
assert.match(adminDashboard, /Тарифная зона/);
assert.match(adminDashboard, /AdminPaymentsPage/);
assert.match(adminDashboard, /Юридические документы/);
assert.match(adminDashboard, /Экспорт всех согласий в Excel/);
assert.match(adminDashboard, /Скачать полный legal-архив ZIP/);
assert.match(adminDashboard, /Скачать полный legal-архив пользователя ZIP/);
assert.match(adminDashboard, /Документы/);
assert.match(adminDashboard, /Согласия пользователей/);
assert.match(adminDashboard, /Выгрузки/);
assert.match(adminDashboard, /Используется для будущих отдельных тарифов и расчётов по городам\./);
assert.doesNotMatch(adminDashboard, /Зона тарифов/);
assert.doesNotMatch(adminDashboard, /yandexExactMapAddress\s*\?\?\s*request\.fullAddress/);
assert.doesNotMatch(adminDashboard, /yandexPublicMapAddress\s*\?\?\s*request\.approximateAddressText/);

const requestCard = read("components/RequestCard.tsx");
assert.doesNotMatch(requestCard, /yandexExactMapAddress\s*\?\?\s*request\.fullAddress/);
assert.doesNotMatch(requestCard, /yandexPublicMapAddress\s*\?\?\s*request\.approximateAddressText/);

const landingAuth = read("pages/LandingAuthPage.tsx");
assert.match(landingAuth, /Телефон или email/);
assert.match(landingAuth, /Можно войти по номеру телефона или email/);
assert.match(landingAuth, /Забыли пароль\?/);
assert.match(landingAuth, /Повторите пароль/);
assert.match(landingAuth, /Пароли не совпадают/);
assert.match(landingAuth, /Необязательно\. Можно добавить позже в профиле\./);
assert.match(landingAuth, /Желательно указать для связи и восстановления доступа\. Можно добавить позже\./);
assert.match(landingAuth, /Принимаю пользовательское соглашение заказчика/);
assert.match(landingAuth, /Принимаю условия использования сервиса помощником/);
assert.match(landingAuth, /Хочу получать информационные сообщения/);

const consentPanel = read("components/ConsentDocumentsPanel.tsx");
assert.match(consentPanel, /Принять обязательные документы/);
assert.match(consentPanel, /Требуется новая версия/);

const app = read("App.tsx");
assert.match(app, /path="\/app"/);
assert.match(app, /<LandingAuthPage \/>/);
assert.match(app, /path="\/forgot-password"/);
assert.match(app, /path="\/legal"/);
assert.match(app, /path="\/app\/client\/\*"/);
assert.match(app, /path="\/app\/performer\/\*"/);
assert.match(app, /path="\/app\/admin\/\*"/);
assert.match(app, /path="\/client\/\*"/);
assert.match(app, /path="\/performer\/\*"/);
assert.match(app, /path="\/admin\/\*"/);
assert.match(app, /path="\/app\/balance\/mock-payment"/);
assert.match(app, /path="\/app\/balance\/payment-success"/);
assert.match(app, /path="\/app\/balance\/payment-fail"/);
assert.match(app, /path="\/app\/balance\/payment-pending"/);

const paymentRoutePages = read("pages/PaymentPages.tsx");
assert.match(paymentRoutePages, /return "\/app\/client\/balance"/);
assert.match(paymentRoutePages, /return "\/app\/performer\/balance"/);
assert.match(paymentRoutePages, /return "\/app\/admin\/balances"/);
assert.match(paymentRoutePages, /return "\/app"/);

const viteConfig = read("../vite.config.ts");
assert.match(viteConfig, /base:\s*"\/app\/"/);

const distIndexPath = join(sourceRoot, "../dist/index.html");
if (existsSync(distIndexPath)) {
  const distIndex = readFileSync(distIndexPath, "utf8");
  assert.match(distIndex, /\/app\/assets\//);
  assert.doesNotMatch(distIndex, /["']\/assets\//);
}

const balancePanel = read("components/BalancePanel.tsx");
assert.match(balancePanel, /Пополнить баланс/);
assert.match(balancePanel, /Перейти к оплате/);
assert.match(balancePanel, /История пополнений/);
assert.match(balancePanel, /платёжная форма банка или тестовая платёжная форма/);
assert.match(balancePanel, /Сервис не хранит данные банковских карт/);
assert.match(balancePanel, /createTopUpPayment/);
assert.match(balancePanel, /getMyPayments/);
assert.doesNotMatch(balancePanel, /mockTopUp/);
assert.doesNotMatch(balancePanel, /Пополнить тестово/);
assert.doesNotMatch(balancePanel, /Тестовое пополнение/);

const paymentPages = read("pages/PaymentPages.tsx");
assert.match(paymentPages, /Тестовая платёжная форма/);
assert.match(paymentPages, /Оплатить тестово/);
assert.match(paymentPages, /Отменить платёж/);
assert.match(paymentPages, /Платёж принят/);
assert.match(paymentPages, /Платёж не завершён/);
assert.match(paymentPages, /Платёж проверяется/);
assert.match(paymentPages, /mockPaymentSucceed/);
assert.match(paymentPages, /mockPaymentFail/);

const forgotPasswordPage = read("pages/ForgotPasswordPage.tsx");
assert.match(forgotPasswordPage, /Восстановление доступа/);
assert.match(forgotPasswordPage, /Автоматическое восстановление пароля через SMS или email будет добавлено позже/);
assert.match(forgotPasswordPage, /Сейчас для восстановления доступа обратитесь в поддержку сервиса/);
assert.match(forgotPasswordPage, /zabota-ugorsk@yandex\.ru/);
assert.match(forgotPasswordPage, /\+7 \(922\) 400-03-20/);
assert.match(forgotPasswordPage, /Вернуться ко входу/);
assert.match(forgotPasswordPage, /Написать в поддержку/);

const contactDetails = read("components/ContactDetails.tsx");
assert.match(contactDetails, /Контактные данные/);
assert.match(contactDetails, /Статус телефона/);
assert.match(contactDetails, /Статус email/);
assert.match(contactDetails, /Подтверждён/);
assert.match(contactDetails, /Не подтверждён/);
assert.match(contactDetails, /Подтверждение телефона и email будет добавлено позже/);

const types = read("types/index.ts");
assert.match(types, /normalizedPhone\?: string \| null/);
assert.match(types, /phoneVerifiedAt\?: string \| null/);
assert.match(types, /emailVerifiedAt\?: string \| null/);

const adminPaymentsPage = read("pages/AdminPaymentsPage.tsx");
assert.match(adminPaymentsPage, /Платежи/);
assert.match(adminPaymentsPage, /Пополнения баланса и статусы платёжных операций/);
assert.match(adminPaymentsPage, /Пользователь \/ userId/);
assert.match(adminPaymentsPage, /Provider Payment ID/);
assert.match(adminPaymentsPage, /Технические данные платежа/);
assert.match(adminPaymentsPage, /Не удалось загрузить платежи/);
assert.doesNotMatch(adminPaymentsPage, /комисси/i);

const legalPages = read("pages/LegalPages.tsx");
assert.match(legalPages, /Назад к юридическим документам/);
assert.match(legalPages, /Актуальная версия/);
assert.match(legalPages, /Обязательный/);
assert.match(legalPages, /Да/);
assert.match(legalPages, /Нет/);
for (const [path, label] of [
  ["/legal/privacy", "Политика обработки персональных данных"],
  ["/legal/personal-data-consent", "Согласие на обработку персональных данных"],
  ["/legal/customer-agreement", "Пользовательское соглашение заказчика"],
  ["/legal/helper-terms", "Условия использования сервиса помощником"],
  ["/legal/service-notifications-consent", "Согласие на получение сервисных уведомлений"],
  ["/legal/marketing-notifications-consent", "Согласие на получение информационных сообщений"],
  ["/legal/helper-documents-consent", "Согласие на загрузку, хранение и проверку документов помощника"],
  ["/legal/service-rules", "Правила сервиса и запрещённые услуги"]
]) {
  assert.ok(app.includes(path), `В маршрутизации приложения отсутствует путь ${path}`);
  assert.ok(legalPages.includes(path), `На странице /legal отсутствует ссылка ${path}`);
  assert.ok(legalPages.includes(label), `На странице /legal отсутствует текст ссылки «${label}»`);
}

const apiClient = read("api/client.ts");
assert.match(apiClient, /\/legal\/my-consents/);
assert.match(apiClient, /\/payments\/top-up\/init/);
assert.match(apiClient, /\/payments\/my/);
assert.match(apiClient, /\/payments\/\$\{id\}/);
assert.match(apiClient, /\/payments\/mock\/\$\{id\}\/succeed/);
assert.match(apiClient, /\/payments\/mock\/\$\{id\}\/fail/);
assert.match(apiClient, /\/admin\/payments/);
assert.match(apiClient, /\/admin\/payments\/\$\{id\}/);
assert.match(apiClient, /\/admin\/legal\/documents/);
assert.match(apiClient, /\/admin\/legal\/consents/);
assert.match(apiClient, /\/admin\/legal\/exports\/all\.xlsx/);
assert.match(apiClient, /\/admin\/legal\/exports\/archive\.zip/);
assert.match(apiClient, /\/admin\/users\/\$\{userId\}\/legal\/consents\.xlsx/);
assert.match(apiClient, /\/admin\/users\/\$\{userId\}\/legal\/archive\.zip/);

const forbiddenUserLabels = [
  "Предлагаемая оплата",
  "предлагаемая оплата",
  "Оплата помощнику:",
  "Админ-панель",
  "Жалобы/предложения",
  "фиксированная цена",
  "цена услуги",
  "Клиент",
  "клиент",
  "Исполнитель",
  "исполнитель",
  "Комиссия",
  "комиссия",
  "Карта-заглушка",
  "демо-карта",
  "Зона тарифов"
];

const allFrontendSource = walkFiles(sourceRoot)
  .filter((file) => !file.endsWith("navigationTerminology.test.ts"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

for (const label of forbiddenUserLabels) {
  assert.equal(allFrontendSource.includes(label), false, `Forbidden label still present: ${label}`);
}

console.log("Navigation and terminology tests passed");
