import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import jwt from "jsonwebtoken";
import { createApp } from "../app";
import { prisma } from "../db/prisma";
import { calculatePrice } from "../services/pricingService";
import { moderateChatMessage } from "../services/moderationService";
import { detectMedicalTerms } from "../services/requestPolicy";
import { nextRequestPublicNumber } from "../services/requestNumberService";
import { hasAvailableBalance } from "../services/balanceService";
import { evaluateRequestMatch } from "../services/matchingService";
import {
  buildFullAddress,
  buildPublicAddress,
  buildYandexExactMapAddress,
  buildYandexMapsSearchUrl,
  buildYandexPublicMapAddress,
  canShowExactAddressToHelper
} from "../services/addressService";
import { serializeRequestForUser } from "../services/requestPolicy";
import { CITY_DIRECTORY } from "../services/cityDirectory";
import { mockPaymentAdapter, PAYMENT_STATUSES, tbankPaymentAdapter } from "../services/paymentAdapter";
import { generateTopUpOrderId } from "../services/paymentOrderId";
import { buildTbankToken, verifyTbankToken } from "../services/tbankToken";
import { normalizeRussianPhone } from "../services/phoneService";
import { env } from "../config/env";
import {
  LEGAL_DOCUMENT_DEFINITIONS,
  calculateLegalDocumentHash,
  missingAcceptedDocumentTypes,
  requiredDocumentTypesForFeature,
  requiredDocumentTypesForRegistration,
  roleToLegalScope
} from "../services/legalService";

