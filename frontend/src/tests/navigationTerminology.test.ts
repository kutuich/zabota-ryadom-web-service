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
  managerNavigation,
  performerNavigation,
  sectionTitleForPath
} from "../routes/navigation";
import { formatDateRu, formatTimeRu, parseDateRu } from "../utils/dateTime";
import { effectiveRoleForUser } from "../utils/authRole";

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

const managerPaths = [
  "/app/manager",
  "/app/manager/users",
  "/app/manager/requests",
  "/app/manager/chats",
  "/app/manager/support",
  "/app/manager/payments",
  "/app/manager/balances",
  "/app/manager/profile"
];

assert.equal(defaultPathForRole("manager"), "/app/manager");
for (const path of managerPaths) {
  assert.equal(canRoleOpenPath("manager", path), true, `Менеджеру недоступен маршрут ${path}`);
  assert.equal(isKnownPathForRole("manager", path), true, `Маршрут менеджера не зарегистрирован: ${path}`);
}
assert.equal(canRoleOpenPath("manager", "/app/admin"), false);
assert.equal(canRoleOpenPath("admin", "/app/manager"), false);
const managerLabels = managerNavigation.flatMap((group) => group.items.map((item) => item.label));
assert.equal(managerLabels.includes("Настройки сервиса"), false);
assert.equal(managerLabels.includes("Юридические документы"), false);
assert.equal(managerLabels.includes("Архив"), false);
assert.equal(managerLabels.includes("Начисления"), false);

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
assert.equal(effectiveRoleForUser({ role: "admin", effectiveRole: "client" } as any), "client");
assert.equal(effectiveRoleForUser({ role: "admin", effectiveRole: "performer" } as any), "performer");

const appLayout = read("components/AppLayout.tsx");
assert.match(appLayout, /logout\(\);/);
assert.match(appLayout, /navigate\("\/app", \{ replace: true \}\)/);
assert.match(appLayout, /Вы работаете как Заказчик в режиме администратора/);
assert.match(appLayout, /Вы работаете как Помощник в режиме администратора/);
assert.match(appLayout, /Все действия сохраняются в журнале/);
assert.match(appLayout, /Вернуться в админку/);

const authContext = read("context/AuthContext.tsx");
assert.match(authContext, /api\.startAdminActing\(role\)/);
assert.match(authContext, /api\.stopAdminActing\(\)/);
assert.match(authContext, /setStoredToken\(null\)/);
assert.match(authContext, /setUser\(null\)/);

const actingApiClient = read("api/client.ts");
assert.match(actingApiClient, /"\/admin\/acting\/start"/);
assert.match(actingApiClient, /"\/admin\/acting\/stop"/);

const appRouter = read("App.tsx");
assert.match(appRouter, /effectiveRoleForUser\(user\)/);
assert.match(appRouter, /allowed\.includes\(effectiveRole\)/);

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
assert.match(chatPanel, /Согласованная оплата за визит/);
assert.match(chatPanel, /Сервисный сбор заказчика/);
assert.match(chatPanel, /Сервисный сбор помощника/);
assert.match(chatPanel, /Сначала согласуйте и сохраните стоимость помощи/);
assert.match(chatPanel, /Изменить условия/);
assert.match(chatPanel, /Сохранить условия/);
assert.match(chatPanel, /disabled=\{!chat\.agreedTerms\}/);
assert.match(chatPanel, /previewAmount \+ 50/);
assert.match(chatPanel, /previewAmount - 50/);
assert.match(chatPanel, /effectiveRole === "admin" \|\| effectiveRole === "superadmin"/);
assert.doesNotMatch(chatPanel, /user\?\.role === "admin"/);
assert.doesNotMatch(chatPanel, /комисси/i);

const agreedTermsSummary = read("components/AgreedTermsSummary.tsx");
assert.match(agreedTermsSummary, /Согласованные условия/);
assert.match(agreedTermsSummary, /Итого для Заказчика/);
assert.match(agreedTermsSummary, /Помощник получит/);
assert.match(agreedTermsSummary, /Сервисный сбор Заказчика/);
assert.match(agreedTermsSummary, /Сервисный сбор Помощника/);
assert.doesNotMatch(agreedTermsSummary, /комисси/i);

const priceSummary = read("components/PriceSummary.tsx");
assert.match(priceSummary, /Рекомендуемая стоимость визита/);
assert.match(priceSummary, /Стоимость помощи Помощника/);
assert.match(priceSummary, /Итого расходы Заказчика/);
assert.match(priceSummary, /Доход после сервисного сбора/);
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
assert.match(adminDashboard, /Быстрый вход в кабинеты/);
assert.match(adminDashboard, /Открыть кабинет Заказчика/);
assert.match(adminDashboard, /Открыть кабинет Помощника/);
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
assert.match(landingAuth, /helper_documents_consent/);
assert.match(landingAuth, /helper-documents-consent/);
assert.match(landingAuth, /Хочу получать информационные сообщения/);
assert.match(landingAuth, /"privacy"/);
assert.doesNotMatch(landingAuth, /"privacy_policy"/);
assert.match(landingAuth, /app-auth-logo\.png/);
assert.match(landingAuth, /auth-brand-panel/);
assert.match(landingAuth, /auth-register-page/);
assert.match(landingAuth, /auth-register-shell/);
assert.match(landingAuth, /CityCombobox/);
assert.match(landingAuth, /Создать аккаунт/);
assert.match(landingAuth, /Назад ко входу/);
assert.match(landingAuth, /Имя \/ Логин/);
assert.match(landingAuth, /Войти через VK/);
assert.match(landingAuth, /Быстрый вход для пользователей ВК/);
assert.match(landingAuth, /settings\.vkIdEnabled/);
assert.doesNotMatch(landingAuth, /Тестовые входы/);
assert.doesNotMatch(landingAuth, /admin@zabota\.local/);
assert.doesNotMatch(landingAuth, /client@zabota\.local/);
assert.doesNotMatch(landingAuth, /performer@zabota\.local/);
assert.doesNotMatch(landingAuth, /useState\("password123"\)/);
assert.doesNotMatch(landingAuth, /медицинские услуги/i);