async function run() {
  assert.equal(normalizeRussianPhone("+79224000320"), "+79224000320");
  assert.equal(normalizeRussianPhone("79224000320"), "+79224000320");
  assert.equal(normalizeRussianPhone("89224000320"), "+79224000320");
  assert.equal(normalizeRussianPhone("9224000320"), "+79224000320");
  assert.equal(normalizeRussianPhone("+7 (922) 400-03-20"), "+79224000320");
  assert.equal(normalizeRussianPhone("8 922 400 03 20"), "+79224000320");
  assert.throws(() => normalizeRussianPhone("12345"), /Укажите корректный номер телефона/);

  const orderId = generateTopUpOrderId("user42", new Date("2026-07-18T19:15:22"), "A8K3");
  assert.equal(orderId, "TOPUP-USER42-20260718191522-A8K3");
  assert.ok(PAYMENT_STATUSES.includes("pending"));
  assert.ok(PAYMENT_STATUSES.includes("succeeded"));

  const pendingMockPayment = await mockPaymentAdapter.createTopUpPayment({
    userId: "user42",
    amount: 150,
    orderId,
    description: "Пополнение баланса",
    successUrl: "http://localhost:4000/app/balance/payment-success",
    failUrl: "http://localhost:4000/app/balance/payment-fail",
    notificationUrl: "http://localhost:4000/api/payments/tbank/webhook",
    metadata: { source: "unit-test" }
  });
  assert.equal(pendingMockPayment.provider, "mock");
  assert.equal(pendingMockPayment.status, "pending");
  assert.equal(pendingMockPayment.providerPaymentId, `MOCK-${orderId}`);
  assert.equal(pendingMockPayment.paymentUrl, `/app/balance/mock-payment?orderId=${encodeURIComponent(orderId)}`);
  assert.match(pendingMockPayment.rawRequestJson ?? "", /Пополнение баланса/);

  const legacyMockPayment = await mockPaymentAdapter.createTopUp(150, "user42");
  assert.equal(legacyMockPayment.provider, "mock");
  assert.equal(legacyMockPayment.status, "succeeded");
  assert.equal(legacyMockPayment.amount, 150);

  const tokenPayload = {
    TerminalKey: "Terminal",
    Amount: 15000,
    OrderId: "ORDER-1",
    Description: "Пополнение",
    DATA: { userId: "user42" },
    Receipt: { Email: "test@example.com" },
    Token: "old-token"
  };
  const token = buildTbankToken(tokenPayload, "secret");
  assert.equal(token, buildTbankToken({
    Receipt: { Email: "changed@example.com" },
    Token: "changed-token",
    DATA: { userId: "changed" },
    Description: "Пополнение",
    OrderId: "ORDER-1",
    Amount: 15000,
    TerminalKey: "Terminal"
  }, "secret"));
  assert.equal(token, buildTbankToken({
    OrderId: "ORDER-1",
    TerminalKey: "Terminal",
    Description: "Пополнение",
    Amount: 15000
  }, "secret"));
  assert.equal(verifyTbankToken({ ...tokenPayload, Token: token }, "secret"), true);
  assert.equal(verifyTbankToken({ ...tokenPayload, Amount: 16000, Token: token }, "secret"), false);

  const originalTbankEnv = {
    terminalKey: env.tbankTerminalKey,
    password: env.tbankPassword,
    apiUrl: env.tbankApiUrl,
    successUrl: env.tbankSuccessUrl,
    failUrl: env.tbankFailUrl,
    notificationUrl: env.tbankNotificationUrl
  };
  const originalFetch = globalThis.fetch;
  try {
    env.tbankTerminalKey = "";
    env.tbankPassword = "";
    await assert.rejects(
      () => tbankPaymentAdapter.createTopUpPayment({
        userId: "user42",
        amount: 150,
        orderId,
        description: "Пополнение баланса"
      }),
      /Платёжный провайдер не настроен/
    );
    env.tbankTerminalKey = "TEST_TERMINAL";
    env.tbankPassword = "TEST_PASSWORD";
    env.tbankApiUrl = "https://securepay.test/v2";
    env.tbankSuccessUrl = "http://localhost:4000/app/balance/payment-success";
    env.tbankFailUrl = "http://localhost:4000/app/balance/payment-fail";
    env.tbankNotificationUrl = "http://localhost:4000/api/payments/tbank/webhook";
    let capturedInitRequest: any = null;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedInitRequest = JSON.parse(String(init?.body ?? "{}"));
      assert.equal(String(url), "https://securepay.test/v2/Init");
      return new Response(JSON.stringify({
        Success: true,
        ErrorCode: "0",
        PaymentId: 123456,
        PaymentURL: "https://securepay.test/payment/123456",
        Status: "NEW",
        OrderId: capturedInitRequest.OrderId,
        Amount: capturedInitRequest.Amount
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;
    const tbankInit = await tbankPaymentAdapter.createTopUpPayment({
      userId: "user42",
      amount: 150,
      orderId,
      description: "Пополнение баланса"
    });
    assert.equal(capturedInitRequest.TerminalKey, "TEST_TERMINAL");
    assert.equal(capturedInitRequest.Amount, 15000);
    assert.equal(capturedInitRequest.Description, "Пополнение баланса Забота Рядом");
    assert.deepEqual(capturedInitRequest.DATA, { userId: "user42", purpose: "balance_top_up" });
    assert.equal(capturedInitRequest.Token, buildTbankToken(capturedInitRequest, "TEST_PASSWORD"));
    assert.equal(tbankInit.provider, "tbank");
    assert.equal(tbankInit.providerPaymentId, "123456");
    assert.equal(tbankInit.paymentUrl, "https://securepay.test/payment/123456");
    assert.equal(tbankInit.status, "pending");
    assert.match(tbankInit.rawRequestJson ?? "", /TEST_TERMINAL/);
    assert.match(tbankInit.rawResponseJson ?? "", /PaymentURL/);
  } finally {
    env.tbankTerminalKey = originalTbankEnv.terminalKey;
    env.tbankPassword = originalTbankEnv.password;
    env.tbankApiUrl = originalTbankEnv.apiUrl;
    env.tbankSuccessUrl = originalTbankEnv.successUrl;
    env.tbankFailUrl = originalTbankEnv.failUrl;
    env.tbankNotificationUrl = originalTbankEnv.notificationUrl;
    globalThis.fetch = originalFetch;
  }

  const homeHelpCategory = {
    slug: "home-help",
    name: "Помощь по дому",
    basePrice: 950,
    calculationUnit: "visit",
    minDurationHours: 2,
    includedJson: JSON.stringify(["лёгкая уборка"]),
    excludedJson: JSON.stringify(["медицинские процедуры"]),
    clientInstructions: "Опишите объём бытовых задач.",
    performerInstructions: "Согласуйте объём."
  };

  const price = calculatePrice({
    category: homeHelpCategory,
    expectedDurationHours: 3,
    needsCleaning: true,
    urgency: "urgent"
  });
  assert.equal(price.performerPaymentAmount, 1450);
  assert.equal(price.clientServiceFeeAmount, 50);
  assert.equal(price.performerServiceFeeAmount, 50);
  assert.equal(price.performerCommissionAmount, 50);
  assert.equal(price.clientTotalExpense, 1500);
  assert.equal(price.performerNetAmount, 1400);
  assert.match(price.explanation, /сервисный сбор заказчика 50 ₽/);
  assert.match(price.performerExplanation, /Сервисный сбор помощника 50 ₽/);
  assert.match(price.performerExplanation, /Ориентировочный доход после сервисного сбора 1400 ₽/);

  const standardHomeHelp = calculatePrice({
    category: { ...homeHelpCategory, includedJson: "[]", excludedJson: "", clientInstructions: "", performerInstructions: "" },
    expectedDurationHours: 2
  });
  assert.equal(standardHomeHelp.performerPaymentAmount, 950);
  assert.equal(standardHomeHelp.clientServiceFeeAmount, 50);
  assert.equal(standardHomeHelp.clientTotalExpense, 1000);
  assert.equal(standardHomeHelp.performerServiceFeeAmount, 50);
  assert.equal(standardHomeHelp.performerNetAmount, 900);

  const categoryChangeQuote = calculatePrice({
    category: { ...homeHelpCategory, slug: "cooking", name: "Приготовление еды" },
    expectedDurationHours: 2,
    selectedActions: ["fullCookingVisit"]
  });
  assert.equal(categoryChangeQuote.packageId, "fullCookingVisit");
  assert.ok(categoryChangeQuote.performerPaymentAmount > standardHomeHelp.performerPaymentAmount);

  const hygieneQuote = calculatePrice({
    category: { ...homeHelpCategory, slug: "elderly-care", name: "Сиделка для пожилого человека" },
    expectedDurationHours: 2,
    hygieneLevel: "hygieneIntimate"
  });
  assert.equal(hygieneQuote.packageId, "advancedCareVisit");
  assert.ok(hygieneQuote.recommendationReasons.includes("подмывание"));

  const physicalQuote = calculatePrice({
    category: { ...homeHelpCategory, slug: "elderly-care", name: "Сиделка для пожилого человека" },
    expectedDurationHours: 2,
    physicalLoadLevel: "physicalHeavy"
  });
  assert.equal(physicalQuote.packageId, "heavyCareVisit");
  assert.equal(physicalQuote.isManualReviewRequired, true);

  const diaperQuote = calculatePrice({
    category: { ...homeHelpCategory, slug: "elderly-care", name: "Сиделка для пожилого человека" },
    expectedDurationHours: 2,
    selectedActions: ["diaper", "toiletHelp", "hygieneIntimate"]
  });
  assert.equal(diaperQuote.packageId, "advancedCareVisit");

  const simpleMealQuote = calculatePrice({
    category: homeHelpCategory,
    expectedDurationHours: 2,
    selectedActions: ["simpleMealWithinVisit"]
  });
  assert.equal(simpleMealQuote.performerPaymentAmount, standardHomeHelp.performerPaymentAmount + 200);
  assert.equal(simpleMealQuote.clientTotalExpense, simpleMealQuote.performerPaymentAmount + 50);

  const surchargeQuote = calculatePrice({
    category: homeHelpCategory,
    expectedDurationHours: 2,
    timeFrom: "19:00",
    urgencyFlags: ["urgent", "weekend"]
  });
  assert.equal(surchargeQuote.performerPaymentAmount, 950 + 500);
  assert.equal(surchargeQuote.isManualReviewRequired, true);
  assert.equal(surchargeQuote.clientServiceFeeAmount, 50);
  assert.equal(surchargeQuote.performerServiceFeeAmount, 50);
  assert.equal(surchargeQuote.performerNetAmount, surchargeQuote.performerPaymentAmount - 50);
  assert.equal(surchargeQuote.clientTotalExpense, surchargeQuote.performerPaymentAmount + 50);
  assert.equal(/комиссия/i.test(JSON.stringify(surchargeQuote)), false);

  const addressParts = {
    city: "Югорск",
    street: "ул. Мира",
    house: "10",
    apartment: "15",
    entrance: "2",
    floor: "3",
    intercom: "15",
    addressComment: "вход со двора"
  };
  assert.equal(buildPublicAddress(addressParts), "Югорск, ул. Мира");
  assert.equal(buildYandexPublicMapAddress(addressParts), "Югорск, ул. Мира");
  assert.equal(buildYandexExactMapAddress(addressParts), "Югорск, ул. Мира, 10");
  assert.equal(buildFullAddress(addressParts), "Югорск, ул. Мира, 10, подъезд 2, этаж 3, квартира 15");
  const publicUrl = buildYandexMapsSearchUrl(buildYandexPublicMapAddress(addressParts));
  const exactUrl = buildYandexMapsSearchUrl(buildYandexExactMapAddress(addressParts));
  const publicSearchText = new URL(publicUrl).searchParams.get("text") ?? "";
  const exactSearchText = new URL(exactUrl).searchParams.get("text") ?? "";
  assert.match(publicUrl, /^https:\/\/yandex\.ru\/maps\/\?text=/);
  assert.ok(publicUrl.includes(encodeURIComponent("Югорск, ул. Мира")));
  assert.equal(publicSearchText.includes("10"), false);
  assert.equal(publicSearchText.includes("15"), false);
  assert.equal(publicSearchText.includes("подъезд"), false);
  assert.equal(publicSearchText.includes("этаж"), false);
  assert.equal(publicSearchText.includes("домофон"), false);
  assert.equal(exactSearchText, "Югорск, ул. Мира, 10");
  assert.equal(exactSearchText.includes("15"), false);
  assert.equal(exactSearchText.includes("подъезд"), false);
  assert.equal(exactSearchText.includes("этаж"), false);
  assert.equal(exactSearchText.includes("домофон"), false);
  assert.equal(canShowExactAddressToHelper("waiting_for_responses", "open"), false);
  assert.equal(canShowExactAddressToHelper("in_progress", "in_work"), true);

  const requestForAddress = {
    id: "request-1",
    clientId: "client-1",
    selectedPerformerId: "performer-1",
    status: "waiting_for_responses",
    addressText: "Югорск, ул. Мира, 10, подъезд 2, этаж 3, квартира 15",
    approximateAddressText: "Югорск, ул. Мира",
    addressCity: "Югорск",
    addressStreet: "ул. Мира",
    addressHouse: "10",
    addressApartment: "15",
    addressEntrance: "2",
    addressFloor: "3",
    addressIntercom: "15",
    addressComment: "вход со двора",
    fullAddress: "Югорск, ул. Мира, 10, подъезд 2, этаж 3, квартира 15",
    publicAddress: "Югорск, ул. Мира",
    yandexPublicMapAddress: "Югорск, ул. Мира",
    yandexExactMapAddress: "Югорск, ул. Мира, 10",
    lat: 1,
    lng: 1,
    approximateLat: 0,
    approximateLng: 0,
    pricingBreakdownJson: null,
    chats: [{ id: "chat-1", status: "open", performerId: "performer-1", archivedAt: null }],
    responses: []
  } as any;
  const helperBefore = serializeRequestForUser(requestForAddress, { id: "performer-1", role: "performer" } as any) as any;
  assert.equal(helperBefore.addressHouse, null);
  assert.equal(helperBefore.addressText, null);
  assert.equal(helperBefore.publicAddress, "Югорск, ул. Мира");
  const helperAfter = serializeRequestForUser({ ...requestForAddress, status: "in_progress", chats: [{ id: "chat-1", status: "in_work", performerId: "performer-1", archivedAt: null }] }, { id: "performer-1", role: "performer" } as any) as any;
  assert.equal(helperAfter.addressHouse, "10");
  assert.equal(helperAfter.yandexExactMapAddress, "Югорск, ул. Мира, 10");
  assert.match(helperAfter.yandexExactMapUrl, /%D0%AE%D0%B3%D0%BE%D1%80%D1%81%D0%BA/);
  assert.match(helperAfter.fullAddress, /квартира 15/);
  assert.equal(helperAfter.fullAddress.includes("домофон"), false);
  assert.equal(helperAfter.addressIntercom, "15");
  const customerAddress = serializeRequestForUser(requestForAddress, { id: "client-1", role: "client" } as any) as any;
  assert.match(customerAddress.fullAddress, /ул\. Мира, 10/);
  const adminAddress = serializeRequestForUser(requestForAddress, { id: "admin-1", role: "admin" } as any) as any;
  assert.equal(adminAddress.fullAddress, "Югорск, ул. Мира, 10, подъезд 2, этаж 3, квартира 15");
  assert.equal(adminAddress.yandexPublicMapAddress, "Югорск, ул. Мира");
  assert.equal(adminAddress.yandexExactMapAddress, "Югорск, ул. Мира, 10");
  assert.match(adminAddress.yandexPublicMapUrl, /^https:\/\/yandex\.ru\/maps\/\?text=/);
  assert.match(adminAddress.yandexExactMapUrl, /^https:\/\/yandex\.ru\/maps\/\?text=/);

  for (const cityName of ["Югорск", "Советский", "Екатеринбург", "Санкт-Петербург", "Москва", "Тюмень", "Волгоград", "Нижний Новгород"]) {
    assert.ok(CITY_DIRECTORY.some((city) => city.name === cityName), `Город ${cityName} должен быть в справочнике`);
  }
  assert.equal(CITY_DIRECTORY.find((city) => city.slug === "nizhny_novgorod")?.pricingZone, "future_large_city");

  assert.equal(LEGAL_DOCUMENT_DEFINITIONS.length, 8);
  assert.deepEqual(LEGAL_DOCUMENT_DEFINITIONS.map((document) => document.title), [
    "Политика обработки персональных данных",
    "Согласие на обработку персональных данных",
    "Пользовательское соглашение заказчика",
    "Условия использования сервиса помощником",
    "Согласие на получение сервисных уведомлений",
    "Согласие на получение информационных сообщений",
    "Согласие на загрузку, хранение и проверку документов помощника",
    "Правила сервиса и запрещённые услуги"
  ]);
  assert.equal(LEGAL_DOCUMENT_DEFINITIONS.find((document) => document.slug === "privacy")?.title, "Политика обработки персональных данных");
  assert.equal(LEGAL_DOCUMENT_DEFINITIONS.find((document) => document.slug === "privacy")?.version, "1.0");
  for (const type of [
    "privacy_policy",
    "personal_data_consent",
    "customer_agreement",
    "helper_terms",
    "service_notifications_consent",
    "marketing_notifications_consent",
    "helper_documents_consent",
    "service_rules"
  ]) {
    assert.ok(LEGAL_DOCUMENT_DEFINITIONS.some((document) => document.type === type), `Legal document ${type} must be seeded`);
  }
  assert.equal(roleToLegalScope("client"), "customer");
  assert.equal(roleToLegalScope("performer"), "helper");
  assert.deepEqual(requiredDocumentTypesForRegistration("client"), [
    "customer_agreement",
    "personal_data_consent",
    "service_rules",
    "service_notifications_consent"
  ]);
  assert.deepEqual(requiredDocumentTypesForRegistration("performer"), [
    "helper_terms",
    "personal_data_consent",
    "service_rules",
    "service_notifications_consent"
  ]);
  assert.deepEqual(missingAcceptedDocumentTypes("client", ["customer_agreement"]), [
    "personal_data_consent",
    "service_rules",
    "service_notifications_consent"
  ]);
  assert.ok(requiredDocumentTypesForFeature("performer", "upload_helper_document").includes("helper_documents_consent"));
  assert.ok(requiredDocumentTypesForFeature("client", "create_request").includes("customer_agreement"));
  const legalDoc = LEGAL_DOCUMENT_DEFINITIONS.find((document) => document.type === "service_rules")!;
  const legalHash = calculateLegalDocumentHash(legalDoc);
  const changedHash = calculateLegalDocumentHash({ ...legalDoc, contentMarkdown: `${legalDoc.contentMarkdown}\nИзменение.` });
  assert.notEqual(legalHash, changedHash);
  const legalRoutesSource = readFileSync(path.resolve(process.cwd(), "src/routes/legal.ts"), "utf8");
  const adminRoutesSource = readFileSync(path.resolve(process.cwd(), "src/routes/admin.ts"), "utf8");
  const schemaSource = readFileSync(path.resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
  assert.match(legalRoutesSource, /"\/documents"/);
  assert.match(legalRoutesSource, /"\/documents\/:slug"/);
  assert.match(legalRoutesSource, /"\/my-consents"/);
  assert.match(legalRoutesSource, /"\/consents\/accept"/);
  assert.match(legalRoutesSource, /"\/consents\/revoke-optional"/);
  assert.match(adminRoutesSource, /adminRouter\.use\(authenticate, requireAdmin\)/);
  assert.match(adminRoutesSource, /"\/legal\/documents"/);
  assert.match(adminRoutesSource, /"\/legal\/documents\/:id\/new-version"/);
  assert.match(adminRoutesSource, /"\/legal\/documents\/:id\/publish"/);
  assert.match(adminRoutesSource, /"\/legal\/consents"/);
  assert.match(adminRoutesSource, /"\/legal\/exports\/all\.xlsx"/);
  assert.match(adminRoutesSource, /"\/legal\/exports\/archive\.zip"/);
  assert.match(adminRoutesSource, /"\/users\/:userId\/legal\/consents\.xlsx"/);
  assert.match(adminRoutesSource, /"\/users\/:userId\/legal\/archive\.zip"/);
  assert.match(schemaSource, /documentVersion\s+String/);
  assert.match(schemaSource, /documentContentHash\s+String/);
  assert.match(readFileSync(path.resolve(process.cwd(), "src/services/legalService.ts"), "utf8"), /"MISSING_REQUIRED_CONSENT"/);

  const match = evaluateRequestMatch(
    {
      cityId: "city-1",
      hasLimitedMobility: false,
      needsHygieneHelp: true,
      dependentStateJson: "[]",
      category: { name: "Сиделка для пожилого человека", isChildcare: false }
    } as any,
    {
      id: "performer-1",
      cityId: "city-1",
      performerProfile: {
        services: JSON.stringify(["Сиделка для пожилого человека"]),
        readyForHygieneHelp: false
      }
    } as any
  );
  assert.equal(match.status, "not_fit");
  assert.equal(match.reasons[0], "Заявка скрыта, потому что требуется гигиеническая помощь, а в профиле указано «не готов».");
  assert.equal(hasAvailableBalance({ balance: 0, bonusBalance: 50 }, 50, true), true);
  assert.equal(hasAvailableBalance({ balance: 0, bonusBalance: 50 }, 50, false), false);

  const medicalMatches = detectMedicalTerms("Нужны инъекции и перевязки");
  assert.ok(medicalMatches.includes("инъекц"));
  assert.ok(medicalMatches.includes("перевяз"));

  const cleanMedicalWording = detectMedicalTerms("Без медицинских процедур, только бытовая помощь");
  assert.equal(cleanMedicalWording.length, 0);

  const moderated = moderateChatMessage("Мой телефон 89001234567");
  assert.equal(moderated.status, "hidden");
  assert.ok(moderated.flags.includes("phone_attempt"));
  assert.match(moderated.warning ?? "", /Не передавайте телефон/);

  const year = new Date().getFullYear();
  const publicNumber = await nextRequestPublicNumber({
    clientRequest: {
      findMany: async () => [
        { publicNumber: `ZR-${year}-0001` },
        { publicNumber: `ZR-${year}-0007` },
        { publicNumber: null }
      ]
    }
  } as any);
  assert.equal(publicNumber, `ZR-${year}-0008`);

  await runStaticRoutingTests();
  await runProductionStartupTests();
  await runAuthPhoneTests();
  await runPaymentRouteTests();

  console.log("Business tests passed");
}

async function runStaticRoutingTests() {
  const projectRoot = testProjectRoot();
  const frontendAssetName = firstFileName(path.join(projectRoot, "frontend/dist/assets"));
  const landingAssetName = firstFileName(path.join(projectRoot, "landing-public/assets"));
  assert.ok(frontendAssetName, "Нужен React asset в frontend/dist/assets для static routing tests");
  assert.ok(landingAssetName, "Нужен landing asset в landing-public/assets для static routing tests");

  const landingIndex = readFileSync(path.join(projectRoot, "landing-public/index.html"), "utf8");
  const landingPrices = readFileSync(path.join(projectRoot, "landing-public/prices.html"), "utf8");
  const frontendIndex = readFileSync(path.join(projectRoot, "frontend/dist/index.html"), "utf8");
  assert.match(landingIndex, /Сервис помощи для семьи, дома и близких/);
  assert.match(landingPrices, /Цены/);
  assert.match(frontendIndex, /<div id="root"><\/div>/);
  assert.match(frontendIndex, /\/app\/assets\//);

  const originalNodeEnv = env.nodeEnv;
  env.nodeEnv = "production";
  const app = createApp();

  try {
    const routePaths = expressRoutePaths(app);
    assert.ok(routePaths.includes("/api/health"));
    assert.ok(routePaths.includes("/"));
    assert.ok(routePaths.includes("/prices.html"));
    assert.ok(routePaths.includes("/payment.html"));
    assert.ok(routePaths.includes("/refund.html"));
    assert.ok(routePaths.includes("/security.html"));
    assert.ok(routePaths.includes("/contacts.html"));
    assert.ok(routePaths.includes("/faq.html"));
    assert.ok(routePaths.includes("/how-it-works.html"));
    assert.ok(routePaths.includes("/legal.html"));
    assert.ok(routePaths.includes("/app"));
    assert.ok(routePaths.includes("/app/*"));
    assert.ok(routePaths.includes("/legal"));
    assert.ok(routePaths.includes("/legal/*"));
    assert.ok(routePaths.includes("*.php"));
    assert.ok(routePaths.includes("/admin"));
    assert.ok(routePaths.includes("/admin/*"));
    assert.ok(routePaths.includes("/includes"));
    assert.ok(routePaths.includes("/includes/*"));
    assert.ok(routePaths.includes("/data"));
    assert.ok(routePaths.includes("/data/*"));
    assert.ok(routePaths.includes("*.html"));
    assert.ok(routeIndex(app, "/api/health") < routeIndex(app, "/app"));
    assert.ok(routeIndex(app, "/api/health") < routeIndex(app, "/"));

    const appSource = readFileSync(path.join(projectRoot, "backend/src/app.ts"), "utf8");
    assert.match(appSource, /app\.use\("\/uploads", express\.static\(uploadsRoot\)\)/);
    assert.match(appSource, /app\.use\("\/app\/assets", express\.static\(frontendAssetsPath/);
    assert.match(appSource, /app\.use\("\/css", express\.static\(landingCssPath/);
    assert.match(appSource, /app\.use\("\/js", express\.static\(landingJsPath/);
    assert.match(appSource, /app\.use\("\/assets", express\.static\(landingAssetsPath/);
    assert.match(appSource, /app\.get\(\["\/app", "\/app\/\*", "\/legal", "\/legal\/\*"\]/);
  } finally {
    env.nodeEnv = originalNodeEnv;
  }
}

async function runProductionStartupTests() {
  const projectRoot = testProjectRoot();
  const startupScript = readFileSync(path.join(projectRoot, "scripts/start-preview.mjs"), "utf8");
  const productionBootstrapScript = readFileSync(path.join(projectRoot, "scripts/bootstrap-production-admin.mjs"), "utf8");
  const productionEnvExample = readFileSync(path.join(projectRoot, ".env.production.example"), "utf8");

  assert.match(startupScript, /process\.env\.SEED_DEMO_DATA === "true"/);
  assert.match(startupScript, /backend\/dist\/prisma\/seed\.js/);
  assert.match(startupScript, /scripts\/bootstrap-production-admin\.mjs/);
  assert.match(startupScript, /PRODUCTION_ADMIN_EMAIL/);
  assert.match(startupScript, /PRODUCTION_ADMIN_PASSWORD/);
  assert.match(startupScript, /PRODUCTION_ADMIN_PHONE/);

  assert.match(productionBootstrapScript, /normalizeRussianPhone/);
  assert.match(productionBootstrapScript, /role: "superadmin"/);
  assert.match(productionBootstrapScript, /rolesJson: JSON\.stringify\(\["superadmin"\]\)/);
  assert.match(productionBootstrapScript, /emailVerifiedAt/);
  assert.match(productionBootstrapScript, /phoneVerifiedAt/);
  assert.doesNotMatch(productionBootstrapScript, /admin@zabota\.local/);
  assert.doesNotMatch(productionBootstrapScript, /client@zabota\.local/);
  assert.doesNotMatch(productionBootstrapScript, /performer@zabota\.local/);
  assert.doesNotMatch(productionBootstrapScript, /password123/);

  assert.match(productionEnvExample, /SEED_DEMO_DATA=false/);
  assert.match(productionEnvExample, /PRODUCTION_ADMIN_EMAIL=/);
  assert.match(productionEnvExample, /PRODUCTION_ADMIN_PASSWORD=/);
  assert.match(productionEnvExample, /PRODUCTION_ADMIN_PHONE=/);
  assert.doesNotMatch(productionEnvExample, /admin@zabota\.local/);
  assert.doesNotMatch(productionEnvExample, /password123/);
}

async function runPaymentRouteTests() {
  const app = createApp();
  const client = await prisma.user.findUnique({ where: { email: "client@zabota.local" } });
  const performer = await prisma.user.findUnique({ where: { email: "performer@zabota.local" } });
  const admin = await prisma.user.findUnique({ where: { email: "admin@zabota.local" } });
  assert.ok(client, "Нужен demo-заказчик для payment route tests");
  assert.ok(performer, "Нужен demo-помощник для payment route tests");
  assert.ok(admin, "Нужен demo-admin для payment route tests");

  const originalBalances = new Map<string, { balance: number; bonusBalance: number }>();
  for (const user of [client, performer]) {
    originalBalances.set(user.id, { balance: user.balance, bonusBalance: user.bonusBalance });
  }

  const orderIds: string[] = [];
  const paymentIds: string[] = [];
  const noConsentUser = await prisma.user.create({
    data: {
      role: "client",
      rolesJson: JSON.stringify(["client"]),
      phone: `+7999${Date.now().toString().slice(-7)}`,
      email: `payment-no-consent-${Date.now()}@zabota.local`,
      passwordHash: "test",
      displayName: "No consent payment test",
      cityId: client.cityId,
      status: "active"
    }
  });

  const clientToken = tokenFor(client.id, "client");
  const performerToken = tokenFor(performer.id, "performer");
  const adminToken = tokenFor(admin.id, admin.role);
  const noConsentToken = tokenFor(noConsentUser.id, "client");
  const originalTbankPassword = env.tbankPassword;

  try {
    env.tbankPassword = "WEBHOOK_TEST_PASSWORD";
    let response = await apiRequest(app, "/api/payments/top-up/init", {
      method: "POST",
      body: { amount: 150 }
    });
    assert.equal(response.status, 401);

    response = await apiRequest(app, "/api/payments/top-up/init", {
      method: "POST",
      token: noConsentToken,
      body: { amount: 150 }
    });
    assert.equal(response.status, 403);
    assert.equal(response.payload.code, "MISSING_REQUIRED_CONSENT");

    response = await apiRequest(app, "/api/payments/top-up/init", {
      method: "POST",
      token: clientToken,
      body: { amount: 100 }
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.code, "min_top_up");

    const clientBeforeInit = await prisma.user.findUniqueOrThrow({ where: { id: client.id }, select: { balance: true } });
    response = await apiRequest(app, "/api/payments/top-up/init", {
      method: "POST",
      token: clientToken,
      body: { amount: 150 }
    });
    assert.equal(response.status, 201);
    assert.equal(response.payload.amount, 150);
    assert.equal(response.payload.provider, "mock");
    assert.equal(response.payload.status, "pending");
    assert.match(response.payload.paymentUrl, /^\/app\/balance\/mock-payment\?orderId=/);
    orderIds.push(response.payload.orderId);
    paymentIds.push(response.payload.id);

    const createdPayment = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: response.payload.id } });
    assert.equal(createdPayment.orderId, response.payload.orderId);
    assert.equal(createdPayment.status, "pending");
    assert.equal(createdPayment.balanceTransactionId, null);
    const clientAfterInit = await prisma.user.findUniqueOrThrow({ where: { id: client.id }, select: { balance: true } });
    assert.equal(clientAfterInit.balance, clientBeforeInit.balance);

    response = await apiRequest(app, `/api/payments/mock/${createdPayment.id}/succeed`, {
      method: "POST",
      token: clientToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.payment.status, "succeeded");
    assert.equal(response.payload.balance.realBalance, clientBeforeInit.balance + 150);

    response = await apiRequest(app, `/api/payments/mock/${createdPayment.id}/succeed`, {
      method: "POST",
      token: clientToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.balance.realBalance, clientBeforeInit.balance + 150);
    const topUpTransactionsCount = await prisma.balanceTransaction.count({ where: { comment: createdPayment.orderId } });
    assert.equal(topUpTransactionsCount, 1);

    response = await apiRequest(app, "/api/payments/top-up/init", {
      method: "POST",
      token: clientToken,
      body: { amount: 150 }
    });
    const failedPaymentId = response.payload.id;
    orderIds.push(response.payload.orderId);
    paymentIds.push(failedPaymentId);
    const balanceBeforeFail = await prisma.user.findUniqueOrThrow({ where: { id: client.id }, select: { balance: true } });
    response = await apiRequest(app, `/api/payments/mock/${failedPaymentId}/fail`, {
      method: "POST",
      token: clientToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.payment.status, "failed");
    assert.equal(response.payload.balance.realBalance, balanceBeforeFail.balance);

    response = await apiRequest(app, "/api/payments/top-up/init", {
      method: "POST",
      token: performerToken,
      body: { amount: 150 }
    });
    const performerPaymentId = response.payload.id;
    orderIds.push(response.payload.orderId);
    paymentIds.push(performerPaymentId);

    response = await apiRequest(app, "/api/payments/my", {
      method: "GET",
      token: clientToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.some((payment: any) => payment.id === performerPaymentId), false);
    assert.equal(response.payload.some((payment: any) => Object.prototype.hasOwnProperty.call(payment, "rawWebhookJson")), false);

    response = await apiRequest(app, `/api/payments/${performerPaymentId}`, {
      method: "GET",
      token: clientToken
    });
    assert.equal(response.status, 403);

    response = await apiRequest(app, "/api/admin/payments", {
      method: "GET",
      token: adminToken
    });
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.payload));
    assert.ok(response.payload.length >= 1);

    const webhookOrderId = `TOPUP-WEBHOOK-${Date.now()}`;
    orderIds.push(webhookOrderId);
    const webhookPayment = await prisma.paymentTransaction.create({
      data: {
        userId: client.id,
        provider: "tbank",
        providerPaymentId: "TBANK-WEBHOOK-TEST",
        orderId: webhookOrderId,
        amount: 150,
        status: "pending",
        description: "Webhook payment route test"
      }
    });
    paymentIds.push(webhookPayment.id);
    const balanceBeforeWebhook = await prisma.user.findUniqueOrThrow({ where: { id: client.id }, select: { balance: true } });
    response = await apiRequest(app, "/api/payments/tbank/webhook", {
      method: "POST",
      body: {
        PaymentId: "TBANK-WEBHOOK-TEST",
        OrderId: webhookOrderId,
        Status: "CONFIRMED",
        Amount: 15000,
        Token: "invalid-token"
      }
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.code, "payment_webhook_token_invalid");
    const balanceAfterInvalidWebhook = await prisma.user.findUniqueOrThrow({ where: { id: client.id }, select: { balance: true } });
    assert.equal(balanceAfterInvalidWebhook.balance, balanceBeforeWebhook.balance);

    for (let index = 0; index < 2; index += 1) {
      const webhookPayload = {
        PaymentId: "TBANK-WEBHOOK-TEST",
        OrderId: webhookOrderId,
        Status: "CONFIRMED",
        Amount: 15000
      };
      response = await apiRequest(app, "/api/payments/tbank/webhook", {
        method: "POST",
        body: {
          ...webhookPayload,
          Token: buildTbankToken(webhookPayload, env.tbankPassword)
        }
      });
      assert.equal(response.status, 200);
      assert.equal(response.payload.ok, true);
      assert.equal(response.payload.status, "succeeded");
    }
    const balanceAfterWebhook = await prisma.user.findUniqueOrThrow({ where: { id: client.id }, select: { balance: true } });
    assert.equal(balanceAfterWebhook.balance, balanceBeforeWebhook.balance + 150);
    const webhookTransactionsCount = await prisma.balanceTransaction.count({ where: { comment: webhookOrderId } });
    assert.equal(webhookTransactionsCount, 1);
    const webhookPaymentAfter = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: webhookPayment.id } });
    assert.match(webhookPaymentAfter.rawWebhookJson ?? "", /CONFIRMED/);
  } finally {
    env.tbankPassword = originalTbankPassword;
    await prisma.paymentTransaction.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.balanceTransaction.deleteMany({ where: { comment: { in: orderIds } } });
    await prisma.user.deleteMany({ where: { id: noConsentUser.id } });
    await Promise.all(Array.from(originalBalances.entries()).map(([userId, balance]) =>
      prisma.user.update({
        where: { id: userId },
        data: balance
      })
    ));
  }
}

async function runAuthPhoneTests() {
  const app = createApp();
  const client = await prisma.user.findUnique({ where: { email: "client@zabota.local" } });
  const admin = await prisma.user.findUnique({ where: { email: "admin@zabota.local" } });
  assert.ok(client, "Нужен demo-заказчик для auth phone tests");
  assert.ok(admin, "Нужен demo-admin для auth phone tests");

  const suffix = Date.now();
  let createdUserId = "";
  try {
    let response = await apiRequest(app, "/api/auth/register", {
      method: "POST",
      body: {
        role: "client",
        phone: "+7 (922) 400-03-20",
        email: "",
        password: "password123",
        displayName: "Тест телефона",
        cityId: client.cityId,
        acceptedConsentTypes: ["terms", "privacy_policy", "personal_data_processing", "chat_rules", "payment_rules"],
        acceptedLegalDocumentTypes: requiredDocumentTypesForRegistration("client"),
        dependentDataTransferConfirmed: true
      }
    });
    assert.equal(response.status, 201);
    createdUserId = response.payload.user.id;
    const created = await prisma.user.findUniqueOrThrow({ where: { id: createdUserId } });
    assert.equal(created.phone, "+79224000320");
    assert.equal(created.normalizedPhone, "+79224000320");
    assert.equal(created.email, null);

    response = await apiRequest(app, "/api/auth/register", {
      method: "POST",
      body: {
        role: "client",
        phone: `8 922 400 03 20`,
        email: `duplicate-phone-${suffix}@zabota.local`,
        password: "password123",
        displayName: "Дубль телефона",
        cityId: client.cityId,
        acceptedConsentTypes: ["terms", "privacy_policy", "personal_data_processing", "chat_rules", "payment_rules"],
        acceptedLegalDocumentTypes: requiredDocumentTypesForRegistration("client"),
        dependentDataTransferConfirmed: true
      }
    });
    assert.equal(response.status, 409);
    assert.equal(response.payload.error, "Пользователь с таким телефоном уже зарегистрирован");

    response = await apiRequest(app, "/api/auth/login", {
      method: "POST",
      body: { phoneOrEmail: "client@zabota.local", password: "password123" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.email, "client@zabota.local");

    response = await apiRequest(app, "/api/auth/login", {
      method: "POST",
      body: { phoneOrEmail: "+79224000320", password: "password123" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.id, createdUserId);

    response = await apiRequest(app, "/api/auth/login", {
      method: "POST",
      body: { phoneOrEmail: "8 922 400 03 20", password: "password123" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.id, createdUserId);

    response = await apiRequest(app, "/api/auth/login", {
      method: "POST",
      body: { phoneOrEmail: "admin@zabota.local", password: "password123" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.id, admin.id);
  } finally {
    if (createdUserId) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorUserId: createdUserId },
            { entityType: "user", entityId: createdUserId }
          ]
        }
      });
      await prisma.user.delete({ where: { id: createdUserId } }).catch(() => null);
    }
  }
}

function tokenFor(userId: string, role: string) {
  return jwt.sign({ sub: userId, role }, env.jwtSecret);
}

function firstFileName(directoryPath: string) {
  return readdirSync(directoryPath)
    .find((entry) => statSync(path.join(directoryPath, entry)).isFile());
}

function testProjectRoot() {
  const cwd = process.cwd();
  if (directoryExists(path.join(cwd, "frontend")) || directoryExists(path.join(cwd, "landing-public"))) return cwd;
  const parent = path.resolve(cwd, "..");
  if (directoryExists(path.join(parent, "frontend")) || directoryExists(path.join(parent, "landing-public"))) return parent;
  return cwd;
}

function directoryExists(directoryPath: string) {
  try {
    return statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function expressRoutePaths(app: ReturnType<typeof createApp>) {
  return ((app as any)._router?.stack ?? []).flatMap((layer: any) => {
    if (!layer.route) return [];
    return Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
  });
}

function routeIndex(app: ReturnType<typeof createApp>, expectedPath: string) {
  return ((app as any)._router?.stack ?? []).findIndex((layer: any) => {
    if (!layer.route) return false;
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    return paths.includes(expectedPath);
  });
}

async function apiRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  options: {
    method: "GET" | "POST";
    token?: string;
    body?: unknown;
  }
) {
  const response = await rawAppRequest(app, path, options);
  const payload = response.text ? JSON.parse(response.text) : null;
  return { status: response.status, payload };
}

async function rawAppRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  options: {
    method?: "GET" | "POST";
    token?: string;
    body?: unknown;
  } = {}
) {
  const method = options.method ?? "GET";
  const bodyText = options.body === undefined ? "" : JSON.stringify(options.body);
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(Buffer.byteLength(bodyText));
  }
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  let bodyPushed = false;
  const req = new Readable({
    read() {
      if (bodyPushed) {
        this.push(null);
        return;
      }
      bodyPushed = true;
      if (bodyText) this.push(bodyText);
      this.push(null);
    }
  }) as any;
  req.method = method;
  req.url = path;
  req.originalUrl = path;
  req.headers = headers;

  const chunks: Buffer[] = [];
  const responseHeaders: Record<string, unknown> = {};
  const res = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding as BufferEncoding));
      callback();
    }
  }) as any;
  res.statusCode = 200;
  res.setHeader = (name: string, value: unknown) => {
    responseHeaders[name.toLowerCase()] = value;
  };
  res.getHeader = (name: string) => responseHeaders[name.toLowerCase()];
  res.getHeaders = () => responseHeaders;
  res.removeHeader = (name: string) => {
    delete responseHeaders[name.toLowerCase()];
  };
  res.writeHead = (statusCode: number, headersOrReason?: Record<string, unknown> | string, headersArg?: Record<string, unknown>) => {
    res.statusCode = statusCode;
    const nextHeaders = typeof headersOrReason === "object" ? headersOrReason : headersArg;
    if (nextHeaders) {
      for (const [name, value] of Object.entries(nextHeaders)) {
        res.setHeader(name, value);
      }
    }
    return res;
  };

  const done = new Promise<void>((resolve) => {
    res.end = (chunk?: unknown, encoding?: BufferEncoding | (() => void), callback?: () => void) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === "string" ? encoding : "utf8"));
      }
      if (typeof encoding === "function") encoding();
      if (callback) callback();
      resolve();
      return res;
    };
  });

  app(req, res);
  await done;
  const responseText = Buffer.concat(chunks).toString("utf8");
  return {
    status: res.statusCode,
    headers: responseHeaders,
    contentType: String(responseHeaders["content-type"] ?? ""),
    text: responseText
  };
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