const visualAuditShowcase = read("pages/VisualAuditShowcasePage.tsx");
const appRoutes = read("App.tsx");
const mainEntry = read("main.tsx");
assert.match(appRoutes, /VITE_ENABLE_VISUAL_AUDIT_ROUTES === "true"/);
assert.match(appRoutes, /\/app\/audit\/client/);
assert.match(appRoutes, /\/app\/audit\/performer/);
assert.match(appRoutes, /\/app\/audit\/admin/);
assert.match(mainEntry, /visualAuditRoutesEnabled && isVisualAuditPath/);
assert.match(mainEntry, /<VisualAuditRoutes \/>/);
assert.match(visualAuditShowcase, /data-visual-audit-route/);
assert.match(visualAuditShowcase, /Тестовый заказчик/);
assert.match(visualAuditShowcase, /Тестовый помощник/);
assert.match(visualAuditShowcase, /Тестовый администратор/);
assert.match(visualAuditShowcase, /test@example\.local/);
assert.match(visualAuditShowcase, /\+7 \(900\) 000-00-00/);
assert.doesNotMatch(visualAuditShowcase, /\bapi\./);
assert.doesNotMatch(visualAuditShowcase, /fetch\(/);
assert.doesNotMatch(visualAuditShowcase, /axios/i);
assert.doesNotMatch(visualAuditShowcase, /комиссия|исполнитель|клиент|работник|трудоустроим|медицинские услуги/i);

const visualAuditScript = read("../../scripts/public-visual-audit.mjs");
const localStartCommand = read("../../start-zabota-local.command");
assert.match(visualAuditScript, /VISUAL_AUDIT_LOCAL_BASE_URL \?\? "http:\/\/localhost:4000"/);
assert.match(visualAuditScript, /auditEnvironment\("local", localhostBase\)/);
assert.match(visualAuditScript, /const fileName = `\$\{pageInfo\.slug\}-\$\{viewport\.name\}\.png`/);
assert.match(visualAuditScript, /`audit-\$\{route\.role\}-\$\{viewport\.name\}\.png`/);
assert.doesNotMatch(visualAuditScript, /zabota-ugorsk\.ru/);
assert.doesNotMatch(visualAuditScript, /productionHttps|productionHttp|selectProductionBase/);
assert.match(localStartCommand, /VISUAL_AUDIT_ROUTES_VALUE="true"/);
assert.match(localStartCommand, /--build-arg VITE_ENABLE_VISUAL_AUDIT_ROUTES=/);

const cityCombobox = read("components/CityCombobox.tsx");
assert.match(cityCombobox, /role="combobox"/);
assert.match(cityCombobox, /ArrowDown/);
assert.match(cityCombobox, /ArrowUp/);
assert.match(cityCombobox, /Населённый пункт не найден/);
assert.match(cityCombobox, /htmlFor=\{inputId\}/);
assert.match(cityCombobox, /api\.searchSettlements/);
assert.match(cityCombobox, /api\.suggestSettlement/);
assert.match(cityCombobox, /Доступен для выбора/);

const adminCityControls = read("pages/AdminDashboard.tsx");
assert.match(adminCityControls, /api\.adminCities\(\)/);
assert.match(adminCityControls, /api\.adminUpdateCity/);
assert.match(adminCityControls, /Города \/ Населённые пункты/);
assert.match(adminCityControls, /Активен/);
assert.match(adminCityControls, /Неактивен/);
assert.match(adminCityControls, /VK-аналитики используются только как ориентир спроса/);

const userCitiesPanel = read("components/UserCitiesPanel.tsx");
assert.match(userCitiesPanel, /Основной город/);
assert.match(userCitiesPanel, /Дополнительные города/);
assert.match(userCitiesPanel, /Сделать основным/);
assert.match(userCitiesPanel, /Добавить город/);
assert.match(userCitiesPanel, /api\.myCities/);

const customerCityForm = read("pages/ClientDashboard.tsx");
assert.match(customerCityForm, /Город Подопечного/);
assert.match(customerCityForm, /В этом городе пока может быть мало Помощников/);

const consentPanel = read("components/ConsentDocumentsPanel.tsx");
assert.match(consentPanel, /Принять обязательные документы/);
assert.match(consentPanel, /Требуется новая версия/);

const app = read("App.tsx");
assert.match(app, /path="\/app"/);
assert.match(app, /path="\/app\/login"/);
assert.match(app, /path="\/app\/oauth\/complete"/);
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

const oauthComplete = read("pages/OAuthCompletePage.tsx");
assert.match(oauthComplete, /Вы вошли через VK\. Осталось заполнить данные/);
assert.match(oauthComplete, /Заказчик/);
assert.match(oauthComplete, /Помощник/);
assert.match(oauthComplete, /customer_agreement/);
assert.match(oauthComplete, /helper_terms/);
assert.match(oauthComplete, /marketingNotificationsAccepted/);

const vkContactDetails = read("components/ContactDetails.tsx");
assert.match(vkContactDetails, /Привязать VK ID/);
assert.match(vkContactDetails, /api\.startVkLink/);

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
assert.match(balancePanel, /История операций баланса/);
assert.match(balancePanel, /Пробный баланс/);
assert.match(balancePanel, /платёжная форма банка или тестовая платёжная форма/);
assert.match(balancePanel, /Сервис не хранит данные банковских карт/);
assert.match(balancePanel, /createTopUpPayment/);
assert.match(balancePanel, /getMyPayments/);
assert.match(balancePanel, /refreshPaymentStatus/);
assert.match(balancePanel, /Проверить статус/);
assert.match(balancePanel, /payment\.status === "pending"/);
assert.match(balancePanel, /Number\.isSafeInteger\(amount\)/);
assert.match(balancePanel, /disabled=\{isSubmitting \|\| !canSubmitTopUp\}/);
assert.match(balancePanel, /payment\.description/);
assert.match(balancePanel, /window\.location\.href = payment\.paymentUrl/);
assert.doesNotMatch(balancePanel, /mockTopUp/);
assert.doesNotMatch(balancePanel, /Пополнить тестово/);
assert.doesNotMatch(balancePanel, /Тестовое пополнение/);

const clientPricingUi = read("pages/ClientDashboard.tsx");
for (const expectedPackage of [
  "Короткая помощь",
  "Бытовая помощь 2 часа",
  "Присмотр 2 часа",
  "Сопровождение стандарт",
  "Помощь 3–4 часа",
  "Регулярная помощь"
]) {
  assert.match(clientPricingUi, new RegExp(expectedPackage));
}
assert.match(clientPricingUi, /Действия, которые входят в пакет/);
assert.match(clientPricingUi, /Помощь с простой едой сверх пакета/);

const currentPriceSummary = read("components/PriceSummary.tsx");
assert.match(currentPriceSummary, /Сервисный сбор заказчика/);
assert.match(currentPriceSummary, /Сервисный сбор помощника/);
assert.match(currentPriceSummary, /Возможные доплаты/);

const paymentPages = read("pages/PaymentPages.tsx");
assert.match(paymentPages, /Тестовая платёжная форма/);
assert.match(paymentPages, /Оплатить тестово/);
assert.match(paymentPages, /Отменить платёж/);
assert.match(paymentPages, /Платёж принят/);
assert.match(paymentPages, /Платёж не завершён/);
assert.match(paymentPages, /Платёж проверяется/);
assert.match(paymentPages, /Если платёж подтверждён, баланс будет обновлён автоматически/);
assert.match(paymentPages, /Деньги не зачислены на баланс/);
assert.match(paymentPages, /Мы ожидаем подтверждение от платёжного провайдера/);
assert.match(paymentPages, /Проверить статус платежа/);
assert.match(paymentPages, /api\.refreshPaymentStatus/);
assert.match(paymentPages, /PaymentStatusRefresh/);
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
assert.match(adminPaymentsPage, /Обновить статус/);
assert.match(adminPaymentsPage, /rawStateResponseJson/);
assert.match(adminPaymentsPage, /Не удалось загрузить платежи/);
assert.doesNotMatch(adminPaymentsPage, /комисси/i);

const trialBalanceAdminDashboard = read("pages/AdminDashboard.tsx");
assert.match(trialBalanceAdminDashboard, /Пробный период/);
assert.match(trialBalanceAdminDashboard, /Пробный баланс помогает новым пользователям/);
assert.match(trialBalanceAdminDashboard, /Начислить 100 ₽ всем подходящим пользователям/);
assert.match(trialBalanceAdminDashboard, /Начисление необратимо/);
assert.match(trialBalanceAdminDashboard, /lockedServiceFeeSettingKeys/);
assert.match(trialBalanceAdminDashboard, /Заказчик<\/strong><span>50 ₽/);
assert.match(trialBalanceAdminDashboard, /Помощник<\/strong><span>50 ₽/);
assert.match(trialBalanceAdminDashboard, /Изменение сервисного сбора временно недоступно/);
assert.doesNotMatch(trialBalanceAdminDashboard, /Удалить пользователя/);
assert.match(trialBalanceAdminDashboard, /Заблокировать/);
assert.match(trialBalanceAdminDashboard, /Запросить архивирование/);
assert.match(trialBalanceAdminDashboard, /Основной баланс/);
assert.match(trialBalanceAdminDashboard, /Архивирование сейчас запрещено/);

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
assert.match(apiClient, /\/chats\/\$\{chatId\}\/terms/);
assert.match(apiClient, /\/admin\/payments/);
assert.match(apiClient, /\/admin\/payments\/\$\{id\}/);
assert.match(apiClient, /\/admin\/trial-balance\/settings/);
assert.match(apiClient, /\/admin\/trial-balance\/grant-all/);
assert.match(apiClient, /\/admin\/legal\/documents/);
assert.match(apiClient, /\/admin\/legal\/consents/);
assert.match(apiClient, /\/admin\/legal\/exports\/all\.xlsx/);
assert.match(apiClient, /\/admin\/legal\/exports\/archive\.zip/);
assert.match(apiClient, /\/admin\/users\/\$\{userId\}\/legal\/consents\.xlsx/);
assert.match(apiClient, /\/admin\/users\/\$\{userId\}\/legal\/archive\.zip/);
assert.match(apiClient, /\/admin\/users\/\$\{userId\}\/request-archive/);
assert.match(apiClient, /\/admin\/users\/\$\{userId\}\/archive-safety/);
assert.match(apiClient, /\/admin\/users\/\$\{userId\}\/archive/);
assert.doesNotMatch(apiClient, /adminDeleteUser/);
assert.match(apiClient, /adminAssignManager/);
assert.match(apiClient, /adminRevokeManager/);
assert.match(apiClient, /managerBlockUser/);

const managerDashboard = read("pages/ManagerDashboard.tsx");
assert.doesNotMatch(managerDashboard, /Обновить статус/);
assert.match(managerDashboard, /Кабинет менеджера/);
assert.match(managerDashboard, /не можете менять системные настройки и роли пользователей/);
assert.match(managerDashboard, /Заблокировать/);
assert.doesNotMatch(managerDashboard, /Назначить менеджером/);
assert.doesNotMatch(managerDashboard, /Снять роль менеджера/);
assert.doesNotMatch(managerDashboard, /Настройки сервиса/);
assert.doesNotMatch(managerDashboard, /Юридические документы/);
assert.doesNotMatch(managerDashboard, /Изменить статус платежа/);
assert.doesNotMatch(managerDashboard, /Зачислить платёж/);

const adminDashboardManagerControls = read("pages/AdminDashboard.tsx");
assert.match(adminDashboardManagerControls, /Назначить менеджером/);
assert.match(adminDashboardManagerControls, /Снять роль менеджера/);

assert.match(appRoutes, /path="\/app\/manager\/\*"/);

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
  "медицинские услуги",
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
