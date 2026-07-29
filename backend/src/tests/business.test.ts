import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import jwt from "jsonwebtoken";
import { createApp } from "../app";
import { prisma } from "../db/prisma";
import { calculatePrice, PRICING_ADDONS } from "../services/pricingService";
import { moderateChatMessage } from "../services/moderationService";
import { detectMedicalTerms } from "../services/requestPolicy";
import { nextRequestPublicNumber } from "../services/requestNumberService";
import {
  adjustUserBalanceByAdmin,
  ensureFixedServiceFeeSettings,
  FIXED_SERVICE_FEE_AMOUNT,
  getServiceFeeSettings,
  hasAvailableBalance
} from "../services/balanceService";
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
import {
  VK_OAUTH_SESSION_COOKIE,
  VK_OAUTH_TRANSACTION_COOKIE,
  createVkOAuthSessionCookie,
  isUserProfileComplete,
  resolveVkUser
} from "../services/vkIdService";
import {
  TRIAL_BALANCE_DESCRIPTION,
  TRIAL_BALANCE_SETTING_KEY,
  getTrialBalanceSettings,
  grantTrialBalanceToUser,
  updateTrialBalanceSettings
} from "../services/trialBalanceService";
import { env, resolveDefaultServiceFeeAmount, resolveTbankTerminalMode, resolveUploadsDir } from "../config/env";
import { creditPaymentToBalance, paymentCreditIdempotencyKey } from "../services/paymentService";
import { normalizeSettlementName } from "../services/settlementService";
import { getUserArchiveSafety, OAUTH_PENDING_CANCEL_ARCHIVE_REASON } from "../services/userLifecycleService";
import { resolveStoragePath, savePerformerDocumentFile } from "../services/uploadStorage";
import {
  LEGAL_DOCUMENT_KEYS,
  LEGAL_DOCUMENT_DEFINITIONS,
  acceptLatestLegalDocuments,
  calculateLegalDocumentHash,
  ensureLegalDocuments,
  missingAcceptedDocumentTypes,
  requiredDocumentTypesForFeature,
  requiredDocumentTypesForRegistration,
  roleToLegalScope
} from "../services/legalService";
import {
  buildCityTemplateExport,
  categoriesForCity,
  createDraftFromImport,
  createRequestCategorySnapshotTx,
  createStructureFromParent,
  ensureFederalCategoryStructure,
  getEffectiveCategoryStructure,
  publishCategoryStructure,
  saveHelperCategoryPreferences,
  validateCategoryImport
} from "../services/categoryStructureService";
import {
  createBroadcast,
  assertServiceAttachmentDownloadAccess,
  getMyServiceMessage,
  hasCurrentMarketingConsent,
  markServiceMessageRead,
  previewBroadcast,
  sendBroadcast,
  sendServiceMessage
} from "../services/serviceCommunicationService";
import { prepareServiceAttachments, removeSavedServiceAttachments } from "../services/serviceMessageStorage";

async function run() {
  assert.equal(resolveTbankTerminalMode({}), "test");
  assert.equal(resolveTbankTerminalMode({ TBANK_TERMINAL_MODE: "test" }), "test");
  assert.equal(resolveTbankTerminalMode({ TBANK_TERMINAL_MODE: "live" }), "live");
  assert.equal(resolveTbankTerminalMode({ TBANK_TERMINAL_MODE: "invalid" }), "test");
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
  assert.equal(resolveDefaultServiceFeeAmount({ DEFAULT_SERVICE_FEE_AMOUNT: "50", DEFAULT_COMMISSION_AMOUNT: "70" }), 50);
  assert.equal(resolveDefaultServiceFeeAmount({ DEFAULT_COMMISSION_AMOUNT: "70" }), 50);

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
    assert.equal(capturedInitRequest.PayType, "O");
    assert.equal(capturedInitRequest.Description, "Пополнение баланса Забота Рядом");
    assert.deepEqual(capturedInitRequest.DATA, { userId: "user42", purpose: "balance_top_up" });
    assert.equal(capturedInitRequest.Token, buildTbankToken(capturedInitRequest, "TEST_PASSWORD"));
    assert.equal(tbankInit.provider, "tbank");
    assert.equal(tbankInit.providerPaymentId, "123456");
    assert.equal(tbankInit.paymentUrl, "https://securepay.test/payment/123456");
    assert.equal(tbankInit.status, "pending");
    assert.match(tbankInit.rawRequestJson ?? "", /TEST_TERMINAL/);
    assert.match(tbankInit.rawResponseJson ?? "", /PaymentURL/);
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body ?? "{}"));
      assert.equal(String(url), "https://securepay.test/v2/GetState");
      assert.equal(requestBody.TerminalKey, "TEST_TERMINAL");
      assert.equal(requestBody.PaymentId, "123456");
      assert.equal(requestBody.Token, buildTbankToken(requestBody, "TEST_PASSWORD"));
      return new Response(JSON.stringify({
        Success: true,
        TerminalKey: "TEST_TERMINAL",
        PaymentId: "123456",
        OrderId: orderId,
        Amount: 15000,
        Status: "CONFIRMED"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const tbankState = await tbankPaymentAdapter.getState!({
      providerPaymentId: "123456",
      orderId,
      amount: 150
    });
    assert.equal(tbankState.providerStatus, "CONFIRMED");
    assert.equal(tbankState.amountKopecks, 15000);
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body ?? "{}"));
      assert.equal(String(url), "https://securepay.test/v2/Cancel");
      assert.equal(requestBody.TerminalKey, "TEST_TERMINAL");
      assert.equal(requestBody.PaymentId, "123456");
      assert.equal(requestBody.Amount, 15000);
      assert.equal(requestBody.ExternalRequestId, "550e8400-e29b-41d4-a716-446655440000");
      assert.equal(requestBody.Token, buildTbankToken(requestBody, "TEST_PASSWORD"));
      assert.equal(Object.prototype.hasOwnProperty.call(requestBody, "Receipt"), false);
      return new Response(JSON.stringify({
        Success: true,
        PaymentId: "123456",
        RefundId: "REFUND-123456",
        Amount: 15000,
        Status: "REFUNDED"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const tbankRefund = await tbankPaymentAdapter.refundPayment({
      providerPaymentId: "123456",
      orderId,
      amount: 150,
      externalRequestId: "550e8400-e29b-41d4-a716-446655440000"
    });
    assert.equal(tbankRefund.providerStatus, "REFUNDED");
    assert.equal(tbankRefund.providerRefundId, "REFUND-123456");
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

  const expectedPackages = [
    ["short_help", 400, 700],
    ["home_help_2h", 700, 1100],
    ["supervision_2h", 700, 1200],
    ["accompaniment_standard", 800, 1500],
    ["help_3_4h", 1200, 2000],
    ["regular_help", 700, null]
  ] as const;
  for (const [packageId, priceMin, priceMax] of expectedPackages) {
    const quote = calculatePrice({ category: homeHelpCategory, packageId });
    assert.equal(quote.packageId, packageId);
    assert.equal(quote.packagePriceMin, priceMin);
    assert.equal(quote.packagePriceMax, priceMax);
  }

  const agreedQuote = calculatePrice({
    category: homeHelpCategory,
    packageId: "home_help_2h",
    helperAmount: 950
  });
  assert.equal(agreedQuote.customerServiceFeeAmount, 50);
  assert.equal(agreedQuote.helperServiceFeeAmount, 50);
  assert.equal(agreedQuote.customerTotalAmount, 1000);
  assert.equal(agreedQuote.helperNetAmount, 900);
  assert.equal(agreedQuote.customerTotalMin, 750);
  assert.equal(agreedQuote.customerTotalMax, 1150);
  assert.equal(agreedQuote.minTopUpAmount, 150);
  assert.equal(JSON.stringify(agreedQuote).includes("550 ₽"), false);
  assert.equal(/комиссия/i.test(JSON.stringify(agreedQuote)), false);

  const simpleMealInsidePackage = calculatePrice({
    category: homeHelpCategory,
    packageId: "home_help_2h",
    selectedActions: ["simple_cooking", "light_cleaning", "trash", "dishes"]
  });
  assert.equal(simpleMealInsidePackage.addons.length, 0);
  assert.equal(simpleMealInsidePackage.helperAmount, 700);

  const explicitMealAddon = calculatePrice({
    category: homeHelpCategory,
    packageId: "home_help_2h",
    selectedAddonIds: ["simple_meal_extra"]
  });
  assert.equal(explicitMealAddon.addons[0]?.amountMin, 150);
  assert.equal(explicitMealAddon.addons[0]?.amountMax, 300);

  assert.deepEqual(
    Object.fromEntries(Object.values(PRICING_ADDONS).map((item) => [item.id, [item.priceMin, item.priceMax]])),
    {
      extra_hour: [250, 400],
      waiting: [200, 300],
      second_address: [150, 300],
      shopping: [200, 400],
      simple_meal_extra: [150, 300],
      urgent: [200, 500],
      transport_expenses: [null, null]
    }
  );

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
    contactName: "Тест Заказчик",
    contactPhone: "+79000000002",
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
  assert.equal(helperBefore.contactName, null);
  assert.equal(helperBefore.contactPhone, null);
  assert.equal(helperBefore.publicAddress, "Югорск, ул. Мира");
  const helperAfter = serializeRequestForUser({ ...requestForAddress, status: "in_progress", chats: [{ id: "chat-1", status: "in_work", performerId: "performer-1", archivedAt: null }] }, { id: "performer-1", role: "performer" } as any) as any;
  assert.equal(helperAfter.addressHouse, "10");
  assert.equal(helperAfter.yandexExactMapAddress, "Югорск, ул. Мира, 10");
  assert.match(helperAfter.yandexExactMapUrl, /%D0%AE%D0%B3%D0%BE%D1%80%D1%81%D0%BA/);
  assert.match(helperAfter.fullAddress, /квартира 15/);
  assert.equal(helperAfter.fullAddress.includes("домофон"), false);
  assert.equal(helperAfter.addressIntercom, "15");
  assert.equal(helperAfter.contactName, null);
  assert.equal(helperAfter.contactPhone, null);
  const customerAddress = serializeRequestForUser(requestForAddress, { id: "client-1", role: "client" } as any) as any;
  assert.match(customerAddress.fullAddress, /ул\. Мира, 10/);
  assert.equal(customerAddress.contactName, "Тест Заказчик");
  assert.equal(customerAddress.contactPhone, "+79000000002");
  const adminAddress = serializeRequestForUser(requestForAddress, { id: "admin-1", role: "admin" } as any) as any;
  assert.equal(adminAddress.fullAddress, "Югорск, ул. Мира, 10, подъезд 2, этаж 3, квартира 15");
  assert.equal(adminAddress.yandexPublicMapAddress, "Югорск, ул. Мира");
  assert.equal(adminAddress.yandexExactMapAddress, "Югорск, ул. Мира, 10");
  assert.match(adminAddress.yandexPublicMapUrl, /^https:\/\/yandex\.ru\/maps\/\?text=/);
  assert.match(adminAddress.yandexExactMapUrl, /^https:\/\/yandex\.ru\/maps\/\?text=/);
  assert.equal(adminAddress.contactName, "Тест Заказчик");
  assert.equal(adminAddress.contactPhone, "+79000000002");

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
    "privacy",
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
    "privacy",
    "personal_data_consent",
    "service_rules",
    "service_notifications_consent"
  ]);
  assert.deepEqual(requiredDocumentTypesForRegistration("performer"), [
    "helper_terms",
    "privacy",
    "personal_data_consent",
    "service_rules",
    "helper_documents_consent",
    "service_notifications_consent"
  ]);
  assert.deepEqual(missingAcceptedDocumentTypes("client", ["customer_agreement"]), [
    "privacy",
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
  await runSettlementDirectoryTests();
  await runLegalBootstrapTests();
  await runAuthPhoneTests();
  await runVkOAuthTests();
  await runOAuthPendingCancellationTests();
  await runTrialBalanceTests();
  await runBonusServiceFeeTests();
  await runCriticalSafetyTests();
  await runPaymentCreditIdempotencyTests();
  await runPaymentRouteTests();
  await runAdminBalanceAdjustmentTests();
  await runAdminActingModeTests();
  await runManagerRoleTests();
  await runUserLifecycleTests();
  await runUploadStorageTests();
  await runCategoryStructureTests();
  await runServiceCommunicationTests();

  console.log("Business tests passed");
}

async function runServiceCommunicationTests() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const app = createApp();
  const city = await prisma.city.create({ data: { name: `Город сообщений ${suffix}`, normalizedName: `город сообщений ${suffix}`, slug: `messages-${suffix}`, region: "Тестовый регион", status: "active", serviceStatus: "active", isActive: true, mapCenterLat: 60, mapCenterLng: 60 } });
  const admin = await prisma.user.create({ data: { role: "admin", rolesJson: '["admin"]', displayName: `Администратор сообщений ${suffix}`, status: "active" } });
  const manager = await prisma.user.create({ data: { role: "manager", rolesJson: '["manager"]', displayName: `Менеджер сообщений ${suffix}`, status: "active" } });
  const customer = await prisma.user.create({ data: { role: "client", rolesJson: '["client"]', displayName: `Заказчик сообщений ${suffix}`, status: "active", cityId: city.id } });
  const customerWithoutConsent = await prisma.user.create({ data: { role: "client", rolesJson: '["client"]', displayName: `Заказчик без согласия ${suffix}`, status: "active", cityId: city.id } });
  const helper = await prisma.user.create({ data: { role: "performer", rolesJson: '["performer"]', displayName: `Помощник сообщений ${suffix}`, status: "active", cityId: city.id } });
  const archived = await prisma.user.create({ data: { role: "client", rolesJson: '["client"]', displayName: `Архив сообщений ${suffix}`, status: "archived", cityId: city.id } });
  const userIds = [admin.id, manager.id, customer.id, customerWithoutConsent.id, helper.id, archived.id];
  const storagePaths: string[] = [];
  try {
    const marketingDocument = await prisma.legalDocument.findFirstOrThrow({ where: { type: "marketing_notifications_consent", isActive: true, isPublished: true }, orderBy: { publishedAt: "desc" } });
    await prisma.userConsent.create({ data: { userId: customer.id, documentId: marketingDocument.id, documentType: marketingDocument.type, documentVersion: marketingDocument.version, documentTitle: marketingDocument.title, documentContentHash: marketingDocument.contentHash, isRequired: false, source: "test" } });
    assert.equal(await hasCurrentMarketingConsent(customer.id), true);
    assert.equal(await hasCurrentMarketingConsent(customerWithoutConsent.id), false);

    const pdf = Buffer.from("%PDF-1.4\nservice-message-test").toString("base64");
    const sent = await sendServiceMessage({ id: admin.id, realRole: "admin" }, customer.id, { title: "Информация по оплате", body: "Сервисный платёж сохранён.", messageType: "service_message", clientRequestId: `message-${suffix}`, files: [{ fileName: "../../receipt.pdf", mimeType: "application/pdf", fileData: pdf, attachmentType: "npd_receipt" }] });
    assert.equal(sent.idempotent, false);
    assert.equal(sent.message.attachments.length, 1);
    assert.equal(sent.message.attachments[0].originalFileName, "receipt.pdf");
    assert.doesNotMatch(sent.message.attachments[0].fileName, /\.\./);
    assert.equal(sent.message.attachments[0].userId, customer.id);
    storagePaths.push(sent.message.attachments[0].storagePath);
    const payment = await prisma.paymentTransaction.create({ data: { userId: customer.id, provider: "mock", orderId: `message-payment-${suffix}`, amount: 150, status: "succeeded" } });
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString("base64");
    const imageMessage = await sendServiceMessage({ id: admin.id, realRole: "admin" }, customer.id, { body: "Документ по сервисному платежу.", title: "Информация по оплате", messageType: "service_message", relatedPaymentTransactionId: payment.id, files: [{ fileName: "payment.png", mimeType: "image/png", fileData: png, attachmentType: "payment_receipt" }] });
    assert.equal(imageMessage.message.relatedPaymentTransactionId, payment.id);
    assert.equal(imageMessage.message.attachments[0].relatedPaymentTransactionId, payment.id);
    storagePaths.push(imageMessage.message.attachments[0].storagePath);
    const repeated = await sendServiceMessage({ id: admin.id, realRole: "admin" }, customer.id, { title: "Повтор", body: "Повтор", messageType: "service_message", clientRequestId: `message-${suffix}` });
    assert.equal(repeated.idempotent, true);

    const second = await sendServiceMessage({ id: manager.id, realRole: "manager" }, customer.id, { title: "Уточнение", body: "Проверьте данные профиля.", messageType: "service_message" });
    assert.equal(second.message.conversationId, sent.message.conversationId);
    await assert.rejects(() => sendServiceMessage({ id: manager.id, realRole: "manager" }, admin.id, { body: "Недоступно", messageType: "service_message" }), /Менеджер не может/);
    await assert.rejects(() => sendServiceMessage({ id: admin.id, realRole: "admin" }, customer.id, { body: "Файл", messageType: "service_message", files: [{ fileName: "bad.exe", mimeType: "application/octet-stream", fileData: "AA==" }] }), /Разрешены PDF/);
    await assert.rejects(() => sendServiceMessage({ id: admin.id, realRole: "admin" }, customer.id, { body: "Много файлов", messageType: "service_message", files: Array.from({ length: 6 }, (_, index) => ({ fileName: `${index}.pdf`, mimeType: "application/pdf", fileData: pdf })) }), /не более 5/);
    assert.throws(() => prepareServiceAttachments([{ fileName: "large.pdf", mimeType: "application/pdf", fileData: Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(10 * 1024 * 1024)]).toString("base64") }]), /не более 10 МБ/);

    const own = await getMyServiceMessage(customer.id, sent.message.id);
    assert.equal(own.userId, customer.id);
    await assert.rejects(() => getMyServiceMessage(helper.id, sent.message.id), /Сообщение не найдено/);
    const beforeRead = await prisma.serviceConversation.findUniqueOrThrow({ where: { userId: customer.id } });
    await markServiceMessageRead(customer.id, sent.message.id);
    const afterRead = await prisma.serviceConversation.findUniqueOrThrow({ where: { userId: customer.id } });
    assert.equal(afterRead.unreadForUserCount, beforeRead.unreadForUserCount - 1);

    const servicePreview = await previewBroadcast({ id: admin.id, realRole: "admin" }, { title: "Объявление", body: "Важная информация.", campaignType: "service_announcement", targetRole: "customer", targetCityId: city.id });
    assert.equal(servicePreview.willReceive, 2);
    assert.equal(servicePreview.skippedInactive, 1);
    const marketingPreview = await previewBroadcast({ id: admin.id, realRole: "admin" }, { title: "Новость", body: "Маркетинговое объявление.", campaignType: "marketing_announcement", targetRole: "customer", targetCityId: city.id });
    assert.equal(marketingPreview.willReceive, 1);
    assert.equal(marketingPreview.skippedNoConsent, 1);
    await assert.rejects(() => previewBroadcast({ id: manager.id, realRole: "manager" }, { title: "Нет", body: "Нет", campaignType: "service_announcement", targetRole: "all" }), /Менеджер не может/);

    const created = await createBroadcast({ id: admin.id, realRole: "admin" }, { title: "Новость", body: "Маркетинговое объявление.", campaignType: "marketing_announcement", targetRole: "customer", targetCityId: city.id, clientRequestId: `broadcast-${suffix}` });
    const delivery = await sendBroadcast({ id: admin.id, realRole: "admin" }, created.campaign.id, true);
    assert.equal(delivery.campaign.deliveredCount, 1);
    const deliveredMessages = await prisma.serviceMessage.count({ where: { broadcastId: created.campaign.id } });
    await sendBroadcast({ id: admin.id, realRole: "admin" }, created.campaign.id, true);
    assert.equal(await prisma.serviceMessage.count({ where: { broadcastId: created.campaign.id } }), deliveredMessages);
    assert.ok(await prisma.auditLog.findFirst({ where: { actorUserId: admin.id, action: "admin.broadcast.send", entityId: created.campaign.id } }));
    assert.ok(await prisma.auditLog.findFirst({ where: { actorUserId: customer.id, action: "user.service_message.read", entityId: sent.message.id } }));

    let response = await apiRequest(app, `/api/admin/service-conversations/${customer.id}/messages`, { method: "POST", token: tokenFor(customer.id, "client"), body: { body: "Запрещено", messageType: "service_message" } });
    assert.equal(response.status, 403);
    response = await apiRequest(app, `/api/me/service-messages/${sent.message.id}`, { method: "GET", token: tokenFor(helper.id, "performer") });
    assert.equal(response.status, 404);
    assert.doesNotThrow(() => assertServiceAttachmentDownloadAccess({ id: customer.id, realRole: "client" }, { id: customer.id, role: "client" }));
    assert.doesNotThrow(() => assertServiceAttachmentDownloadAccess({ id: manager.id, realRole: "manager" }, { id: customer.id, role: "client" }));
    assert.throws(() => assertServiceAttachmentDownloadAccess({ id: helper.id, realRole: "performer" }, { id: customer.id, role: "client" }), /Нет доступа/);
    assert.throws(() => assertServiceAttachmentDownloadAccess({ id: manager.id, realRole: "manager" }, { id: admin.id, role: "admin" }), /Нет доступа/);
  } finally {
    const attachments = await prisma.serviceMessageAttachment.findMany({ where: { userId: { in: userIds } }, select: { storagePath: true } });
    await removeSavedServiceAttachments([...storagePaths, ...attachments.map((row) => row.storagePath)]);
    const campaignIds = (await prisma.broadcastCampaign.findMany({ where: { createdByAdminId: admin.id }, select: { id: true } })).map((row) => row.id);
    await prisma.broadcastRecipient.deleteMany({ where: { campaignId: { in: campaignIds } } });
    await prisma.serviceMessageAttachment.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.serviceMessage.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.paymentTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.broadcastCampaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.serviceConversation.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userConsent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.city.delete({ where: { id: city.id } });
  }
}

async function runCategoryStructureTests() {
  const suffix = Date.now().toString(36);
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { in: ["admin", "superadmin"] } } });
  const helper = await prisma.user.findFirstOrThrow({ where: { role: "performer" } });
  const customer = await prisma.user.findFirstOrThrow({ where: { role: "client" } });
  const legacyCategory = await prisma.serviceCategory.findFirstOrThrow();
  const federalBefore = await ensureFederalCategoryStructure();
  const federalAgain = await ensureFederalCategoryStructure();
  assert.equal(federalAgain.id, federalBefore.id);
  assert.equal(await prisma.categoryStructure.count({ where: { scopeKey: "federal", versionNumber: "1.0" } }), 1);

  const region = await prisma.region.create({ data: { name: `Тестовый регион ${suffix}`, slug: `test-region-${suffix}` } });
  const city = await prisma.city.create({ data: {
    name: `Тестовый город ${suffix}`,
    slug: `test-city-${suffix}`,
    normalizedName: `тестовый город ${suffix}`,
    region: region.name,
    regionId: region.id,
    status: "active",
    serviceStatus: "active",
    isActive: true,
    mapCenterLat: 60,
    mapCenterLng: 60
  } });
  const createdStructureIds: string[] = [];
  const requestIds: string[] = [];
  try {
    assert.equal((await getEffectiveCategoryStructure(city.id)).status, "uses_federal_fallback");
    const regionDraft = await createStructureFromParent({ scopeType: "region", regionId: region.id }, admin.id);
    createdStructureIds.push(regionDraft.id);
    assert.equal(regionDraft.status, "draft");
    await publishCategoryStructure(regionDraft.id, admin.id);
    assert.equal((await getEffectiveCategoryStructure(city.id)).status, "uses_region_fallback");

    const cityDraft = await createStructureFromParent({ scopeType: "city", cityId: city.id }, admin.id);
    createdStructureIds.push(cityDraft.id);
    assert.equal(cityDraft.parentStructureId, regionDraft.id);
    await publishCategoryStructure(cityDraft.id, admin.id);
    assert.equal((await getEffectiveCategoryStructure(city.id)).status, "local_ready");

    const customerCategories = await categoriesForCity(city.id, "customer");
    assert.ok(customerCategories.categories.length > 0);
    assert.equal(Object.prototype.hasOwnProperty.call(customerCategories.categories[0], "descriptionForAdmin"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(customerCategories.categories[0], "isVisibleForAdmin"), false);

    const exported = await buildCityTemplateExport(city.id, admin.id);
    assert.match(exported.fileName, new RegExp(`testovyy-region-${suffix}_test-city-${suffix}`));
    assert.equal(exported.sheets.length, 6);

    const invalidSlug = validateCategoryImport({ scope: { type: "city", cityId: city.id }, categories: [{ slug: "Плохой slug", title: "Проверка" }] });
    assert.equal(invalidSlug.valid, false);
    assert.ok(invalidSlug.errors.some((error) => error.includes("Некорректный slug")));
    assert.equal(validateCategoryImport({ scope: { type: "city", cityId: city.id }, categories: [{ slug: "unsafe", title: "Медицинские услуги" }] }).valid, false);
    assert.equal(validateCategoryImport({ scope: { type: "city", cityId: city.id }, categories: [{ slug: "safe", title: "Помощь" }], pricingRules: [{ categorySlug: "safe", recommendedMinPrice: 900, recommendedMaxPrice: 500 }] }).valid, false);

    const structure = await prisma.categoryStructure.findUniqueOrThrow({ where: { id: cityDraft.id }, include: { categories: true } });
    const rootCategory = structure.categories.find((category) => !category.parentId)!;
    const childCategory = structure.categories.find((category) => category.parentId === rootCategory.id)!;
    const request = await prisma.clientRequest.create({ data: {
      clientId: customer.id,
      cityId: city.id,
      categoryId: legacyCategory.id,
      title: "Тест snapshot категории",
      description: "Проверка сохранения выбранной категории в истории заявки.",
      addressText: city.name,
      approximateAddressText: city.name
    } });
    requestIds.push(request.id);
    const snapshot = await prisma.$transaction((tx) => createRequestCategorySnapshotTx(tx, { requestId: request.id, cityId: city.id, categoryId: rootCategory.id, subcategoryId: childCategory.id }));
    assert.ok(snapshot);
    assert.equal(JSON.parse(snapshot!.snapshotJson).category.slug, rootCategory.slug);
    await prisma.category.update({ where: { id: rootCategory.id }, data: { title: "Временно переименовано" } });
    assert.equal(JSON.parse((await prisma.requestCategorySnapshot.findUniqueOrThrow({ where: { id: snapshot!.id } })).snapshotJson).category.title, rootCategory.title);

    const preferences = await saveHelperCategoryPreferences(helper.id, { cityId: city.id, categoryIds: [rootCategory.id] });
    assert.equal(preferences.filter((item) => item.isEnabled).length, 1);
    assert.equal(preferences[0].categorySlug, rootCategory.slug);
    assert.equal(Object.prototype.hasOwnProperty.call(preferences[0].category, "descriptionForAdmin"), false);

    const importedDraft = await createDraftFromImport(exported.payload, admin.id, exported.fileName);
    createdStructureIds.push(importedDraft.id);
    assert.equal(importedDraft.status, "draft");
    await publishCategoryStructure(importedDraft.id, admin.id);
    assert.equal((await prisma.categoryStructure.findUniqueOrThrow({ where: { id: cityDraft.id } })).status, "archived");
    assert.equal((await getEffectiveCategoryStructure(city.id)).structure?.id, importedDraft.id);

    const manager = await prisma.user.findFirst({ where: { role: "manager" } });
    if (manager) {
      const denied = await apiRequest(createApp(), "/api/admin/category-structures/create-from-parent", { method: "POST", token: tokenFor(manager.id, "manager"), body: { scopeType: "city", cityId: city.id } });
      assert.equal(denied.status, 403);
    }
  } finally {
    await prisma.requestCategorySnapshot.deleteMany({ where: { requestId: { in: requestIds } } });
    await prisma.clientRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.helperCategoryPreference.deleteMany({ where: { cityId: city.id } });
    await prisma.categoryStructure.deleteMany({ where: { id: { in: createdStructureIds } } });
    await prisma.city.delete({ where: { id: city.id } });
    await prisma.region.delete({ where: { id: region.id } });
  }
}

async function runAdminBalanceAdjustmentTests() {
  const app = createApp();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { in: ["admin", "superadmin"] }, status: "active" } });
  const adminToken = tokenFor(admin.id, admin.role);
  const createdUserIds: string[] = [];
  const target = await prisma.user.create({
    data: { role: "client", rolesJson: '["client"]', displayName: `Balance target ${suffix}`, status: "active", balance: 300, bonusBalance: 200 }
  });
  const manager = await prisma.user.create({
    data: { role: "manager", rolesJson: '["manager"]', displayName: `Balance manager ${suffix}`, status: "active" }
  });
  const adminTarget = await prisma.user.create({
    data: { role: "admin", rolesJson: '["admin"]', displayName: `Balance admin ${suffix}`, status: "active" }
  });
  const superadminTarget = await prisma.user.create({
    data: { role: "superadmin", rolesJson: '["superadmin"]', displayName: `Balance superadmin ${suffix}`, status: "active" }
  });
  const performerTarget = await prisma.user.create({
    data: { role: "performer", rolesJson: '["performer"]', displayName: `Balance helper ${suffix}`, status: "active" }
  });
  const archived = await prisma.user.create({
    data: { role: "client", rolesJson: '["client"]', displayName: `Balance archived ${suffix}`, status: "archived" }
  });
  const pending = await prisma.user.create({
    data: { role: "oauth_pending", rolesJson: "[]", displayName: `Balance pending ${suffix}`, status: "active" }
  });
  createdUserIds.push(target.id, manager.id, adminTarget.id, superadminTarget.id, performerTarget.id, archived.id, pending.id);
  const managerToken = tokenFor(manager.id, "manager");
  const targetToken = tokenFor(target.id, "client");
  const endpoint = `/api/admin/users/${target.id}/balance-adjustment`;
  const body = (overrides: Record<string, unknown> = {}) => ({
    wallet: "main",
    direction: "credit",
    amount: 150,
    reason: "manual_correction",
    comment: "Проверенная ручная корректировка баланса",
    clientRequestId: `adjust-${suffix}-${Math.random().toString(36).slice(2)}`,
    ...overrides
  });

  try {
    let response = await apiRequest(app, "/api/admin/summary", { method: "GET", token: adminToken });
    assert.equal(response.status, 200);
    assert.ok(response.payload.managersTotal >= 1);
    assert.ok(response.payload.managersActive >= 1);
    assert.equal(Object.prototype.hasOwnProperty.call(response.payload, "balanceTotal"), false);

    const paymentCountBefore = await prisma.paymentTransaction.count({ where: { userId: target.id } });
    const creditBody = body({ clientRequestId: `credit-main-${suffix}` });
    response = await apiRequest(app, endpoint, { method: "POST", token: adminToken, body: creditBody });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.balance, 450);
    assert.equal(response.payload.user.bonusBalance, 200);
    assert.equal(response.payload.transaction.type, "admin_balance_credit");
    assert.equal(response.payload.transaction.amount, 150);
    assert.equal(response.payload.transaction.balanceBefore, 300);
    assert.equal(response.payload.transaction.balanceAfter, 450);
    assert.equal(response.payload.transaction.createdByAdminId, admin.id);
    assert.match(response.payload.transaction.idempotencyKey, /^admin_adjustment:/);
    const metadata = JSON.parse(response.payload.transaction.metadataJson);
    assert.deepEqual(
      [metadata.balanceBefore, metadata.balanceAfter, metadata.bonusBalanceBefore, metadata.bonusBalanceAfter],
      [300, 450, 200, 200]
    );
    assert.ok(await prisma.auditLog.findFirst({
      where: { actorUserId: admin.id, action: "admin.balance.adjust", entityId: response.payload.transaction.id }
    }));
    assert.equal(await prisma.paymentTransaction.count({ where: { userId: target.id } }), paymentCountBefore);

    response = await apiRequest(app, endpoint, { method: "POST", token: adminToken, body: creditBody });
    assert.equal(response.status, 200);
    assert.equal(response.payload.idempotent, true);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).balance, 450);
    assert.equal(await prisma.balanceTransaction.count({ where: { userId: target.id, type: "admin_balance_credit" } }), 1);

    response = await apiRequest(app, endpoint, { method: "POST", token: adminToken, body: body({ direction: "debit", amount: 50 }) });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.balance, 400);
    assert.equal(response.payload.transaction.type, "admin_balance_debit");

    response = await apiRequest(app, endpoint, { method: "POST", token: adminToken, body: body({ wallet: "bonus", amount: 70 }) });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.bonusBalance, 270);
    assert.equal(response.payload.transaction.type, "admin_bonus_credit");

    response = await apiRequest(app, endpoint, { method: "POST", token: adminToken, body: body({ wallet: "bonus", direction: "debit", amount: 20 }) });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.bonusBalance, 250);
    assert.equal(response.payload.transaction.type, "admin_bonus_debit");
    assert.equal(await prisma.npdTaxRegisterEntry.count({ where: { userId: target.id } }), 0,
      "Ручные корректировки основного и бонусного баланса не должны создавать записи НПД");

    const beforeRejectedDebit = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    response = await apiRequest(app, endpoint, { method: "POST", token: adminToken, body: body({ direction: "debit", amount: 1000 }) });
    assert.equal(response.status, 409);
    assert.equal(response.payload.code, "insufficient_wallet_balance");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).balance, beforeRejectedDebit.balance);

    response = await apiRequest(app, `/api/admin/users/${archived.id}/balance-adjustment`, { method: "POST", token: adminToken, body: body() });
    assert.equal(response.status, 409);
    assert.equal(response.payload.code, "archived_user_balance_adjustment_forbidden");
    response = await apiRequest(app, `/api/admin/users/${pending.id}/balance-adjustment`, { method: "POST", token: adminToken, body: body() });
    assert.equal(response.status, 409);
    assert.equal(response.payload.code, "oauth_pending_balance_adjustment_forbidden");
    for (const serviceTarget of [adminTarget, superadminTarget, manager]) {
      response = await apiRequest(app, `/api/admin/users/${serviceTarget.id}/balance-adjustment`, {
        method: "POST",
        token: adminToken,
        body: body()
      });
      assert.equal(response.status, 409);
      assert.equal(response.payload.code, "balance_adjustment_target_forbidden");
    }
    response = await apiRequest(app, `/api/admin/users/${performerTarget.id}/balance-adjustment`, {
      method: "POST",
      token: adminToken,
      body: body({ clientRequestId: `performer-credit-${suffix}` })
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.role, "performer");

    response = await apiRequest(app, endpoint, { method: "POST", token: managerToken, body: body() });
    assert.equal(response.status, 403);
    assert.equal(response.payload.code, "manager_permission_denied");
    response = await apiRequest(app, endpoint, { method: "POST", token: targetToken, body: body() });
    assert.equal(response.status, 403);
    assert.equal(response.payload.code, "admin_required");

    for (const invalidAmount of [0, -1, 1.5, 100_001]) {
      response = await apiRequest(app, endpoint, { method: "POST", token: adminToken, body: body({ amount: invalidAmount }) });
      assert.equal(response.status, 400);
    }
    response = await apiRequest(app, endpoint, { method: "POST", token: adminToken, body: body({ comment: "коротко" }) });
    assert.equal(response.status, 400);

    const beforeAuditFailure = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    const rollbackRequestId = `audit-rollback-${suffix}`;
    await assert.rejects(
      adjustUserBalanceByAdmin({
        actorUserId: admin.id,
        actorRole: admin.role as "admin" | "superadmin",
        targetUserId: target.id,
        wallet: "main",
        direction: "credit",
        amount: 25,
        reason: "manual_correction",
        comment: "Проверка полного отката при ошибке аудита",
        clientRequestId: rollbackRequestId
      }, {
        auditWriter: async () => { throw new Error("forced_audit_failure"); }
      }),
      /forced_audit_failure/
    );
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).balance, beforeAuditFailure.balance);
    assert.equal(await prisma.balanceTransaction.count({
      where: { idempotencyKey: `admin_adjustment:${target.id}:${admin.id}:${rollbackRequestId}` }
    }), 0);
  } finally {
    const transactionIds = (await prisma.balanceTransaction.findMany({ where: { userId: { in: createdUserIds } }, select: { id: true } })).map((row) => row.id);
    await prisma.auditLog.deleteMany({ where: { entityId: { in: transactionIds }, action: "admin.balance.adjust" } });
    await prisma.balanceTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
}

async function runManagerRoleTests() {
  const app = createApp();
  const startedAt = new Date();
  const [admin, candidate, target] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { role: { in: ["admin", "superadmin"] }, status: "active" } }),
    prisma.user.findFirstOrThrow({ where: { role: "client", status: "active", passwordHash: { not: null } } }),
    prisma.user.findFirstOrThrow({ where: { role: "performer", status: "active" } })
  ]);
  const originalCandidate = {
    role: candidate.role,
    rolesJson: candidate.rolesJson,
    roleBeforeManager: candidate.roleBeforeManager,
    managerAssignedAt: candidate.managerAssignedAt,
    managerAssignedByAdminId: candidate.managerAssignedByAdminId,
    managerRevokedAt: candidate.managerRevokedAt,
    managerRevokedByAdminId: candidate.managerRevokedByAdminId
  };
  const originalTarget = {
    status: target.status,
    blockedAt: target.blockedAt,
    blockedByAdminId: target.blockedByAdminId,
    blockedByRole: target.blockedByRole,
    blockReason: target.blockReason
  };
  const adminToken = tokenFor(admin.id, admin.role);
  let createdIdentityId: string | null = null;
  let managerCustomerId: string | null = null;
  let managerCreatedRequestId: string | null = null;

  try {
    let response = await apiRequest(app, `/api/admin/users/${candidate.id}/manager/assign`, {
      method: "POST",
      token: adminToken,
      body: { reason: "Операционная проверка" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.role, "manager");
    assert.equal(response.payload.roleBeforeManager, "client");

    const manager = await prisma.user.findUniqueOrThrow({ where: { id: candidate.id } });
    const managerToken = tokenFor(manager.id, "manager");
    const [activeCity, activeCategory] = await Promise.all([
      prisma.city.findFirstOrThrow({ where: { isActive: true, serviceStatus: "active", directoryStatus: { notIn: ["hidden", "duplicate"] } } }),
      prisma.serviceCategory.findFirstOrThrow({ where: { isActive: true } })
    ]);
    const managerCustomer = await prisma.user.create({
      data: {
        role: "client",
        rolesJson: '["client"]',
        displayName: `Manager customer ${Date.now()}`,
        phone: `+7999${String(Date.now()).slice(-7)}`,
        normalizedPhone: `+7999${String(Date.now()).slice(-7)}`,
        cityId: activeCity.id,
        status: "active",
        balance: 125,
        bonusBalance: 75
      }
    });
    managerCustomerId = managerCustomer.id;
    const linkedIdentity = await prisma.userIdentity.findFirst({ where: { userId: manager.id, provider: "vk" } });
    if (!linkedIdentity) {
      const identity = await prisma.userIdentity.create({
        data: {
          userId: manager.id,
          provider: "vk",
          providerUserId: `manager-test-${Date.now()}`,
          displayName: "Manager VK Test"
        }
      });
      createdIdentityId = identity.id;
    }

    response = await apiRequest(app, "/api/auth/login", {
      method: "POST",
      body: { phoneOrEmail: manager.email, password: "password123" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.role, "manager");

    response = await apiRequest(app, "/api/auth/login", {
      method: "POST",
      body: { phoneOrEmail: manager.phone, password: "password123" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.role, "manager");

    const vkSession = createVkOAuthSessionCookie(manager.id);
    response = await apiRequest(app, "/api/auth/oauth/session", {
      method: "POST",
      headers: { cookie: `${VK_OAUTH_SESSION_COOKIE}=${encodeURIComponent(vkSession)}` }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.role, "manager");
    assert.equal(response.payload.nextPath, "/app/manager");

    for (const path of [
      "/api/manager/users",
      "/api/manager/requests",
      "/api/manager/chats",
      "/api/manager/complaints",
      "/api/manager/payments",
      "/api/manager/balance-transactions"
    ]) {
      response = await apiRequest(app, path, { method: "GET", token: managerToken });
      assert.equal(response.status, 200, `Manager read failed for ${path}`);
    }

    response = await apiRequest(app, `/api/manager/users/${target.id}`, { method: "GET", token: managerToken });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.id, target.id);
    assert.equal(response.payload.finance.availableBalance, target.balance + target.bonusBalance);
    assert.ok(Array.isArray(response.payload.finance.balanceTransactions));
    assert.equal(typeof response.payload.activity.requestsCount, "number");
    assert.ok(await prisma.auditLog.findFirst({ where: { actorUserId: manager.id, action: "manager.user.view", entityId: target.id } }));

    const managerRequestBody = {
      customerUserId: managerCustomer.id,
      cityId: activeCity.id,
      categoryId: activeCategory.id,
      contactName: managerCustomer.displayName,
      contactPhone: managerCustomer.phone,
      helpFor: "elderly",
      title: "Помощь по дому от менеджера",
      description: "Нужна бытовая помощь и сопровождение в согласованное время.",
      addressStreet: "Улица Мира",
      addressHouse: "10",
      addressApartment: "12",
      date: new Date(Date.now() + 86_400_000).toISOString(),
      timeFrom: "10:00",
      timeTo: "12:00",
      expectedDurationHours: 2,
      priceEstimateAmount: 900,
      comment: "Условия нужно подтвердить с Заказчиком"
    };
    response = await apiRequest(app, "/api/manager/requests", { method: "POST", token: managerToken, body: managerRequestBody });
    assert.equal(response.status, 201);
    assert.equal(response.payload.clientId, managerCustomer.id);
    assert.equal(response.payload.createdByRole, "manager");
    assert.equal(response.payload.createdByManagerId, manager.id);
    assert.equal(response.payload.status, "draft");
    assert.equal(response.payload.visibilityStatus, "private");
    managerCreatedRequestId = response.payload.id;
    assert.equal(await prisma.requestResponse.count({ where: { requestId: managerCreatedRequestId! } }), 0);
    const managerCreateAudit = await prisma.auditLog.findFirstOrThrow({
      where: { actorUserId: manager.id, action: "manager.request.create_for_customer", entityId: managerCreatedRequestId }
    });
    assert.match(managerCreateAudit.payloadJson ?? "", new RegExp(managerCustomer.id));
    assert.match(managerCreateAudit.payloadJson ?? "", /manager_panel/);

    response = await apiRequest(app, "/api/manager/requests", {
      method: "POST",
      token: managerToken,
      body: { ...managerRequestBody, customerUserId: target.id }
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.code, "manager_customer_not_eligible");

    await prisma.user.update({ where: { id: managerCustomer.id }, data: { status: "blocked" } });
    response = await apiRequest(app, "/api/manager/requests", { method: "POST", token: managerToken, body: managerRequestBody });
    assert.equal(response.status, 400);
    assert.equal(response.payload.code, "manager_customer_not_eligible");
    await prisma.user.update({ where: { id: managerCustomer.id }, data: { status: "archived" } });
    response = await apiRequest(app, "/api/manager/requests", { method: "POST", token: managerToken, body: managerRequestBody });
    assert.equal(response.status, 400);
    assert.equal(response.payload.code, "manager_customer_not_eligible");
    await prisma.user.update({ where: { id: managerCustomer.id }, data: { role: "oauth_pending", rolesJson: "[]", status: "active" } });
    response = await apiRequest(app, "/api/manager/requests", { method: "POST", token: managerToken, body: managerRequestBody });
    assert.equal(response.status, 400);
    assert.equal(response.payload.code, "manager_customer_not_eligible");
    await prisma.user.update({ where: { id: managerCustomer.id }, data: { role: "client", rolesJson: '["client"]', status: "active" } });

    response = await apiRequest(app, "/api/manager/requests", {
      method: "POST",
      token: tokenFor(managerCustomer.id, "client"),
      body: managerRequestBody
    });
    assert.equal(response.status, 403);
    response = await apiRequest(app, "/api/manager/requests", {
      method: "POST",
      token: tokenFor(target.id, "performer"),
      body: managerRequestBody
    });
    assert.equal(response.status, 403);
    for (const [entityType, action] of [
      ["request", "manager.request.view"],
      ["chat", "manager.chat.view"],
      ["complaint", "manager.complaint.view"]
    ] as const) {
      const entity = entityType === "request"
        ? await prisma.clientRequest.findFirst()
        : entityType === "chat"
          ? await prisma.chat.findFirst()
          : await prisma.complaint.findFirst();
      if (!entity) continue;
      response = await apiRequest(app, `/api/manager/${entityType === "request" ? "requests" : entityType === "chat" ? "chats" : "complaints"}/${entity.id}`, {
        method: "GET",
        token: managerToken
      });
      assert.equal(response.status, 200);
      assert.ok(await prisma.auditLog.findFirst({ where: { actorUserId: manager.id, action, entityId: entity.id } }));
    }

    response = await apiRequest(app, `/api/manager/users/${target.id}/block`, {
      method: "POST",
      token: managerToken,
      body: { reason: "Проверка ограниченной блокировки" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.status, "blocked");
    assert.equal(response.payload.blockedByRole, "manager");

    response = await apiRequest(app, `/api/manager/users/${admin.id}/block`, {
      method: "POST",
      token: managerToken,
      body: { reason: "Запрещённая блокировка" }
    });
    assert.equal(response.status, 403);
    assert.equal(response.payload.code, "manager_permission_denied");

    response = await apiRequest(app, `/api/manager/users/${target.id}/unblock`, {
      method: "POST",
      token: managerToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.status, "active");

    const forbiddenRequests: Array<{ path: string; method: "GET" | "POST" | "DELETE"; body?: unknown }> = [
      { path: "/api/admin/settings", method: "GET" },
      { path: "/api/admin/legal/documents", method: "GET" },
      { path: "/api/admin/payments", method: "GET" },
      { path: "/api/admin/payments/missing/refund", method: "POST", body: { amount: 150, reason: "Недоступная операция возврата" } },
      { path: "/api/admin/archive/run", method: "POST", body: {} },
      { path: `/api/admin/users/${target.id}`, method: "DELETE" },
      { path: "/api/admin/acting/start", method: "POST", body: { role: "customer" } },
      { path: `/api/admin/users/${target.id}/manager/assign`, method: "POST", body: {} }
    ];
    for (const request of forbiddenRequests) {
      response = await apiRequest(app, request.path, {
        method: request.method,
        token: managerToken,
        body: request.body
      });
      assert.equal(response.status, 403, `Manager mutation was not denied for ${request.path}`);
      assert.equal(response.payload.code, "manager_permission_denied");
    }

    response = await apiRequest(app, "/api/auth/oauth/complete-profile", {
      method: "POST",
      token: managerToken,
      body: { role: "manager" }
    });
    assert.equal(response.status, 400);

    const managerBlockAudit = await prisma.auditLog.findFirst({
      where: { actorUserId: manager.id, action: "manager.user.block", createdAt: { gte: startedAt } }
    });
    assert.ok(managerBlockAudit);
    assert.match(managerBlockAudit!.payloadJson ?? "", /manager_panel/);

    response = await apiRequest(app, `/api/admin/users/${candidate.id}/manager/revoke`, {
      method: "POST",
      token: adminToken,
      body: { reason: "Завершение проверки" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.role, "client");
    assert.equal(response.payload.roleBeforeManager, null);

    const roleAuditRows = await prisma.auditLog.findMany({
      where: { actorUserId: admin.id, entityId: candidate.id, createdAt: { gte: startedAt } }
    });
    assert.ok(roleAuditRows.some((row) => row.action === "admin.manager.assign"));
    assert.ok(roleAuditRows.some((row) => row.action === "admin.manager.revoke"));
    assert.ok(await prisma.auditLog.findFirst({ where: { actorUserId: candidate.id, action: "manager.login", createdAt: { gte: startedAt } } }));
  } finally {
    if (createdIdentityId) await prisma.userIdentity.delete({ where: { id: createdIdentityId } }).catch(() => undefined);
    if (managerCreatedRequestId) {
      await prisma.auditLog.deleteMany({ where: { entityType: "request", entityId: managerCreatedRequestId } });
      await prisma.clientRequest.delete({ where: { id: managerCreatedRequestId } }).catch(() => undefined);
    }
    if (managerCustomerId) await prisma.user.delete({ where: { id: managerCustomerId } }).catch(() => undefined);
    await prisma.user.update({ where: { id: candidate.id }, data: originalCandidate });
    await prisma.user.update({ where: { id: target.id }, data: originalTarget });
    await prisma.auditLog.deleteMany({
      where: { createdAt: { gte: startedAt }, actorUserId: { in: [admin.id, candidate.id] } }
    });
  }
}

async function runAdminActingModeTests() {
  const app = createApp();
  const startedAt = new Date();
  const [admin, customer, city, category] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { role: { in: ["admin", "superadmin"] }, status: "active" } }),
    prisma.user.findFirstOrThrow({ where: { role: "client", status: "active" } }),
    prisma.city.findFirstOrThrow({ where: { isActive: true, directoryStatus: { notIn: ["hidden", "duplicate"] } } }),
    prisma.serviceCategory.findFirstOrThrow({ where: { isActive: true } })
  ]);
  const originalAdminCityId = admin.cityId;
  const adminToken = tokenFor(admin.id, admin.role);
  const customerToken = tokenFor(customer.id, customer.role);
  let requestId: string | null = null;

  try {
    let response = await apiRequest(app, "/api/admin/acting/start", {
      method: "POST",
      token: customerToken,
      body: { role: "customer" }
    });
    assert.equal(response.status, 403);

    const forgedToken = jwt.sign({
      sub: customer.id,
      role: "client",
      realRole: "client",
      actingRole: "performer",
      isActingAsRole: true
    }, env.jwtSecret);
    response = await apiRequest(app, "/api/auth/me", { method: "GET", token: forgedToken });
    assert.equal(response.status, 401);

    response = await apiRequest(app, "/api/admin/summary", { method: "GET", token: customerToken });
    assert.equal(response.status, 403);

    response = await apiRequest(app, "/api/admin/acting/start", {
      method: "POST",
      token: adminToken,
      body: { role: "customer" }
    });
    assert.equal(response.status, 200);
    const customerActingToken = response.payload.token as string;
    assert.equal(response.payload.effectiveRole, "client");
    assert.equal(response.payload.nextPath, "/app/client/requests");

    response = await apiRequest(app, "/api/auth/me", { method: "GET", token: customerActingToken });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.role, admin.role);
    assert.equal(response.payload.user.realRole, admin.role);
    assert.equal(response.payload.user.effectiveRole, "client");
    assert.equal(response.payload.user.isActingAsRole, true);
    assert.equal(response.payload.user.actingRole, "client");
    assert.equal(response.payload.user.displayActingBanner, true);

    response = await apiRequest(app, "/api/requests?scope=mine", { method: "GET", token: customerActingToken });
    assert.equal(response.status, 200);

    response = await apiRequest(app, "/api/requests", {
      method: "POST",
      token: customerActingToken,
      body: {
        cityId: city.id,
        categoryId: category.id,
        title: "Проверка режима Заказчика",
        description: "Бытовая помощь для проверки административного режима.",
        addressStreet: "ул. Мира",
        addressHouse: "10",
        scheduleType: "once",
        urgency: "normal"
      }
    });
    assert.equal(response.status, 201);
    requestId = response.payload.id;

    response = await apiRequest(app, `/api/requests/${requestId}/publish`, {
      method: "POST",
      token: customerActingToken
    });
    assert.equal(response.status, 200);

    await prisma.user.update({ where: { id: admin.id }, data: { cityId: city.id } });
    response = await apiRequest(app, "/api/admin/acting/start", {
      method: "POST",
      token: adminToken,
      body: { role: "helper" }
    });
    assert.equal(response.status, 200);
    const helperActingToken = response.payload.token as string;
    assert.equal(response.payload.effectiveRole, "performer");
    assert.equal(response.payload.nextPath, "/app/performer/requests");

    response = await apiRequest(app, "/api/auth/me", { method: "GET", token: helperActingToken });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.role, admin.role);
    assert.equal(response.payload.user.effectiveRole, "performer");
    assert.equal(response.payload.user.actingRole, "performer");

    response = await apiRequest(app, "/api/requests", { method: "GET", token: helperActingToken });
    assert.equal(response.status, 200);

    response = await apiRequest(app, `/api/requests/${requestId}/respond`, {
      method: "POST",
      token: helperActingToken,
      body: { message: "Отклик из административного режима" }
    });
    assert.equal(response.status, 201);

    response = await apiRequest(app, "/api/admin/summary", { method: "GET", token: helperActingToken });
    assert.equal(response.status, 200);

    response = await apiRequest(app, "/api/admin/acting/stop", { method: "POST", token: helperActingToken });
    assert.equal(response.status, 200);
    const restoredAdminToken = response.payload.token as string;
    assert.equal(response.payload.effectiveRole, admin.role);
    assert.equal(response.payload.isActingAsRole, false);
    assert.equal(response.payload.nextPath, "/app/admin");

    response = await apiRequest(app, "/api/auth/me", { method: "GET", token: restoredAdminToken });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.effectiveRole, admin.role);
    assert.equal(response.payload.user.isActingAsRole, false);
    assert.equal(response.payload.user.actingRole, null);

    const actingAuditRows = await prisma.auditLog.findMany({
      where: { actorUserId: admin.id, createdAt: { gte: startedAt }, action: { startsWith: "admin.acting" } }
    });
    assert.ok(actingAuditRows.some((row) => row.action === "admin.acting.start"));
    assert.ok(actingAuditRows.some((row) => row.action === "admin.acting.stop"));
    const actingAction = actingAuditRows.find((row) => row.action === "admin.acting.action" && row.payloadJson?.includes(`/api/requests/${requestId}/respond`));
    assert.ok(actingAction);
    const actingMetadata = JSON.parse(actingAction!.payloadJson!);
    assert.equal(actingMetadata.realUserId, admin.id);
    assert.equal(actingMetadata.effectiveUserId, admin.id);
    assert.equal(actingMetadata.realRole, admin.role);
    assert.equal(actingMetadata.effectiveRole, "performer");
    assert.equal(actingMetadata.actingRole, "performer");
    assert.equal(actingMetadata.actionSource, "admin_acting_mode");
  } finally {
    if (requestId) {
      await prisma.clientRequest.delete({ where: { id: requestId } }).catch(() => undefined);
    }
    await prisma.user.update({ where: { id: admin.id }, data: { cityId: originalAdminCityId } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: admin.id, createdAt: { gte: startedAt } } });
  }
}

async function runUserLifecycleTests() {
  const app = createApp();
  const unique = Date.now().toString().slice(-8);
  const [admin, performer, city, category] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { role: { in: ["admin", "superadmin"] }, status: "active" } }),
    prisma.user.findFirstOrThrow({ where: { role: "performer", status: "active" } }),
    prisma.city.findFirstOrThrow(),
    prisma.serviceCategory.findFirstOrThrow()
  ]);
  const adminToken = tokenFor(admin.id, admin.role);
  const createdUserIds: string[] = [];
  let requestId: string | null = null;

  try {
    const protectedUser = await prisma.user.create({
      data: {
        role: "client",
        rolesJson: '["client"]',
        phone: `+7960${unique}`,
        normalizedPhone: `+7960${unique}`,
        displayName: "Lifecycle protected",
        cityId: city.id,
        balance: 10,
        bonusBalance: 5,
        status: "active",
        clientProfile: { create: {} },
        consents: { create: { type: "privacy", version: "1" } }
      }
    });
    createdUserIds.push(protectedUser.id);
    await prisma.balanceTransaction.create({
      data: { userId: protectedUser.id, type: "top_up", amount: 10, balanceKind: "main", reason: "Lifecycle test", balanceBefore: 0, balanceAfter: 10 }
    });
    await prisma.paymentTransaction.create({
      data: { userId: protectedUser.id, provider: "mock", orderId: `LIFECYCLE-${unique}`, amount: 150, status: "pending" }
    });
    const request = await prisma.clientRequest.create({
      data: {
        clientId: protectedUser.id,
        cityId: city.id,
        categoryId: category.id,
        title: "Lifecycle request",
        description: "Lifecycle request",
        addressText: "Test",
        approximateAddressText: "Test",
        status: "in_progress",
        selectedPerformerId: performer.id
      }
    });
    requestId = request.id;
    const chat = await prisma.chat.create({
      data: { requestId: request.id, clientId: protectedUser.id, performerId: performer.id, status: "in_work" }
    });
    await prisma.complaint.create({
      data: {
        fromUserId: performer.id,
        againstUserId: protectedUser.id,
        requestId: request.id,
        chatId: chat.id,
        reason: "Lifecycle open complaint",
        status: "in_review"
      }
    });

    let response = await apiRequest(app, `/api/admin/users/${protectedUser.id}/block`, {
      method: "POST",
      token: adminToken,
      body: { reason: "Проверка безопасности данных" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.status, "blocked");
    assert.equal(response.payload.blockedByAdminId, admin.id);
    assert.equal(response.payload.blockReason, "Проверка безопасности данных");
    assert.ok(response.payload.blockedAt);
    assert.equal(await prisma.balanceTransaction.count({ where: { userId: protectedUser.id } }), 1);
    assert.equal(await prisma.paymentTransaction.count({ where: { userId: protectedUser.id } }), 1);
    assert.equal(await prisma.clientRequest.count({ where: { clientId: protectedUser.id } }), 1);
    assert.equal(await prisma.chat.count({ where: { clientId: protectedUser.id } }), 1);
    assert.equal(await prisma.consent.count({ where: { userId: protectedUser.id } }), 1);

    response = await apiRequest(app, `/api/admin/users/${protectedUser.id}`, { method: "DELETE", token: adminToken });
    assert.equal(response.status, 405);
    assert.equal(response.payload.code, "physical_user_deletion_forbidden");
    assert.ok(await prisma.user.findUnique({ where: { id: protectedUser.id } }));

    response = await apiRequest(app, `/api/admin/users/${protectedUser.id}/request-archive`, {
      method: "POST",
      token: adminToken,
      body: { reason: "Запрос безопасного архива" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.status, "pending_archive");
    assert.equal(response.payload.safety.canArchive, false);
    assert.ok(response.payload.safety.reasons.some((reason: string) => reason.includes("основном балансе")));
    assert.ok(response.payload.safety.reasons.some((reason: string) => reason.includes("бонусном балансе")));
    assert.ok(response.payload.safety.reasons.some((reason: string) => reason.includes("платеж")));
    assert.ok(response.payload.safety.reasons.some((reason: string) => reason.includes("заявк")));
    assert.ok(response.payload.safety.reasons.some((reason: string) => reason.includes("обращения или споры")));
    assert.ok(response.payload.safety.reasons.some((reason: string) => reason.includes("60 дней")));

    response = await apiRequest(app, `/api/admin/users/${protectedUser.id}/archive`, {
      method: "POST",
      token: adminToken,
      body: { reason: "Попытка архива" }
    });
    assert.equal(response.status, 409);
    assert.ok(await prisma.user.findUnique({ where: { id: protectedUser.id } }));

    const blockedToken = tokenFor(protectedUser.id, "client");
    response = await apiRequest(app, "/api/requests", { method: "POST", token: blockedToken, body: {} });
    assert.equal(response.status, 401);
    response = await apiRequest(app, `/api/chats/${chat.id}/client-confirm`, { method: "POST", token: blockedToken });
    assert.equal(response.status, 401);
    response = await apiRequest(app, `/api/admin/users/${protectedUser.id}/unblock`, { method: "POST", token: adminToken });
    assert.equal(response.status, 200);
    assert.equal(response.payload.status, "active");

    const oldDate = new Date(Date.now() - 61 * 86_400_000);
    const archivable = await prisma.user.create({
      data: {
        role: "client",
        rolesJson: '["client"]',
        phone: `+7961${unique}`,
        normalizedPhone: `+7961${unique}`,
        displayName: "Lifecycle archivable",
        cityId: city.id,
        status: "pending_archive",
        blockedAt: oldDate,
        blockedByAdminId: admin.id,
        archiveRequestedAt: oldDate,
        archiveRequestedByAdminId: admin.id,
        archiveReason: "Истёк срок ожидания",
        clientProfile: { create: {} },
        consents: { create: { type: "privacy", version: "1" } }
      }
    });
    createdUserIds.push(archivable.id);
    const safety = await getUserArchiveSafety(archivable.id);
    assert.equal(safety.canArchive, true);
    assert.ok((safety.daysSinceBlockedOrRequested ?? 0) >= 60);

    response = await apiRequest(app, `/api/admin/users/${archivable.id}/archive`, {
      method: "POST",
      token: adminToken,
      body: { reason: "Безопасное архивирование после срока" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.status, "archived");
    assert.ok(response.payload.user.archivedAt);
    assert.equal(await prisma.consent.count({ where: { userId: archivable.id } }), 1);
    assert.ok(await prisma.user.findUnique({ where: { id: archivable.id } }));

    const adminUsers = await apiRequest(app, "/api/admin/users", { method: "GET", token: adminToken });
    assert.equal(adminUsers.status, 200);
    assert.ok(adminUsers.payload.some((user: { id: string; status: string }) => user.id === archivable.id && user.status === "archived"));
    const auditActions = await prisma.auditLog.findMany({ where: { entityType: "user", entityId: { in: createdUserIds } } });
    for (const action of ["user.block", "user.unblock", "user.archive_requested", "user.archive_blocked", "user.archived"]) {
      assert.ok(auditActions.some((row) => row.action === action), `Missing lifecycle audit action ${action}`);
    }
  } finally {
    await prisma.auditLog.deleteMany({ where: { entityType: "user", entityId: { in: createdUserIds } } });
    if (requestId) {
      await prisma.complaint.deleteMany({ where: { requestId } });
      await prisma.chatMessage.deleteMany({ where: { chat: { requestId } } });
      await prisma.chat.deleteMany({ where: { requestId } });
      await prisma.requestResponse.deleteMany({ where: { requestId } });
      await prisma.balanceTransaction.deleteMany({ where: { relatedRequestId: requestId } });
      await prisma.clientRequest.deleteMany({ where: { id: requestId } });
    }
    await prisma.paymentTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.balanceTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
}

async function runOAuthPendingCancellationTests() {
  const app = createApp();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const [admin, client, city, category] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { role: { in: ["admin", "superadmin"] }, status: "active" } }),
    prisma.user.findFirstOrThrow({ where: { role: "client", status: "active" } }),
    prisma.city.findFirstOrThrow(),
    prisma.serviceCategory.findFirstOrThrow()
  ]);
  const adminToken = tokenFor(admin.id, admin.role);
  const clientToken = tokenFor(client.id, "client");
  const createdUserIds: string[] = [];
  const createdRequestIds: string[] = [];

  async function createPending(label: string) {
    const user = await prisma.user.create({
      data: {
        role: "oauth_pending",
        rolesJson: "[]",
        displayName: `Pending VK ${label}`,
        status: "active",
        identities: {
          create: {
            provider: "vk",
            providerUserId: `vk-pending-${label}-${unique}`,
            displayName: `Pending VK ${label}`
          }
        }
      }
    });
    createdUserIds.push(user.id);
    return user;
  }

  const manager = await prisma.user.create({
    data: {
      role: "manager",
      rolesJson: '["manager"]',
      displayName: "Pending cancellation manager",
      status: "active"
    }
  });
  createdUserIds.push(manager.id);
  const managerToken = tokenFor(manager.id, "manager");

  try {
    const cancellable = await createPending("safe");
    let response = await apiRequest(app, `/api/admin/users/${cancellable.id}/oauth-pending/cancel`, {
      method: "POST",
      token: clientToken
    });
    assert.equal(response.status, 403);
    response = await apiRequest(app, `/api/admin/users/${cancellable.id}/oauth-pending/cancel`, {
      method: "POST",
      token: managerToken
    });
    assert.equal(response.status, 403);
    assert.equal(response.payload.code, "manager_permission_denied");
    response = await apiRequest(app, `/api/admin/users/${cancellable.id}/oauth-pending/cancel`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.status, "archived");
    assert.equal(response.payload.user.role, "oauth_pending");
    assert.match(response.payload.user.archiveReason, /незавершённая VK-регистрация/i);
    assert.equal(await prisma.userIdentity.count({ where: { userId: cancellable.id, provider: "vk" } }), 1);
    assert.ok(await prisma.auditLog.findFirst({
      where: { actorUserId: admin.id, action: "admin.oauth_pending.cancel", entityId: cancellable.id }
    }));
    const activeUsers = await apiRequest(app, "/api/admin/users?status=active", { method: "GET", token: adminToken });
    assert.equal(activeUsers.status, 200);
    assert.equal(activeUsers.payload.some((user: { id: string }) => user.id === cancellable.id), false);

    response = await apiRequest(app, `/api/admin/users/${cancellable.id}/restore-oauth-pending`, {
      method: "POST",
      token: clientToken
    });
    assert.equal(response.status, 403);
    response = await apiRequest(app, `/api/admin/users/${cancellable.id}/restore-oauth-pending`, {
      method: "POST",
      token: managerToken
    });
    assert.equal(response.status, 403);
    assert.equal(response.payload.code, "manager_permission_denied");
    response = await apiRequest(app, `/api/admin/users/${cancellable.id}/oauth-pending-restore-safety`, {
      method: "GET",
      token: adminToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.canRestore, true);
    response = await apiRequest(app, `/api/admin/users/${cancellable.id}/restore-oauth-pending`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.status, "active");
    assert.equal(response.payload.user.role, "oauth_pending");
    assert.equal(response.payload.user.archivedAt, null);
    assert.equal(response.payload.user.archivedByAdminId, null);
    assert.equal(response.payload.user.archiveReason, null);
    assert.equal(await prisma.userIdentity.count({ where: { userId: cancellable.id, provider: "vk" } }), 1);
    const adminRestoreAudit = await prisma.auditLog.findFirst({
      where: { actorUserId: admin.id, action: "admin.oauth_pending.restore", entityId: cancellable.id }
    });
    assert.ok(adminRestoreAudit);
    assert.equal(JSON.parse(adminRestoreAudit.payloadJson ?? "{}").source, "admin_panel");

    response = await apiRequest(app, `/api/admin/users/${client.id}/oauth-pending/cancel`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 409);
    assert.ok(await prisma.user.findUnique({ where: { id: client.id } }));

    const paymentPending = await createPending("payment");
    await prisma.paymentTransaction.create({
      data: {
        userId: paymentPending.id,
        provider: "mock",
        orderId: `OAUTH-PENDING-PAYMENT-${unique}`,
        amount: 150,
        status: "pending"
      }
    });
    response = await apiRequest(app, `/api/admin/users/${paymentPending.id}/oauth-pending/cancel`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 409);
    assert.equal(response.payload.code, "oauth_pending_cancel_blocked");
    assert.equal(response.payload.details.counts.payments, 1);
    await prisma.user.update({
      where: { id: paymentPending.id },
      data: { status: "archived", archivedAt: new Date(), archiveReason: OAUTH_PENDING_CANCEL_ARCHIVE_REASON }
    });
    await assert.rejects(
      () => resolveVkUser({
        providerUserId: `vk-pending-payment-${unique}`,
        profile: { user_id: `vk-pending-payment-${unique}`, first_name: "Payment" }
      }),
      (error: unknown) => error instanceof Error && error.message.includes("Регистрация через VK ранее была остановлена")
    );
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: paymentPending.id } })).status, "archived");

    const ledgerPending = await createPending("ledger");
    await prisma.balanceTransaction.create({
      data: {
        userId: ledgerPending.id,
        type: "top_up",
        amount: 0,
        balanceKind: "real",
        reason: "Pending cancellation safety test"
      }
    });
    response = await apiRequest(app, `/api/admin/users/${ledgerPending.id}/oauth-pending/cancel`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 409);
    assert.equal(response.payload.details.counts.balanceTransactions, 1);
    await prisma.user.update({
      where: { id: ledgerPending.id },
      data: { status: "archived", archivedAt: new Date(), archiveReason: OAUTH_PENDING_CANCEL_ARCHIVE_REASON }
    });
    await assert.rejects(
      () => resolveVkUser({
        providerUserId: `vk-pending-ledger-${unique}`,
        profile: { user_id: `vk-pending-ledger-${unique}`, first_name: "Ledger" }
      }),
      /Регистрация через VK ранее была остановлена/
    );

    const activityPending = await createPending("activity");
    const request = await prisma.clientRequest.create({
      data: {
        clientId: client.id,
        selectedPerformerId: activityPending.id,
        cityId: city.id,
        categoryId: category.id,
        title: "OAuth pending safety request",
        description: "OAuth pending safety request",
        addressText: "Test",
        approximateAddressText: "Test",
        status: "discussion"
      }
    });
    createdRequestIds.push(request.id);
    const requestResponse = await prisma.requestResponse.create({
      data: { requestId: request.id, performerId: activityPending.id, status: "pending" }
    });
    await prisma.chat.create({
      data: {
        requestId: request.id,
        responseId: requestResponse.id,
        clientId: client.id,
        performerId: activityPending.id,
        status: "open"
      }
    });
    response = await apiRequest(app, `/api/admin/users/${activityPending.id}/oauth-pending/cancel`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 409);
    assert.equal(response.payload.details.counts.requests, 1);
    assert.equal(response.payload.details.counts.responses, 1);
    assert.equal(response.payload.details.counts.chats, 1);
    assert.match(response.payload.error, /история действий/i);
    await prisma.user.update({
      where: { id: activityPending.id },
      data: { status: "archived", archivedAt: new Date(), archiveReason: OAUTH_PENDING_CANCEL_ARCHIVE_REASON }
    });
    await assert.rejects(
      () => resolveVkUser({
        providerUserId: `vk-pending-activity-${unique}`,
        profile: { user_id: `vk-pending-activity-${unique}`, first_name: "Activity" }
      }),
      /Регистрация через VK ранее была остановлена/
    );

    const consentPending = await createPending("consent");
    await prisma.consent.create({
      data: { userId: consentPending.id, type: "privacy", version: "test" }
    });
    response = await apiRequest(app, `/api/admin/users/${consentPending.id}/oauth-pending/cancel`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 409);
    assert.equal(response.payload.details.counts.consents, 1);

    const completedArchived = await prisma.user.create({
      data: {
        role: "client",
        rolesJson: '["client"]',
        displayName: "Completed archived VK",
        status: "archived",
        archivedAt: new Date(),
        archiveReason: OAUTH_PENDING_CANCEL_ARCHIVE_REASON,
        identities: {
          create: {
            provider: "vk",
            providerUserId: `vk-completed-archived-${unique}`,
            displayName: "Completed archived VK"
          }
        }
      }
    });
    createdUserIds.push(completedArchived.id);
    response = await apiRequest(app, `/api/admin/users/${completedArchived.id}/restore-oauth-pending`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.code, "oauth_pending_restore_not_allowed");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: completedArchived.id } })).status, "archived");
  } finally {
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorUserId: { in: createdUserIds } }, { entityType: "user", entityId: { in: createdUserIds } }] }
    });
    for (const requestId of createdRequestIds) {
      await prisma.chatMessage.deleteMany({ where: { chat: { requestId } } });
      await prisma.chat.deleteMany({ where: { requestId } });
      await prisma.requestResponse.deleteMany({ where: { requestId } });
      await prisma.clientRequest.deleteMany({ where: { id: requestId } });
    }
    await prisma.paymentTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.balanceTransaction.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.consent.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
}

async function runUploadStorageTests() {
  assert.equal(resolveUploadsDir({ NODE_ENV: "production" }, "/app"), "/data/uploads");
  const root = mkdtempSync(path.join(tmpdir(), "zabota-uploads-"));
  try {
    const saved = await savePerformerDocumentFile({
      performerId: "performer-test",
      type: "self_employed",
      fileName: "../../private document.pdf",
      fileData: `data:application/pdf;base64,${Buffer.from("test-pdf").toString("base64")}`
    }, root);
    assert.match(saved.fileUrl, /^\/uploads\/performer-documents\/performer-test\//);
    assert.equal(saved.fileUrl.includes("/app/backend/uploads"), false);
    const storedDirectory = path.join(root, "performer-documents", "performer-test");
    assert.equal(existsSync(storedDirectory), true);
    assert.equal(readdirSync(storedDirectory).length, 1);
    assert.throws(() => resolveStoragePath(root, "..", "outside.pdf"), /Недопустимый путь файла/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function runLegalBootstrapTests() {
  await ensureLegalDocuments();
  const firstPass = await prisma.legalDocument.findMany({
    where: { type: { in: [...LEGAL_DOCUMENT_KEYS] }, isActive: true, isPublished: true }
  });
  assert.deepEqual(
    [...new Set(firstPass.map((document) => document.type))].sort(),
    [...LEGAL_DOCUMENT_KEYS].sort()
  );

  const exactVersionsBefore = await prisma.legalDocument.count({
    where: {
      OR: LEGAL_DOCUMENT_DEFINITIONS.map((document) => ({ type: document.type, version: document.version }))
    }
  });
  await ensureLegalDocuments();
  const exactVersionsAfter = await prisma.legalDocument.count({
    where: {
      OR: LEGAL_DOCUMENT_DEFINITIONS.map((document) => ({ type: document.type, version: document.version }))
    }
  });
  assert.equal(exactVersionsBefore, LEGAL_DOCUMENT_DEFINITIONS.length);
  assert.equal(exactVersionsAfter, exactVersionsBefore);

  const app = createApp();
  for (const definition of LEGAL_DOCUMENT_DEFINITIONS) {
    const response = await apiRequest(app, `/api/legal/documents/${definition.slug}`, { method: "GET" });
    assert.equal(response.status, 200, `Документ ${definition.type} должен открываться по ссылке`);
    assert.equal(response.payload.type, definition.type);
  }
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
  assert.match(landingIndex, /assets\/zabota-landing-logo\.png/);
  assert.match(landingIndex, /<a class="logo" href="\/">Забота Рядом<\/a>/);
  assert.doesNotMatch(landingIndex, /href="index\.html"/);
  assert.doesNotMatch(landingIndex, /медицинские услуги/i);
  assert.match(landingPrices, /Цены/);
  for (const expectedPriceText of [
    "Короткая помощь",
    "400–700 ₽",
    "Бытовая помощь 2 часа",
    "700–1 100 ₽",
    "Присмотр 2 часа",
    "700–1 200 ₽",
    "Сопровождение стандарт",
    "800–1 500 ₽",
    "Помощь 3–4 часа",
    "1 200–2 000 ₽",
    "Регулярная помощь",
    "обычно от 700 ₽"
  ]) {
    assert.match(landingPrices, new RegExp(expectedPriceText.replace(/[–]/g, "–")));
  }
  assert.match(landingPrices, /сервисный сбор Заказчика — 50 ₽/);
  assert.match(landingPrices, /доход Помощника после сервисного сбора — 900 ₽/);
  assert.doesNotMatch(landingPrices, /комиссия|исполнитель|клиент|550 ₽/i);
  assert.match(frontendIndex, /<div id="root"><\/div>/);
  assert.match(frontendIndex, /\/app\/assets\//);

  const landingHtmlFiles = readdirSync(path.join(projectRoot, "landing-public")).filter((fileName) =>
    fileName.endsWith(".html")
  );
  for (const fileName of landingHtmlFiles) {
    const html = readFileSync(path.join(projectRoot, "landing-public", fileName), "utf8");
    assert.doesNotMatch(html, /href=["'](?:https?:\/\/zabota-ugorsk\.ru)?\/?index\.html["']/i);
  }

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
  assert.match(startupScript, /bootstrapCityDirectory\.js/);
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

  assert.equal(CITY_DIRECTORY.find((city) => city.slug === "yugorsk")?.isActive, true);
  assert.equal(CITY_DIRECTORY.find((city) => city.slug === "sovetsky")?.isActive, true);
  assert.equal(CITY_DIRECTORY.find((city) => city.slug === "moscow")?.isActive, true);
  assert.ok(CITY_DIRECTORY.every((city) => city.serviceStatus === "inactive"));
  for (const cityName of ["Югорск", "Советский", "Урай", "Ханты-Мансийск", "Сургут", "Тюмень", "Екатеринбург", "Челябинск", "Москва", "Санкт-Петербург"]) {
    assert.ok(CITY_DIRECTORY.some((city) => city.name === cityName));
  }
}

async function runSettlementDirectoryTests() {
  const suffix = Date.now().toString(36);
  const searchable = await prisma.city.upsert({
    where: { slug: `search-yugorsk-${suffix}` },
    update: {},
    create: {
      name: `Югорск Тест ${suffix}`,
      normalizedName: normalizeSettlementName(`Югорск Тест ${suffix}`),
      slug: `search-yugorsk-${suffix}`,
      region: "ХМАО — Югра",
      source: "seed",
      directoryStatus: "verified",
      serviceStatus: "inactive",
      status: "inactive",
      isActive: true,
      mapCenterLat: 61.31,
      mapCenterLng: 63.33
    }
  });
  const app = createApp();
  const search = await apiRequest(app, `/api/settlements/search?q=${encodeURIComponent(searchable.name)}`, { method: "GET" });
  assert.equal(search.status, 200);
  assert.ok(search.payload.some((item: any) => item.id === searchable.id && item.region === "ХМАО — Югра"));

  const user = await prisma.user.create({
    data: { role: "client", rolesJson: '["client"]', displayName: "Тест городов", status: "active" }
  });
  const token = jwt.sign({ sub: user.id, role: "client" }, env.jwtSecret);
  const suggestedName = `Посёлок Проверочный ${suffix}`;
  const suggested = await apiRequest(app, "/api/settlements/suggest", {
    method: "POST",
    token,
    body: { name: suggestedName, region: "Тестовый регион", type: "settlement" }
  });
  assert.equal(suggested.status, 201);
  assert.equal(suggested.payload.settlement.directoryStatus, "needs_review");
  assert.equal(suggested.payload.settlement.serviceStatus, "inactive");
  const suggestedId = suggested.payload.settlement.id as string;

  const primary = await apiRequest(app, "/api/me/cities", {
    method: "POST",
    token,
    body: { cityId: suggestedId, roleScope: "customer" }
  });
  assert.equal(primary.status, 201);
  assert.equal(primary.payload.isPrimary, true);
  assert.equal((await prisma.city.findUnique({ where: { id: suggestedId } }))?.serviceStatus, "active");
  assert.equal((await prisma.user.findUnique({ where: { id: user.id } }))?.cityId, suggestedId);

  const duplicate = await apiRequest(app, "/api/me/cities", {
    method: "POST",
    token,
    body: { cityId: suggestedId, roleScope: "customer" }
  });
  assert.equal(duplicate.status, 409);

  const additional = await apiRequest(app, "/api/me/cities", {
    method: "POST",
    token,
    body: { cityId: searchable.id, roleScope: "both" }
  });
  assert.equal(additional.status, 201);
  assert.equal(additional.payload.isPrimary, false);
  const makePrimary = await apiRequest(app, `/api/me/cities/${additional.payload.id}`, {
    method: "PATCH",
    token,
    body: { isPrimary: true }
  });
  assert.equal(makePrimary.status, 200);
  assert.equal(makePrimary.payload.isPrimary, true);
  const oldPrimary = await prisma.userCity.findUnique({ where: { userId_cityId: { userId: user.id, cityId: suggestedId } } });
  assert.equal(oldPrimary?.isPrimary, false);
  const removed = await apiRequest(app, `/api/me/cities/${oldPrimary!.id}`, { method: "DELETE", token });
  assert.equal(removed.status, 204);
  const cannotDeletePrimary = await apiRequest(app, `/api/me/cities/${additional.payload.id}`, { method: "DELETE", token });
  assert.equal(cannotDeletePrimary.status, 400);

  const vkCity = CITY_DIRECTORY.find((city) => city.slug === "moscow")!;
  assert.equal(vkCity.serviceStatus, "inactive");

  const registrationSettlementName = `Село Регистрация ${suffix}`;
  const registration = await apiRequest(app, "/api/auth/register", {
    method: "POST",
    body: {
      role: "client",
      phone: `+7910${String(Date.now()).slice(-7)}`,
      password: "password123",
      displayName: "Регистрация села",
      citySuggestion: { name: registrationSettlementName, region: "Новый регион" },
      acceptedLegalDocumentTypes: requiredDocumentTypesForRegistration("client"),
      dependentDataTransferConfirmed: true
    }
  });
  assert.equal(registration.status, 201);
  const registeredCity = await prisma.city.findFirst({ where: { normalizedName: normalizeSettlementName(registrationSettlementName) } });
  assert.equal(registeredCity?.directoryStatus, "needs_review");
  assert.equal(registeredCity?.serviceStatus, "active");
  assert.equal(await prisma.userCity.count({ where: { userId: registration.payload.user.id, cityId: registeredCity?.id, isPrimary: true } }), 1);

  const requestCity = await prisma.city.create({
    data: {
      name: `Деревня Заявка ${suffix}`,
      normalizedName: normalizeSettlementName(`Деревня Заявка ${suffix}`),
      slug: `request-village-${suffix}`,
      type: "village",
      region: "Тестовый регион",
      source: "seed",
      directoryStatus: "verified",
      serviceStatus: "inactive",
      status: "inactive",
      isActive: true,
      mapCenterLat: 0,
      mapCenterLng: 0
    }
  });
  const category = await prisma.serviceCategory.findFirst({ where: { isActive: true } });
  assert.ok(category);
  const createdRequest = await apiRequest(app, "/api/requests", {
    method: "POST",
    token: registration.payload.token,
    body: {
      cityId: requestCity.id,
      categoryId: category!.id,
      title: "Помощь в другом населённом пункте",
      description: "Нужна безопасная бытовая помощь для Подопечного.",
      addressStreet: "ул. Центральная",
      addressHouse: "1",
      addressText: "",
      approximateAddressText: "район центра",
      additionalActions: [],
      dependentState: [],
      urgencyFlags: []
    }
  });
  assert.equal(createdRequest.status, 201);
  assert.equal(createdRequest.payload.cityId, requestCity.id);
  assert.equal((await prisma.city.findUnique({ where: { id: requestCity.id } }))?.serviceStatus, "active");

  const helper = await prisma.user.create({
    data: { role: "performer", rolesJson: '["performer"]', displayName: "Помощник по городам", cityId: searchable.id, status: "active" }
  });
  await prisma.userCity.create({
    data: { userId: helper.id, cityId: searchable.id, roleScope: "helper", isPrimary: true, isActive: true }
  });
  const visibleRequest = await prisma.clientRequest.create({
    data: {
      clientId: user.id,
      cityId: searchable.id,
      categoryId: category!.id,
      title: "Заявка в городе Помощника",
      description: "Безопасная бытовая помощь в выбранном городе.",
      addressText: "Тестовый адрес",
      approximateAddressText: "Тестовый район",
      status: "waiting_for_responses",
      visibilityStatus: "city_visible"
    }
  });
  const hiddenRequest = await prisma.clientRequest.create({
    data: {
      clientId: user.id,
      cityId: requestCity.id,
      categoryId: category!.id,
      title: "Заявка вне городов Помощника",
      description: "Эта заявка не должна попадать в выдачу Помощника.",
      addressText: "Другой адрес",
      approximateAddressText: "Другой район",
      status: "waiting_for_responses",
      visibilityStatus: "city_visible"
    }
  });
  const helperToken = jwt.sign({ sub: helper.id, role: "performer" }, env.jwtSecret);
  const helperRequests = await apiRequest(app, "/api/requests", { method: "GET", token: helperToken });
  assert.equal(helperRequests.status, 200);
  assert.ok(helperRequests.payload.some((request: any) => request.id === visibleRequest.id));
  assert.equal(helperRequests.payload.some((request: any) => request.id === hiddenRequest.id), false);
}

async function runTrialBalanceTests() {
  const app = createApp();
  const admin = await prisma.user.findUnique({ where: { email: "admin@zabota.local" } });
  const client = await prisma.user.findUnique({ where: { email: "client@zabota.local" } });
  assert.ok(admin && client?.cityId, "Нужны demo-admin и город заказчика для trial balance tests");

  const startedAt = new Date();
  const originalSetting = await prisma.serviceSetting.findUnique({ where: { key: TRIAL_BALANCE_SETTING_KEY } });
  const originalUsers = await prisma.user.findMany({ select: { id: true, balance: true, bonusBalance: true } });
  const createdUserIds: string[] = [];
  const unique = String(Date.now()).slice(-7);
  const adminToken = tokenFor(admin.id, admin.role);
  const clientToken = tokenFor(client.id, "client");

  try {
    await updateTrialBalanceSettings({ enabled: true, amount: 100, autoGrantNewUsers: true });
    let response = await apiRequest(app, "/api/auth/register", {
      method: "POST",
      body: {
        role: "client",
        phone: `+7901${unique}`,
        email: `trial-registration-${unique}@zabota.local`,
        password: "password123",
        displayName: "Пробный Заказчик",
        cityId: client.cityId,
        acceptedConsentTypes: ["terms", "privacy", "personal_data_processing", "chat_rules", "payment_rules"],
        acceptedLegalDocumentTypes: requiredDocumentTypesForRegistration("client"),
        dependentDataTransferConfirmed: true
      }
    });
    assert.equal(response.status, 201);
    const registrationUserId = response.payload.user.id;
    const registrationToken = response.payload.token;
    createdUserIds.push(registrationUserId);
    assert.equal(response.payload.user.bonusBalance, 100);
    let trialRows = await prisma.balanceTransaction.findMany({ where: { userId: registrationUserId, type: "trial_bonus" } });
    assert.equal(trialRows.length, 1);
    assert.equal(trialRows[0].amount, 100);
    assert.equal(trialRows[0].source, "registration");
    assert.equal(trialRows[0].reason, TRIAL_BALANCE_DESCRIPTION);
    assert.equal(await prisma.npdTaxRegisterEntry.count({ where: { userId: registrationUserId } }), 0,
      "Пробный баланс не должен создавать записи НПД");
    response = await apiRequest(app, "/api/balance/me", { method: "GET", token: registrationToken });
    assert.equal(response.status, 200);
    assert.ok(response.payload.transactions.some((transaction: any) =>
      transaction.type === "trial_bonus" && transaction.reason === TRIAL_BALANCE_DESCRIPTION
    ));
    response = await apiRequest(app, "/api/admin/balance-transactions", { method: "GET", token: adminToken });
    assert.equal(response.status, 200);
    assert.ok(response.payload.some((transaction: any) =>
      transaction.userId === registrationUserId && transaction.type === "trial_bonus"
    ));

    const repeatedGrant = await grantTrialBalanceToUser(registrationUserId, "registration");
    assert.deepEqual(repeatedGrant, { granted: false, reason: "already_granted" });
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: registrationUserId } })).bonusBalance, 100);

    await updateTrialBalanceSettings({ enabled: false, amount: 100, autoGrantNewUsers: false });
    response = await apiRequest(app, "/api/auth/register", {
      method: "POST",
      body: {
        role: "client",
        phone: `+7902${unique}`,
        email: `trial-disabled-${unique}@zabota.local`,
        password: "password123",
        displayName: "Без пробного баланса",
        cityId: client.cityId,
        acceptedConsentTypes: ["terms", "privacy", "personal_data_processing", "chat_rules", "payment_rules"],
        acceptedLegalDocumentTypes: requiredDocumentTypesForRegistration("client"),
        dependentDataTransferConfirmed: true
      }
    });
    assert.equal(response.status, 201);
    const disabledUserId = response.payload.user.id;
    createdUserIds.push(disabledUserId);
    assert.equal(response.payload.user.bonusBalance, 0);
    assert.equal(await prisma.balanceTransaction.count({ where: { userId: disabledUserId, type: "trial_bonus" } }), 0);

    const oauthPending = await prisma.user.create({
      data: {
        role: "oauth_pending",
        rolesJson: "[]",
        displayName: "VK trial pending",
        status: "active",
        identities: {
          create: { provider: "vk", providerUserId: `trial-vk-${unique}`, displayName: "VK trial pending" }
        }
      }
    });
    createdUserIds.push(oauthPending.id);
    await updateTrialBalanceSettings({ enabled: true, amount: 100, autoGrantNewUsers: true });
    assert.deepEqual(await grantTrialBalanceToUser(oauthPending.id, "oauth_complete"), { granted: false, reason: "admin_skipped" });
    assert.equal(await prisma.balanceTransaction.count({ where: { userId: oauthPending.id, type: "trial_bonus" } }), 0);

    const oauthBody = {
      role: "performer",
      cityId: client.cityId,
      phone: `+7903${unique}`,
      acceptedLegalDocumentTypes: requiredDocumentTypesForRegistration("performer"),
      helperNotEmployerAcknowledged: true,
      helperNoMedicalServicesConfirmed: true
    };
    const oauthToken = tokenFor(oauthPending.id, "oauth_pending");
    response = await apiRequest(app, "/api/auth/oauth/complete-profile", { method: "POST", token: oauthToken, body: oauthBody });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.bonusBalance, 100);
    response = await apiRequest(app, "/api/auth/oauth/complete-profile", { method: "POST", token: oauthToken, body: oauthBody });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.bonusBalance, 100);
    trialRows = await prisma.balanceTransaction.findMany({ where: { userId: oauthPending.id, type: "trial_bonus" } });
    assert.equal(trialRows.length, 1);
    assert.equal(trialRows[0].source, "oauth_complete");

    const bulkEligible = await prisma.user.create({
      data: {
        role: "client",
        rolesJson: JSON.stringify(["client"]),
        phone: `+7904${unique}`,
        normalizedPhone: `+7904${unique}`,
        displayName: "Массовое начисление",
        cityId: client.cityId,
        status: "active"
      }
    });
    const bulkBlocked = await prisma.user.create({
      data: {
        role: "performer",
        rolesJson: JSON.stringify(["performer"]),
        phone: `+7905${unique}`,
        normalizedPhone: `+7905${unique}`,
        displayName: "Заблокированный без бонуса",
        cityId: client.cityId,
        status: "blocked",
        blockedAt: new Date()
      }
    });
    createdUserIds.push(bulkEligible.id, bulkBlocked.id);

    response = await apiRequest(app, "/api/admin/trial-balance/settings", { method: "GET" });
    assert.equal(response.status, 401);
    response = await apiRequest(app, "/api/admin/trial-balance/settings", { method: "GET", token: clientToken });
    assert.equal(response.status, 403);
    response = await apiRequest(app, "/api/admin/trial-balance/settings", {
      method: "PUT",
      token: adminToken,
      body: { enabled: true, amount: 100, autoGrantNewUsers: false }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.enabled, true);
    assert.equal(response.payload.amount, 100);
    assert.equal(response.payload.autoGrantNewUsers, false);
    assert.deepEqual(await getTrialBalanceSettings(), {
      enabled: true,
      amount: 100,
      autoGrantNewUsers: false,
      lastBulkGrantAt: null
    });

    response = await apiRequest(app, "/api/admin/trial-balance/grant-all", { method: "POST", token: adminToken });
    assert.equal(response.status, 200);
    assert.ok(response.payload.granted >= 1);
    assert.ok(response.payload.skippedBlocked >= 1);
    assert.ok(response.payload.skippedAdmin >= 1);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: bulkEligible.id } })).bonusBalance, 100);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: bulkBlocked.id } })).bonusBalance, 0);
    assert.equal(await prisma.balanceTransaction.count({ where: { userId: admin.id, type: "trial_bonus" } }), 0);

    const secondBulk = await apiRequest(app, "/api/admin/trial-balance/grant-all", { method: "POST", token: adminToken });
    assert.equal(secondBulk.status, 200);
    assert.equal(secondBulk.payload.granted, 0);
    assert.ok(secondBulk.payload.skippedAlreadyGranted >= 1);
    assert.equal(await prisma.balanceTransaction.count({ where: { userId: bulkEligible.id, type: "trial_bonus" } }), 1);
    assert.ok((await getTrialBalanceSettings()).lastBulkGrantAt);
  } finally {
    await prisma.auditLog.deleteMany({
      where: {
        createdAt: { gte: startedAt },
        OR: [
          { action: { startsWith: "trial_balance." } },
          { action: "balance.trial_bonus" },
          { actorUserId: { in: createdUserIds } },
          { entityType: "user", entityId: { in: createdUserIds } }
        ]
      }
    });
    await prisma.balanceTransaction.deleteMany({ where: { type: "trial_bonus", createdAt: { gte: startedAt } } });
    for (const user of originalUsers) {
      await prisma.user.updateMany({ where: { id: user.id }, data: { balance: user.balance, bonusBalance: user.bonusBalance } });
    }
    if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    if (originalSetting) {
      await prisma.serviceSetting.upsert({
        where: { key: originalSetting.key },
        create: originalSetting,
        update: {
          valueJson: originalSetting.valueJson,
          label: originalSetting.label,
          group: originalSetting.group,
          updatedAt: originalSetting.updatedAt
        }
      });
    } else {
      await prisma.serviceSetting.deleteMany({ where: { key: TRIAL_BALANCE_SETTING_KEY } });
    }
  }
}

async function runBonusServiceFeeTests() {
  const app = createApp();
  const client = await prisma.user.findUnique({ where: { email: "client@zabota.local" } });
  const performer = await prisma.user.findUnique({ where: { email: "performer@zabota.local" } });
  const admin = await prisma.user.findUnique({ where: { email: "admin@zabota.local" } });
  const category = await prisma.serviceCategory.findFirst({ where: { isActive: true, isChildcare: false } });
  assert.ok(client?.cityId && performer && admin && category, "Нужны demo users и категория для bonus fee tests");

  await acceptLatestLegalDocuments({
    userId: client.id,
    documentTypes: requiredDocumentTypesForRegistration("client"),
    source: "bonus_fee_test"
  });
  await acceptLatestLegalDocuments({
    userId: performer.id,
    documentTypes: requiredDocumentTypesForRegistration("performer"),
    source: "bonus_fee_test"
  });

  const originalClientBalance = { balance: client.balance, bonusBalance: client.bonusBalance };
  const originalPerformerBalance = { balance: performer.balance, bonusBalance: performer.bonusBalance };
  const settingKeys = ["useBonusForCommission", "chargeBonusFirst"];
  const feeSettingKeys = ["clientServiceFeeAmount", "performerServiceFeeAmount", "performerCommissionAmount", "serviceCommissionAmount"];
  const trackedSettingKeys = [...settingKeys, ...feeSettingKeys];
  const originalSettings = await prisma.serviceSetting.findMany({ where: { key: { in: trackedSettingKeys } } });
  const requestIds: string[] = [];

  try {
    await prisma.serviceSetting.updateMany({
      where: { key: { in: feeSettingKeys } },
      data: { valueJson: "70" }
    });
    const fixedFeeSettings = await getServiceFeeSettings();
    assert.equal(fixedFeeSettings.clientServiceFeeAmount, FIXED_SERVICE_FEE_AMOUNT);
    assert.equal(fixedFeeSettings.performerCommissionAmount, FIXED_SERVICE_FEE_AMOUNT);
    const lockedSettingResponse = await apiRequest(app, "/api/admin/settings/clientServiceFeeAmount", {
      method: "PATCH",
      token: tokenFor(admin.id, admin.role),
      body: { valueJson: "70" }
    });
    assert.equal(lockedSettingResponse.status, 403);
    assert.equal(lockedSettingResponse.payload.code, "service_fee_setting_locked");
    await ensureFixedServiceFeeSettings();
    const normalizedFeeSettings = await prisma.serviceSetting.findMany({ where: { key: { in: feeSettingKeys } } });
    assert.equal(normalizedFeeSettings.length, feeSettingKeys.length);
    assert.ok(normalizedFeeSettings.every((setting) => setting.valueJson === "50"));

    await Promise.all(settingKeys.map((key) => prisma.serviceSetting.upsert({
      where: { key },
      create: { key, valueJson: "false", label: key, group: "payments" },
      update: { valueJson: "false" }
    })));
    await Promise.all([
      prisma.user.update({ where: { id: client.id }, data: { balance: 0, bonusBalance: 0 } }),
      prisma.user.update({ where: { id: performer.id }, data: { balance: 0, bonusBalance: 0 } })
    ]);

    const clientToken = tokenFor(client.id, "client");
    const performerToken = tokenFor(performer.id, "performer");
    let response = await apiRequest(app, "/api/requests", {
      method: "POST",
      token: clientToken,
      body: {
        cityId: client.cityId,
        categoryId: category.id,
        title: "Заявка без пополнения",
        description: "Бытовая помощь для проверки баланса",
        addressStreet: "ул. Мира",
        addressHouse: "10",
        additionalActions: [],
        dependentState: []
      }
    });
    assert.equal(response.status, 201, "Создание заявки не должно требовать 150 ₽");
    const zeroBalanceRequestId = response.payload.id;
    requestIds.push(zeroBalanceRequestId);
    response = await apiRequest(app, `/api/requests/${zeroBalanceRequestId}/publish`, { method: "POST", token: clientToken });
    assert.equal(response.status, 200);
    response = await apiRequest(app, `/api/requests/${zeroBalanceRequestId}/respond`, {
      method: "POST",
      token: performerToken,
      body: { message: "Готов обсудить условия" }
    });
    assert.equal(response.status, 201, "Отклик с нулевым балансом не должен требовать 150 ₽");
    const responseId = response.payload.response.id;
    response = await apiRequest(app, `/api/requests/responses/${responseId}/accept`, { method: "POST", token: clientToken });
    assert.equal(response.status, 200, "Открытие чата не должно требовать 150 ₽");
    const chatId = response.payload.chat.id;

    response = await apiRequest(app, `/api/chats/${chatId}/terms`, {
      method: "PATCH",
      token: clientToken,
      body: { agreedHelperAmount: 700, agreedDurationMinutes: 120, agreedTermsComment: "Бытовая помощь по заявке" }
    });
    assert.equal(response.status, 200);

    response = await apiRequest(app, `/api/chats/${chatId}/client-confirm`, { method: "POST", token: clientToken });
    assert.equal(response.status, 200);
    response = await apiRequest(app, `/api/chats/${chatId}/performer-confirm`, { method: "POST", token: performerToken });
    assert.equal(response.status, 200);
    assert.equal(response.payload.status, "waiting_client_balance");
    assert.equal((await prisma.clientRequest.findUniqueOrThrow({ where: { id: zeroBalanceRequestId } })).status, "waiting_client_balance");
    assert.equal(await countServiceFeeTransactions(zeroBalanceRequestId), 0);

    await Promise.all([
      prisma.user.update({ where: { id: client.id }, data: { balance: 0, bonusBalance: 100 } }),
      prisma.user.update({ where: { id: performer.id }, data: { balance: 0, bonusBalance: 100 } })
    ]);
    response = await apiRequest(app, `/api/chats/${chatId}/client-confirm`, { method: "POST", token: clientToken });
    assert.equal(response.status, 200);
    response = await apiRequest(app, `/api/chats/${chatId}/performer-confirm`, { method: "POST", token: performerToken });
    assert.equal(response.status, 200);
    assert.equal(response.payload.status, "in_work");
    const afterBonusCharge = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: client.id }, select: { balance: true, bonusBalance: true } }),
      prisma.user.findUniqueOrThrow({ where: { id: performer.id }, select: { balance: true, bonusBalance: true } })
    ]);
    assert.deepEqual(afterBonusCharge[0], { balance: 0, bonusBalance: 50 });
    assert.deepEqual(afterBonusCharge[1], { balance: 0, bonusBalance: 50 });
    const bonusFeeRows = await prisma.balanceTransaction.findMany({
      where: { relatedRequestId: zeroBalanceRequestId },
      orderBy: { createdAt: "asc" }
    });
    assert.equal(bonusFeeRows.length, 2);
    assert.ok(bonusFeeRows.every((row) => row.balanceKind === "bonus" && row.amount === -50));
    assert.ok(bonusFeeRows.every((row) => row.balanceBefore === 100 && row.balanceAfter === 50));
    assert.ok(bonusFeeRows.every((row) => row.reason.includes("Сервисный сбор")));
    await Promise.all([
      apiRequest(app, `/api/chats/${chatId}/client-confirm`, { method: "POST", token: clientToken }),
      apiRequest(app, `/api/chats/${chatId}/performer-confirm`, { method: "POST", token: performerToken })
    ]);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).bonusBalance, 50);
    assert.equal(await countServiceFeeTransactions(zeroBalanceRequestId), 2);

    await Promise.all([
      prisma.user.update({ where: { id: client.id }, data: { balance: 20, bonusBalance: 30 } }),
      prisma.user.update({ where: { id: performer.id }, data: { balance: 0, bonusBalance: 50 } })
    ]);
    const combinedRequest = await prisma.clientRequest.create({
      data: {
        seedKey: `combined-bonus-fee-${Date.now()}`,
        clientId: client.id,
        cityId: client.cityId,
        categoryId: category.id,
        title: "Комбинированное списание",
        description: "Проверка бонусного и основного баланса",
        addressText: "Югорск, ул. Мира, 10",
        approximateAddressText: "Югорск, ул. Мира",
        status: "discussion",
        visibilityStatus: "city_visible"
      }
    });
    requestIds.push(combinedRequest.id);
    const combinedResponse = await prisma.requestResponse.create({
      data: { requestId: combinedRequest.id, performerId: performer.id, status: "discussion" }
    });
    const combinedChat = await prisma.chat.create({
      data: {
        requestId: combinedRequest.id,
        responseId: combinedResponse.id,
        clientId: client.id,
        performerId: performer.id,
        status: "open"
      }
    });
    await apiRequest(app, `/api/chats/${combinedChat.id}/terms`, {
      method: "PATCH",
      token: clientToken,
      body: { agreedHelperAmount: 700 }
    });
    await apiRequest(app, `/api/chats/${combinedChat.id}/client-confirm`, { method: "POST", token: clientToken });
    response = await apiRequest(app, `/api/chats/${combinedChat.id}/performer-confirm`, { method: "POST", token: performerToken });
    assert.equal(response.payload.status, "in_work");
    assert.deepEqual(
      await prisma.user.findUniqueOrThrow({ where: { id: client.id }, select: { balance: true, bonusBalance: true } }),
      { balance: 0, bonusBalance: 0 }
    );
    const combinedRows = await prisma.balanceTransaction.findMany({
      where: { relatedRequestId: combinedRequest.id, userId: client.id },
      orderBy: { balanceKind: "asc" }
    });
    assert.equal(combinedRows.length, 2);
    const combinedBonus = combinedRows.find((row) => row.balanceKind === "bonus");
    const combinedReal = combinedRows.find((row) => row.balanceKind === "real");
    assert.deepEqual(
      { amount: combinedBonus?.amount, before: combinedBonus?.balanceBefore, after: combinedBonus?.balanceAfter },
      { amount: -30, before: 30, after: 0 }
    );
    assert.deepEqual(
      { amount: combinedReal?.amount, before: combinedReal?.balanceBefore, after: combinedReal?.balanceAfter },
      { amount: -20, before: 20, after: 0 }
    );
  } finally {
    if (requestIds.length) {
      await prisma.balanceTransaction.deleteMany({ where: { relatedRequestId: { in: requestIds } } });
      await prisma.chatMessage.deleteMany({ where: { chat: { requestId: { in: requestIds } } } });
      await prisma.chat.deleteMany({ where: { requestId: { in: requestIds } } });
      await prisma.requestResponse.deleteMany({ where: { requestId: { in: requestIds } } });
      await prisma.clientRequest.deleteMany({ where: { id: { in: requestIds } } });
    }
    await Promise.all([
      prisma.user.update({ where: { id: client.id }, data: originalClientBalance }),
      prisma.user.update({ where: { id: performer.id }, data: originalPerformerBalance })
    ]);
    for (const setting of originalSettings) {
      await prisma.serviceSetting.update({ where: { key: setting.key }, data: { valueJson: setting.valueJson } });
    }
    const originalSettingKeys = new Set(originalSettings.map((setting) => setting.key));
    await prisma.serviceSetting.deleteMany({
      where: { key: { in: trackedSettingKeys.filter((key) => !originalSettingKeys.has(key)) } }
    });
  }
}

async function runCriticalSafetyTests() {
  const app = createApp();
  const client = await prisma.user.findUnique({ where: { email: "client@zabota.local" } });
  const performer = await prisma.user.findUnique({ where: { email: "performer@zabota.local" } });
  const admin = await prisma.user.findUnique({ where: { email: "admin@zabota.local" } });
  const category = await prisma.serviceCategory.findFirst({ where: { isActive: true } });
  assert.ok(client && performer && admin && category, "Нужны demo users и категория для safety tests");

  await acceptLatestLegalDocuments({
    userId: client.id,
    documentTypes: requiredDocumentTypesForRegistration("client"),
    source: "critical_safety_test"
  });
  await acceptLatestLegalDocuments({
    userId: performer.id,
    documentTypes: requiredDocumentTypesForRegistration("performer"),
    source: "critical_safety_test"
  });

  const originalClientBalance = { balance: client.balance, bonusBalance: client.bonusBalance };
  const originalPerformerBalance = { balance: performer.balance, bonusBalance: performer.bonusBalance };
  const originalEnv = { nodeEnv: env.nodeEnv, allowLegacyMockTopUp: env.allowLegacyMockTopUp };
  const testStartedAt = new Date();
  let requestId = "";

  try {
    await Promise.all([
      prisma.user.update({ where: { id: client.id }, data: { balance: 500, bonusBalance: 0 } }),
      prisma.user.update({ where: { id: performer.id }, data: { balance: 500, bonusBalance: 0 } })
    ]);
    const request = await prisma.clientRequest.create({
      data: {
        seedKey: `critical-safety-${Date.now()}`,
        clientId: client.id,
        cityId: client.cityId!,
        categoryId: category.id,
        contactName: "Приватный Заказчик",
        contactPhone: "+79990000001",
        title: "Проверка безопасной финализации",
        description: "Тестовая бытовая задача",
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
        priceEstimateAmount: 700,
        status: "discussion",
        visibilityStatus: "city_visible"
      }
    });
    requestId = request.id;
    const responseRow = await prisma.requestResponse.create({
      data: { requestId: request.id, performerId: performer.id, status: "discussion" }
    });
    const chat = await prisma.chat.create({
      data: {
        requestId: request.id,
        responseId: responseRow.id,
        clientId: client.id,
        performerId: performer.id,
        status: "open"
      }
    });

    const clientToken = tokenFor(client.id, "client");
    const performerToken = tokenFor(performer.id, "performer");
    const adminToken = tokenFor(admin.id, admin.role);

    let response = await apiRequest(app, `/api/chats/${chat.id}/messages`, { method: "GET", token: performerToken });
    assert.equal(response.status, 200);
    assert.equal(response.payload.phoneVisible, false);
    assert.equal(response.payload.request.contactName, null);
    assert.equal(response.payload.request.contactPhone, null);
    assert.equal(response.payload.request.addressHouse, null);
    assert.equal(response.payload.request.addressApartment, null);

    response = await apiRequest(app, `/api/chats/${chat.id}/client-confirm`, { method: "POST", token: clientToken });
    assert.equal(response.status, 400);
    assert.equal(response.payload.code, "agreement_terms_required");

    response = await apiRequest(app, `/api/chats/${chat.id}/terms`, {
      method: "PATCH",
      token: clientToken,
      body: {
        agreedHelperAmount: 950,
        agreedPackageId: "home_help_2h",
        agreedAddons: ["shopping"],
        agreedDurationMinutes: 120,
        agreedScheduledAt: "2026-08-01T10:00:00.000Z",
        agreedTermsComment: "Две бытовые задачи и покупки"
      }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.agreedTerms.agreedHelperAmount, 950);
    assert.equal(response.payload.agreedTerms.customerTotalAmount, 1000);
    assert.equal(response.payload.agreedTerms.helperNetAmount, 900);
    assert.equal(response.payload.agreedTerms.agreedPackageTitle, "Бытовая помощь 2 часа");
    assert.deepEqual(response.payload.agreedTerms.agreedAddons, ["shopping"]);
    assert.equal(response.payload.clientConfirmedAt, null);
    assert.equal(response.payload.performerConfirmedAt, null);
    const structuredTerms = await prisma.chat.findUniqueOrThrow({ where: { id: chat.id } });
    assert.equal(structuredTerms.agreedHelperAmount, 950);
    assert.equal(structuredTerms.customerTotalAmount, 1000);
    assert.equal(structuredTerms.helperNetAmount, 900);
    assert.equal(structuredTerms.termsUpdatedByUserId, client.id);
    assert.ok(structuredTerms.termsUpdatedAt);

    const adminTermsView = await apiRequest(app, `/api/chats/${chat.id}/messages`, { method: "GET", token: adminToken });
    assert.equal(adminTermsView.status, 200);
    assert.equal(adminTermsView.payload.agreedTerms.agreedHelperAmount, 950);

    response = await apiRequest(app, `/api/chats/${chat.id}/client-confirm`, { method: "POST", token: clientToken });
    assert.equal(response.status, 200);
    assert.equal(response.payload.status, "waiting_performer_confirmation");
    assert.ok(response.payload.agreedTerms.agreedByCustomerAt);

    response = await apiRequest(app, `/api/chats/${chat.id}/terms`, {
      method: "PATCH",
      token: performerToken,
      body: {
        agreedHelperAmount: 950,
        agreedPackageId: "home_help_2h",
        agreedAddons: ["shopping"],
        agreedDurationMinutes: 120,
        agreedTermsComment: "Условия проверены Помощником"
      }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.status, "open");
    assert.equal(response.payload.clientConfirmedAt, null);
    assert.equal(response.payload.performerConfirmedAt, null);
    assert.equal(response.payload.agreedTerms.agreedByCustomerAt, null);
    assert.equal(response.payload.agreedTerms.termsUpdatedByUserId, performer.id);

    response = await apiRequest(app, `/api/chats/${chat.id}/client-confirm`, { method: "POST", token: clientToken });
    assert.equal(response.status, 200);
    response = await apiRequest(app, `/api/chats/${chat.id}/performer-confirm`, { method: "POST", token: performerToken });
    assert.equal(response.status, 200);
    assert.equal(response.payload.status, "in_work");
    assert.ok(response.payload.agreementFinalizedAt);

    const balancesAfterHappyPath = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: client.id }, select: { balance: true } }),
      prisma.user.findUniqueOrThrow({ where: { id: performer.id }, select: { balance: true } })
    ]);
    assert.equal(balancesAfterHappyPath[0].balance, 450);
    assert.equal(balancesAfterHappyPath[1].balance, 450);
    assert.equal(await countServiceFeeTransactions(request.id), 2);
    const finalizedChat = await prisma.chat.findUniqueOrThrow({ where: { id: chat.id } });
    const conditions = JSON.parse(finalizedChat.conditionsJson ?? "{}");
    assert.equal(conditions.agreedHelperAmount, 950);
    assert.equal(conditions.customerTotalAmount, 1000);
    assert.equal(conditions.helperNetAmount, 900);
    assert.equal(conditions.priceEstimateAmount, undefined);
    assert.equal(finalizedChat.agreedHelperAmount, 950);
    const adminRequestsView = await apiRequest(app, "/api/admin/requests", { method: "GET", token: adminToken });
    const adminRequest = adminRequestsView.payload.find((item: any) => item.id === request.id);
    assert.equal(adminRequest.chat.agreedTerms.agreedHelperAmount, 950);
    assert.equal(adminRequest.chat.agreedTerms.customerTotalAmount, 1000);

    response = await apiRequest(app, `/api/chats/${chat.id}/terms`, {
      method: "PATCH",
      token: clientToken,
      body: { agreedHelperAmount: 1000 }
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.code, "agreement_terms_locked");

    response = await apiRequest(app, `/api/chats/${chat.id}/messages`, { method: "GET", token: performerToken });
    assert.equal(response.payload.request.addressHouse, "10");
    assert.equal(response.payload.request.addressApartment, "15");
    assert.equal(response.payload.request.contactName, null);
    assert.equal(response.payload.request.contactPhone, null);

    const [clientView, adminView] = await Promise.all([
      apiRequest(app, `/api/chats/${chat.id}/messages`, { method: "GET", token: clientToken }),
      apiRequest(app, `/api/chats/${chat.id}/messages`, { method: "GET", token: adminToken })
    ]);
    assert.equal(clientView.payload.request.contactName, "Приватный Заказчик");
    assert.equal(clientView.payload.request.contactPhone, "+79990000001");
    assert.equal(adminView.payload.request.contactName, "Приватный Заказчик");
    assert.equal(adminView.payload.request.contactPhone, "+79990000001");

    const repeatResponses = await Promise.all([
      apiRequest(app, `/api/chats/${chat.id}/client-confirm`, { method: "POST", token: clientToken }),
      apiRequest(app, `/api/chats/${chat.id}/client-confirm`, { method: "POST", token: clientToken }),
      apiRequest(app, `/api/chats/${chat.id}/performer-confirm`, { method: "POST", token: performerToken }),
      apiRequest(app, `/api/chats/${chat.id}/performer-confirm`, { method: "POST", token: performerToken })
    ]);
    assert.ok(repeatResponses.every((item) => item.status === 200 && item.payload.status === "in_work"));
    assert.equal(await countServiceFeeTransactions(request.id), 2);
    const balancesAfterRepeats = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: client.id }, select: { balance: true } }),
      prisma.user.findUniqueOrThrow({ where: { id: performer.id }, select: { balance: true } })
    ]);
    assert.equal(balancesAfterRepeats[0].balance, 450);
    assert.equal(balancesAfterRepeats[1].balance, 450);

    env.nodeEnv = "production";
    env.allowLegacyMockTopUp = true;
    response = await legacyMockTopUpRequest(app, clientToken);
    assert.equal(response.status, 403);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, 450);

    env.nodeEnv = "test";
    env.allowLegacyMockTopUp = false;
    response = await legacyMockTopUpRequest(app, clientToken);
    assert.equal(response.status, 403);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, 450);

    env.allowLegacyMockTopUp = true;
    response = await legacyMockTopUpRequest(app, clientToken);
    assert.equal(response.status, 200);
    assert.equal(response.payload.realBalance, 600);
  } finally {
    env.nodeEnv = originalEnv.nodeEnv;
    env.allowLegacyMockTopUp = originalEnv.allowLegacyMockTopUp;
    if (requestId) {
      await prisma.balanceTransaction.deleteMany({ where: { relatedRequestId: requestId } });
      await prisma.chatMessage.deleteMany({ where: { chat: { requestId } } });
      await prisma.chat.deleteMany({ where: { requestId } });
      await prisma.requestResponse.deleteMany({ where: { requestId } });
      await prisma.clientRequest.deleteMany({ where: { id: requestId } });
    }
    await prisma.balanceTransaction.deleteMany({
      where: { userId: client.id, reason: "Тестовое пополнение", createdAt: { gte: testStartedAt } }
    });
    await Promise.all([
      prisma.user.update({ where: { id: client.id }, data: originalClientBalance }),
      prisma.user.update({ where: { id: performer.id }, data: originalPerformerBalance })
    ]);
  }
}

function countServiceFeeTransactions(requestId: string) {
  return prisma.balanceTransaction.count({
    where: { relatedRequestId: requestId, type: { in: ["client_service_fee", "performer_service_fee"] } }
  });
}

function legacyMockTopUpRequest(app: ReturnType<typeof createApp>, token: string) {
  return apiRequest(app, "/api/balance/mock-top-up", {
    method: "POST",
    token,
    body: { amount: 150 }
  });
}

async function runPaymentCreditIdempotencyTests() {
  const client = await prisma.user.findUnique({ where: { email: "client@zabota.local" } });
  assert.ok(client, "Нужен demo-заказчик для payment credit tests");

  const originalBalance = client.balance;
  const paymentIds: string[] = [];
  const idempotencyKeys: string[] = [];
  try {
    const payment = await prisma.paymentTransaction.create({
      data: {
        userId: client.id,
        provider: "mock",
        providerPaymentId: `MOCK-IDEMPOTENCY-${Date.now()}`,
        orderId: `TOPUP-IDEMPOTENCY-${Date.now()}`,
        amount: 150,
        status: "succeeded"
      }
    });
    paymentIds.push(payment.id);
    const idempotencyKey = paymentCreditIdempotencyKey(payment.id);
    idempotencyKeys.push(idempotencyKey);

    const results = await Promise.all([
      creditPaymentToBalance(payment.id, { comment: payment.orderId }),
      creditPaymentToBalance(payment.id, { comment: payment.orderId })
    ]);
    assert.equal(results.filter((result) => result.credited).length, 1);
    assert.equal(await prisma.balanceTransaction.count({ where: { idempotencyKey } }), 1);
    const ledger = await prisma.balanceTransaction.findUniqueOrThrow({ where: { idempotencyKey } });
    assert.equal(ledger.idempotencyKey, `payment_credit:${payment.id}`);
    const creditedPayment = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } });
    assert.ok(creditedPayment.creditedAt);
    assert.equal(creditedPayment.balanceTransactionId, ledger.id);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, originalBalance + 150);

    const repeated = await creditPaymentToBalance(payment.id, { comment: payment.orderId });
    assert.equal(repeated.credited, false);
    assert.equal(await prisma.balanceTransaction.count({ where: { idempotencyKey } }), 1);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, originalBalance + 150);

    for (const status of ["pending", "failed", "cancelled", "expired", "manual_review"] as const) {
      const terminalPayment = await prisma.paymentTransaction.create({
        data: {
          userId: client.id,
          provider: "mock",
          providerPaymentId: `MOCK-${status.toUpperCase()}-${Date.now()}`,
          orderId: `TOPUP-${status.toUpperCase()}-${Date.now()}`,
          amount: 150,
          status
        }
      });
      paymentIds.push(terminalPayment.id);
      const terminalKey = paymentCreditIdempotencyKey(terminalPayment.id);
      idempotencyKeys.push(terminalKey);
      const result = await creditPaymentToBalance(terminalPayment.id);
      assert.equal(result.credited, false);
      assert.equal(await prisma.balanceTransaction.count({ where: { idempotencyKey: terminalKey } }), 0);
    }
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, originalBalance + 150);
  } finally {
    await prisma.paymentTransaction.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.balanceTransaction.deleteMany({ where: { idempotencyKey: { in: idempotencyKeys } } });
    await prisma.user.update({ where: { id: client.id }, data: { balance: originalBalance } });
  }
}

async function runPaymentRouteTests() {
  const app = createApp();
  const client = await prisma.user.findUnique({ where: { email: "client@zabota.local" } });
  const performer = await prisma.user.findUnique({ where: { email: "performer@zabota.local" } });
  const admin = await prisma.user.findUnique({ where: { email: "admin@zabota.local" } });
  assert.ok(client, "Нужен demo-заказчик для payment route tests");
  assert.ok(performer, "Нужен demo-помощник для payment route tests");
  assert.ok(admin, "Нужен demo-admin для payment route tests");

  await acceptLatestLegalDocuments({
    userId: client.id,
    documentTypes: requiredDocumentTypesForRegistration("client"),
    source: "test_setup"
  });
  await acceptLatestLegalDocuments({
    userId: performer.id,
    documentTypes: requiredDocumentTypesForRegistration("performer"),
    source: "test_setup"
  });

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
  const managerUser = await prisma.user.create({
    data: {
      role: "manager",
      rolesJson: JSON.stringify(["manager"]),
      phone: `+7888${Date.now().toString().slice(-7)}`,
      email: `payment-manager-${Date.now()}@zabota.local`,
      passwordHash: "test",
      displayName: "Payment manager test",
      cityId: client.cityId,
      status: "active"
    }
  });

  const clientToken = tokenFor(client.id, "client");
  const performerToken = tokenFor(performer.id, "performer");
  const adminToken = tokenFor(admin.id, admin.role);
  const noConsentToken = tokenFor(noConsentUser.id, "client");
  const managerToken = tokenFor(managerUser.id, "manager");
  const originalPaymentProvider = env.paymentProvider;
  const originalNodeEnv = env.nodeEnv;
  const originalTbankTerminalKey = env.tbankTerminalKey;
  const originalTbankPassword = env.tbankPassword;
  const originalTbankTerminalMode = env.tbankTerminalMode;
  const originalFetch = globalThis.fetch;

  try {
    env.paymentProvider = "mock";
    env.tbankTerminalMode = "live";
    env.tbankTerminalKey = "WEBHOOK_TEST_TERMINAL";
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

    for (const invalidAmount of [0, -150, 150.5, "150"]) {
      response = await apiRequest(app, "/api/payments/top-up/init", {
        method: "POST",
        token: clientToken,
        body: { amount: invalidAmount }
      });
      assert.equal(response.status, 400);
    }

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
    assert.equal(createdPayment.userId, client.id);
    assert.equal(createdPayment.orderId, response.payload.orderId);
    assert.equal(createdPayment.status, "pending");
    assert.equal(createdPayment.balanceTransactionId, null);
    const clientAfterInit = await prisma.user.findUniqueOrThrow({ where: { id: client.id }, select: { balance: true } });
    assert.equal(clientAfterInit.balance, clientBeforeInit.balance);

    env.paymentProvider = "tbank";
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body ?? "{}"));
      assert.equal(requestBody.Amount, 15000);
      assert.equal(requestBody.PayType, "O");
      const successUrl = new URL(requestBody.SuccessURL);
      const failUrl = new URL(requestBody.FailURL);
      assert.ok(successUrl.searchParams.get("paymentId"));
      assert.equal(successUrl.searchParams.get("orderId"), requestBody.OrderId);
      assert.ok(failUrl.searchParams.get("paymentId"));
      assert.equal(failUrl.searchParams.get("orderId"), requestBody.OrderId);
      return new Response(JSON.stringify({
        Success: true,
        ErrorCode: "0",
        PaymentId: `TBANK-INIT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        PaymentURL: "https://securepay.tbank.test/payment/test",
        Status: "NEW",
        OrderId: requestBody.OrderId,
        Amount: requestBody.Amount
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    response = await apiRequest(app, "/api/payments/top-up/init", {
      method: "POST",
      token: clientToken,
      body: { amount: 150 }
    });
    assert.equal(response.status, 201);
    assert.equal(response.payload.provider, "tbank");
    assert.equal(response.payload.status, "pending");
    assert.equal(response.payload.paymentUrl, "https://securepay.tbank.test/payment/test");
    paymentIds.push(response.payload.id);
    orderIds.push(response.payload.orderId);
    const tbankInitPayment = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: response.payload.id } });
    assert.ok(tbankInitPayment.providerPaymentId);
    assert.equal(tbankInitPayment.status, "pending");
    assert.equal(tbankInitPayment.creditedAt, null);
    assert.equal(tbankInitPayment.terminalMode, "live");
    assert.equal(JSON.parse(tbankInitPayment.metadataJson ?? "{}").terminalMode, "live");

    env.tbankTerminalMode = "test";
    response = await apiRequest(app, "/api/payments/top-up/init", {
      method: "POST",
      token: clientToken,
      body: { amount: 150 }
    });
    assert.equal(response.status, 201);
    const testTerminalPayment = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: response.payload.id } });
    paymentIds.push(testTerminalPayment.id);
    orderIds.push(testTerminalPayment.orderId);
    assert.equal(testTerminalPayment.provider, "tbank");
    assert.equal(testTerminalPayment.terminalMode, "test");
    assert.equal(JSON.parse(testTerminalPayment.metadataJson ?? "{}").terminalMode, "test");
    env.tbankTerminalMode = "live";
    env.paymentProvider = "mock";
    globalThis.fetch = originalFetch;

    env.nodeEnv = "production";
    response = await apiRequest(app, `/api/payments/mock/${createdPayment.id}/succeed`, {
      method: "POST",
      token: clientToken
    });
    assert.equal(response.status, 403);
    assert.equal(response.payload.code, "mock_payment_forbidden");
    response = await apiRequest(app, `/api/payments/mock/${createdPayment.id}/fail`, {
      method: "POST",
      token: clientToken
    });
    assert.equal(response.status, 403);
    assert.equal(response.payload.code, "mock_payment_forbidden");
    env.nodeEnv = originalNodeEnv;

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
    assert.equal(await prisma.npdTaxRegisterEntry.count({
      where: { paymentTransactionId: createdPayment.id }
    }), 0, "Mock-платёж не должен попадать в реестр «Мой налог»");

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

    response = await apiRequest(app, `/api/payments/mock/${performerPaymentId}/succeed`, {
      method: "POST",
      token: clientToken
    });
    assert.equal(response.status, 403);
    assert.equal(response.payload.code, "forbidden");
    response = await apiRequest(app, `/api/payments/mock/${performerPaymentId}/fail`, {
      method: "POST",
      token: clientToken
    });
    assert.equal(response.status, 403);
    response = await apiRequest(app, `/api/payments/mock/${performerPaymentId}/succeed`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 403, "Mock endpoints используют owner-only политику и для администратора");

    response = await apiRequest(app, `/api/payments/mock/${performerPaymentId}/fail`, {
      method: "POST",
      token: performerToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.payment.status, "failed");

    response = await apiRequest(app, "/api/payments/my", {
      method: "GET",
      token: clientToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.some((payment: any) => payment.id === performerPaymentId), false);
    assert.equal(response.payload.some((payment: any) => Object.prototype.hasOwnProperty.call(payment, "rawWebhookJson")), false);
    assert.equal(response.payload.some((payment: any) => Object.prototype.hasOwnProperty.call(payment, "rawInitRequestJson")), false);
    assert.equal(response.payload.some((payment: any) => Object.prototype.hasOwnProperty.call(payment, "metadataJson")), false);

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
    assert.equal(response.payload.some((payment: any) => Object.prototype.hasOwnProperty.call(payment, "rawInitRequestJson")), false);

    const webhookOrderId = `TOPUP-WEBHOOK-${Date.now()}`;
    orderIds.push(webhookOrderId);
    const webhookPayment = await prisma.paymentTransaction.create({
      data: {
        userId: client.id,
        provider: "tbank",
        terminalMode: "live",
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
        TerminalKey: env.tbankTerminalKey,
        Success: true,
        Status: "CONFIRMED",
        Amount: 15000,
        Token: "invalid-token"
      }
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.code, "payment_webhook_token_invalid");
    const balanceAfterInvalidWebhook = await prisma.user.findUniqueOrThrow({ where: { id: client.id }, select: { balance: true } });
    assert.equal(balanceAfterInvalidWebhook.balance, balanceBeforeWebhook.balance);

    const webhookCases = [
      { suffix: "MISMATCH", status: "CONFIRMED", success: true, amount: 14900, expectedStatus: "manual_review" },
      { suffix: "FAILED", status: "REJECTED", success: false, amount: 15000, expectedStatus: "failed" },
      { suffix: "CANCELLED", status: "CANCELED", success: false, amount: 15000, expectedStatus: "cancelled" },
      { suffix: "AUTHORIZED", status: "AUTHORIZED", success: true, amount: 15000, expectedStatus: "pending" }
    ] as const;
    for (const webhookCase of webhookCases) {
      const caseOrderId = `TOPUP-WEBHOOK-${webhookCase.suffix}-${Date.now()}`;
      const caseProviderPaymentId = `TBANK-WEBHOOK-${webhookCase.suffix}-${Date.now()}`;
      orderIds.push(caseOrderId);
      const casePayment: { id: string } = await prisma.paymentTransaction.create({
        data: {
          userId: client.id,
          provider: "tbank",
          providerPaymentId: caseProviderPaymentId,
          orderId: caseOrderId,
          amount: 150,
          status: "pending",
          description: `Webhook ${webhookCase.suffix} test`
        }
      });
      paymentIds.push(casePayment.id);
      const casePayload = {
        PaymentId: caseProviderPaymentId,
        OrderId: caseOrderId,
        TerminalKey: env.tbankTerminalKey,
        Success: webhookCase.success,
        Status: webhookCase.status,
        Amount: webhookCase.amount
      };
      const caseResponse = await rawAppRequest(app, "/api/payments/tbank/webhook", {
        method: "POST",
        body: { ...casePayload, Token: buildTbankToken(casePayload, env.tbankPassword) }
      });
      assert.equal(caseResponse.status, 200);
      assert.equal(caseResponse.text, "OK");
      assert.equal((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: casePayment.id } })).status, webhookCase.expectedStatus);
      assert.equal(await prisma.balanceTransaction.count({ where: { idempotencyKey: paymentCreditIdempotencyKey(casePayment.id) } }), 0);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, balanceBeforeWebhook.balance);
    }

    for (let index = 0; index < 2; index += 1) {
      const webhookPayload = {
        PaymentId: "TBANK-WEBHOOK-TEST",
        OrderId: webhookOrderId,
        TerminalKey: env.tbankTerminalKey,
        Success: true,
        Status: "CONFIRMED",
        Amount: 15000
      };
      const webhookResponse = await rawAppRequest(app, "/api/payments/tbank/webhook", {
        method: "POST",
        body: {
          ...webhookPayload,
          Token: buildTbankToken(webhookPayload, env.tbankPassword)
        }
      });
      assert.equal(webhookResponse.status, 200);
      assert.equal(webhookResponse.text, "OK");
    }
    const balanceAfterWebhook = await prisma.user.findUniqueOrThrow({ where: { id: client.id }, select: { balance: true } });
    assert.equal(balanceAfterWebhook.balance, balanceBeforeWebhook.balance + 150);
    const webhookTransactionsCount = await prisma.balanceTransaction.count({ where: { comment: webhookOrderId } });
    assert.equal(webhookTransactionsCount, 1);
    const webhookPaymentAfter = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: webhookPayment.id } });
    assert.equal(webhookPaymentAfter.status, "succeeded");
    assert.match(webhookPaymentAfter.rawWebhookJson ?? "", /CONFIRMED/);
    const tbankNpdEntry = await prisma.npdTaxRegisterEntry.findFirstOrThrow({
      where: { operationType: "payment", paymentTransactionId: webhookPayment.id }
    });
    assert.equal(tbankNpdEntry.copyText, "Сервисный платёж за использование сервиса «Забота Рядом»");
    assert.equal(tbankNpdEntry.source, "tbank");
    assert.equal(tbankNpdEntry.isTestOperation, false);

    const testTerminalWebhookPayload = {
      PaymentId: testTerminalPayment.providerPaymentId!,
      OrderId: testTerminalPayment.orderId,
      TerminalKey: env.tbankTerminalKey,
      Success: true,
      Status: "CONFIRMED",
      Amount: 15000
    };
    const balanceBeforeTestTerminalWebhook = (await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance;
    const testTerminalWebhookResponse = await rawAppRequest(app, "/api/payments/tbank/webhook", {
      method: "POST",
      body: {
        ...testTerminalWebhookPayload,
        Token: buildTbankToken(testTerminalWebhookPayload, env.tbankPassword)
      }
    });
    assert.equal(testTerminalWebhookResponse.status, 200);
    assert.equal(testTerminalWebhookResponse.text, "OK");
    assert.equal((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: testTerminalPayment.id } })).status, "succeeded");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, balanceBeforeTestTerminalWebhook + 150);
    assert.equal(await prisma.npdTaxRegisterEntry.count({ where: { paymentTransactionId: testTerminalPayment.id } }), 0,
      "Платёж тестового T-Bank терминала не должен создавать запись НПД");

    const stateResponses = new Map<string, Record<string, unknown>>();
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      assert.match(String(url), /\/GetState$/);
      const requestBody = JSON.parse(String(init?.body ?? "{}"));
      assert.equal(requestBody.TerminalKey, env.tbankTerminalKey);
      assert.equal(requestBody.Token, buildTbankToken(requestBody, env.tbankPassword));
      const payload = stateResponses.get(String(requestBody.PaymentId));
      assert.ok(payload, `Missing GetState fixture for ${requestBody.PaymentId}`);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;

    async function createStatePayment(label: string) {
      const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const stateOrderId = `TOPUP-STATE-${suffix}`;
      const providerPaymentId = `TBANK-STATE-${suffix}`;
      orderIds.push(stateOrderId);
      const row = await prisma.paymentTransaction.create({
        data: {
          userId: client!.id,
          provider: "tbank",
          terminalMode: "live",
          providerPaymentId,
          orderId: stateOrderId,
          amount: 150,
          status: "pending",
          description: `GetState ${label} test`
        }
      });
      paymentIds.push(row.id);
      return row;
    }

    const stateConfirmedPayment = await createStatePayment("CONFIRMED");
    stateResponses.set(stateConfirmedPayment.providerPaymentId!, {
      Success: true,
      TerminalKey: env.tbankTerminalKey,
      PaymentId: stateConfirmedPayment.providerPaymentId,
      OrderId: stateConfirmedPayment.orderId,
      Amount: 15000,
      Status: "CONFIRMED",
      Token: "provider-token-must-not-leak"
    });
    response = await apiRequest(app, `/api/payments/${stateConfirmedPayment.id}/refresh-status`, {
      method: "POST",
      token: performerToken
    });
    assert.equal(response.status, 403);
    response = await apiRequest(app, `/api/payments/${stateConfirmedPayment.id}/refresh-status`, {
      method: "POST",
      token: managerToken
    });
    assert.equal(response.status, 403);
    assert.equal(response.payload.code, "manager_permission_denied");
    response = await apiRequest(app, `/api/admin/payments/${createdPayment.id}/refund`, {
      method: "POST",
      token: adminToken,
      body: { amount: 150, reason: "" }
    });
    assert.equal(response.status, 400);

    const balanceBeforeStateCredit = (await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance;
    response = await apiRequest(app, `/api/payments/${stateConfirmedPayment.id}/refresh-status`, {
      method: "POST",
      token: clientToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.status, "succeeded");
    assert.ok(response.payload.creditedAt);
    assert.ok(response.payload.balanceTransactionId);
    assert.equal(JSON.stringify(response.payload).includes(env.tbankPassword), false);
    assert.equal(JSON.stringify(response.payload).includes("provider-token-must-not-leak"), false);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, balanceBeforeStateCredit + 150);

    response = await apiRequest(app, `/api/payments/${stateConfirmedPayment.id}/refresh-status`, {
      method: "POST",
      token: clientToken
    });
    assert.equal(response.status, 200);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, balanceBeforeStateCredit + 150);
    assert.equal(await prisma.balanceTransaction.count({
      where: { idempotencyKey: paymentCreditIdempotencyKey(stateConfirmedPayment.id) }
    }), 1);

    const stateWebhookPayload = {
      PaymentId: stateConfirmedPayment.providerPaymentId,
      OrderId: stateConfirmedPayment.orderId,
      TerminalKey: env.tbankTerminalKey,
      Success: true,
      Status: "CONFIRMED",
      Amount: 15000
    };
    const webhookAfterState = await rawAppRequest(app, "/api/payments/tbank/webhook", {
      method: "POST",
      body: { ...stateWebhookPayload, Token: buildTbankToken(stateWebhookPayload, env.tbankPassword) }
    });
    assert.equal(webhookAfterState.status, 200);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, balanceBeforeStateCredit + 150);

    stateResponses.set(webhookPayment.providerPaymentId!, {
      Success: true,
      TerminalKey: env.tbankTerminalKey,
      PaymentId: webhookPayment.providerPaymentId,
      OrderId: webhookPayment.orderId,
      Amount: 15000,
      Status: "CONFIRMED"
    });
    const balanceBeforeRefreshAfterWebhook = (await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance;
    response = await apiRequest(app, `/api/payments/${webhookPayment.id}/refresh-status`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.status, "succeeded");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, balanceBeforeRefreshAfterWebhook);

    const stateAuthorizedPayment = await createStatePayment("AUTHORIZED");
    stateResponses.set(stateAuthorizedPayment.providerPaymentId!, {
      Success: true,
      TerminalKey: env.tbankTerminalKey,
      PaymentId: stateAuthorizedPayment.providerPaymentId,
      OrderId: stateAuthorizedPayment.orderId,
      Amount: 15000,
      Status: "AUTHORIZED"
    });
    response = await apiRequest(app, `/api/payments/${stateAuthorizedPayment.id}/refresh-status`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.status, "pending");
    assert.equal(await prisma.balanceTransaction.count({ where: { idempotencyKey: paymentCreditIdempotencyKey(stateAuthorizedPayment.id) } }), 0);

    for (const providerStatus of ["REJECTED", "CANCELED"] as const) {
      const terminalPayment = await createStatePayment(providerStatus);
      stateResponses.set(terminalPayment.providerPaymentId!, {
        Success: true,
        TerminalKey: env.tbankTerminalKey,
        PaymentId: terminalPayment.providerPaymentId,
        OrderId: terminalPayment.orderId,
        Amount: 15000,
        Status: providerStatus
      });
      response = await apiRequest(app, `/api/payments/${terminalPayment.id}/refresh-status`, {
        method: "POST",
        token: clientToken
      });
      assert.equal(response.status, 200);
      assert.equal(response.payload.status, providerStatus === "REJECTED" ? "failed" : "cancelled");
      assert.equal(await prisma.balanceTransaction.count({ where: { idempotencyKey: paymentCreditIdempotencyKey(terminalPayment.id) } }), 0);
    }

    const amountMismatchPayment = await createStatePayment("AMOUNT-MISMATCH");
    stateResponses.set(amountMismatchPayment.providerPaymentId!, {
      Success: true,
      TerminalKey: env.tbankTerminalKey,
      PaymentId: amountMismatchPayment.providerPaymentId,
      OrderId: amountMismatchPayment.orderId,
      Amount: 14900,
      Status: "CONFIRMED"
    });
    response = await apiRequest(app, `/api/payments/${amountMismatchPayment.id}/refresh-status`, {
      method: "POST",
      token: clientToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.status, "manual_review");
    assert.equal(await prisma.balanceTransaction.count({ where: { idempotencyKey: paymentCreditIdempotencyKey(amountMismatchPayment.id) } }), 0);

    const idMismatchPayment = await createStatePayment("ID-MISMATCH");
    stateResponses.set(idMismatchPayment.providerPaymentId!, {
      Success: true,
      TerminalKey: env.tbankTerminalKey,
      PaymentId: "ANOTHER-PAYMENT-ID",
      OrderId: idMismatchPayment.orderId,
      Amount: 15000,
      Status: "CONFIRMED"
    });
    response = await apiRequest(app, `/api/payments/${idMismatchPayment.id}/refresh-status`, {
      method: "POST",
      token: clientToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.status, "manual_review");
    assert.equal(await prisma.balanceTransaction.count({ where: { idempotencyKey: paymentCreditIdempotencyKey(idMismatchPayment.id) } }), 0);

    globalThis.fetch = (async () => {
      throw new Error("Mock refresh must not call provider");
    }) as typeof fetch;
    response = await apiRequest(app, `/api/payments/${createdPayment.id}/refresh-status`, {
      method: "POST",
      token: clientToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.provider, "mock");
    assert.equal(response.payload.status, "succeeded");

    const manualBankOrderId = `TOPUP-MANUAL-BANK-${Date.now()}`;
    const manualBankPayment = await prisma.paymentTransaction.create({
      data: {
        userId: client.id,
        provider: "tbank",
        terminalMode: "live",
        providerPaymentId: `TBANK-MANUAL-BANK-${Date.now()}`,
        orderId: manualBankOrderId,
        amount: 150,
        status: "succeeded",
        paidAt: new Date(),
        description: "Manual bank refund test"
      }
    });
    paymentIds.push(manualBankPayment.id);
    orderIds.push(manualBankOrderId);
    await creditPaymentToBalance(manualBankPayment.id, { comment: manualBankOrderId });
    const manualBankBody = {
      amount: 150,
      bankRefundDate: new Date().toISOString().slice(0, 10),
      reason: "customer_request",
      comment: "Возврат выполнен в кабинете T-Bank по заявлению Заказчика",
      bankReference: "BANK-REF-150"
    };

    response = await apiRequest(app, `/api/admin/payments/${manualBankPayment.id}/manual-bank-refund`, {
      method: "POST",
      token: managerToken,
      body: manualBankBody
    });
    assert.equal(response.status, 403);
    assert.equal(response.payload.code, "manager_permission_denied");
    for (const token of [clientToken, performerToken]) {
      response = await apiRequest(app, `/api/admin/payments/${manualBankPayment.id}/manual-bank-refund`, {
        method: "POST",
        token,
        body: manualBankBody
      });
      assert.equal(response.status, 403);
    }
    response = await apiRequest(app, `/api/admin/payments/${createdPayment.id}/manual-bank-refund`, {
      method: "POST",
      token: adminToken,
      body: manualBankBody
    });
    assert.equal(response.status, 409);
    assert.equal(response.payload.code, "manual_bank_refund_real_payment_required");
    response = await apiRequest(app, `/api/admin/payments/${testTerminalPayment.id}/manual-bank-refund`, {
      method: "POST",
      token: adminToken,
      body: manualBankBody
    });
    assert.equal(response.status, 409);
    assert.equal(response.payload.code, "manual_bank_refund_live_payment_required");
    assert.equal(await prisma.refundTransaction.count({ where: { paymentTransactionId: testTerminalPayment.id } }), 0);
    const fetchBeforeTestTerminalRefund = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      assert.match(String(url), /\/Cancel$/);
      const requestBody = JSON.parse(String(init?.body ?? "{}"));
      assert.equal(requestBody.PaymentId, testTerminalPayment.providerPaymentId);
      return new Response(JSON.stringify({
        Success: true,
        TerminalKey: env.tbankTerminalKey,
        PaymentId: testTerminalPayment.providerPaymentId,
        RefundId: `TEST-REFUND-${testTerminalPayment.id}`,
        Amount: 15000,
        OriginalAmount: 15000,
        NewAmount: 0,
        Status: "REFUNDED"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    response = await apiRequest(app, `/api/admin/payments/${testTerminalPayment.id}/refund`, {
      method: "POST",
      token: adminToken,
      body: { amount: 150, reason: "Возврат тестового T-Bank платежа" }
    });
    assert.equal(response.status, 200);
    const testTerminalRefund = await prisma.refundTransaction.findUniqueOrThrow({
      where: { paymentTransactionId: testTerminalPayment.id }
    });
    assert.equal(testTerminalRefund.provider, "tbank");
    assert.equal(testTerminalRefund.status, "succeeded");
    assert.equal(await prisma.npdTaxRegisterEntry.count({ where: { refundTransactionId: testTerminalRefund.id } }), 0,
      "Возврат тестового T-Bank платежа не должен создавать запись НПД");
    globalThis.fetch = fetchBeforeTestTerminalRefund;
    response = await apiRequest(app, `/api/admin/payments/${tbankInitPayment.id}/manual-bank-refund`, {
      method: "POST",
      token: adminToken,
      body: manualBankBody
    });
    assert.equal(response.status, 409);
    assert.equal(response.payload.code, "payment_not_refundable");
    response = await apiRequest(app, `/api/admin/payments/${manualBankPayment.id}/manual-bank-refund`, {
      method: "POST",
      token: adminToken,
      body: { ...manualBankBody, amount: 151 }
    });
    assert.equal(response.status, 400);

    const balanceBeforeManualBankRefund = (await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance;
    response = await apiRequest(app, `/api/admin/payments/${manualBankPayment.id}/manual-bank-refund`, {
      method: "POST",
      token: adminToken,
      body: manualBankBody
    });
    assert.equal(response.status, 201);
    assert.equal(response.payload.refund.provider, "manual_bank");
    assert.equal(response.payload.refund.refundType, "bank_refund_manual");
    assert.equal(response.payload.refund.status, "succeeded");
    assert.equal(response.payload.refund.userId, client.id);
    assert.equal(response.payload.refund.bankReference, "BANK-REF-150");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, balanceBeforeManualBankRefund - 150);
    const manualBankRefund = await prisma.refundTransaction.findUniqueOrThrow({
      where: { paymentTransactionId: manualBankPayment.id }
    });
    const manualBankLedger = await prisma.balanceTransaction.findUniqueOrThrow({
      where: { idempotencyKey: `manual_bank_refund:${manualBankRefund.id}` }
    });
    assert.equal(manualBankLedger.type, "bank_refund");
    assert.equal(manualBankLedger.source, "manual_bank");
    assert.equal(manualBankLedger.amount, -150);
    assert.match(manualBankLedger.reason, /Возврат по банку/);
    const manualBankNpdEntry = await prisma.npdTaxRegisterEntry.findUniqueOrThrow({
      where: { refundTransactionId: manualBankRefund.id }
    });
    assert.equal(manualBankNpdEntry.operationType, "refund");
    assert.equal(manualBankNpdEntry.amount, -150);
    assert.equal(manualBankNpdEntry.source, "manual_bank");
    assert.equal(manualBankNpdEntry.copyText, "Возврат сервисного платежа за использование сервиса «Забота Рядом»");
    assert.equal(manualBankNpdEntry.npdStatus, "needs_review");
    assert.ok(await prisma.auditLog.findFirst({
      where: { actorUserId: admin.id, action: "admin.bank_refund.create", entityId: manualBankPayment.id }
    }));
    response = await apiRequest(app, `/api/admin/payments/${manualBankPayment.id}/manual-bank-refund`, {
      method: "POST",
      token: adminToken,
      body: manualBankBody
    });
    assert.equal(response.status, 409);
    assert.equal(response.payload.code, "manual_bank_refund_already_exists");
    assert.equal(await prisma.balanceTransaction.count({ where: { idempotencyKey: `manual_bank_refund:${manualBankRefund.id}` } }), 1);

    const insufficientOrderId = `TOPUP-MANUAL-BANK-LOW-${Date.now()}`;
    const insufficientManualBankPayment = await prisma.paymentTransaction.create({
      data: {
        userId: client.id,
        provider: "tbank",
        terminalMode: "live",
        providerPaymentId: `TBANK-MANUAL-BANK-LOW-${Date.now()}`,
        orderId: insufficientOrderId,
        amount: 150,
        status: "succeeded",
        paidAt: new Date(),
        description: "Manual bank insufficient balance test"
      }
    });
    paymentIds.push(insufficientManualBankPayment.id);
    orderIds.push(insufficientOrderId);
    await creditPaymentToBalance(insufficientManualBankPayment.id, { comment: insufficientOrderId });
    const balanceBeforeManualBankInsufficient = (await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance;
    await prisma.user.update({ where: { id: client.id }, data: { balance: 0 } });
    response = await apiRequest(app, `/api/admin/payments/${insufficientManualBankPayment.id}/manual-bank-refund`, {
      method: "POST",
      token: adminToken,
      body: manualBankBody
    });
    assert.equal(response.status, 409);
    assert.equal(response.payload.code, "manual_bank_refund_balance_insufficient");
    assert.match(response.payload.error, /Недостаточно основного баланса/);
    assert.equal(await prisma.refundTransaction.count({ where: { paymentTransactionId: insufficientManualBankPayment.id } }), 0);
    await prisma.user.update({ where: { id: client.id }, data: { balance: balanceBeforeManualBankInsufficient } });

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      assert.match(String(url), /\/GetState$/);
      const requestBody = JSON.parse(String(init?.body ?? "{}"));
      const payload = stateResponses.get(String(requestBody.PaymentId));
      assert.ok(payload, `Missing GetState fixture for ${requestBody.PaymentId}`);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;

    async function createSyncPayment(label: string, terminalMode: "test" | "live") {
      const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const syncPayment = await prisma.paymentTransaction.create({
        data: {
          userId: client!.id,
          provider: "tbank",
          terminalMode,
          providerPaymentId: `TBANK-SYNC-${suffix}`,
          orderId: `TOPUP-SYNC-${suffix}`,
          amount: 150,
          status: "succeeded",
          paidAt: new Date(),
          description: `T-Bank sync ${label}`
        }
      });
      paymentIds.push(syncPayment.id);
      orderIds.push(syncPayment.orderId);
      await creditPaymentToBalance(syncPayment.id, { comment: syncPayment.orderId });
      return syncPayment;
    }

    const liveSyncPayment = await createSyncPayment("LIVE-FULL", "live");
    stateResponses.set(liveSyncPayment.providerPaymentId!, {
      Success: true,
      TerminalKey: env.tbankTerminalKey,
      PaymentId: liveSyncPayment.providerPaymentId,
      OrderId: liveSyncPayment.orderId,
      RefundId: `SYNC-REFUND-${liveSyncPayment.id}`,
      Amount: 15000,
      OriginalAmount: 15000,
      NewAmount: 0,
      RefundedAmount: 15000,
      Status: "REFUNDED",
      Token: "provider-token-must-not-leak"
    });

    response = await apiRequest(app, `/api/admin/payments/${liveSyncPayment.id}/sync-tbank-status`, {
      method: "POST",
      token: managerToken
    });
    assert.equal(response.status, 403);
    assert.equal(response.payload.code, "manager_permission_denied");
    for (const token of [clientToken, performerToken]) {
      response = await apiRequest(app, `/api/admin/payments/${liveSyncPayment.id}/sync-tbank-status`, { method: "POST", token });
      assert.equal(response.status, 403);
    }
    response = await apiRequest(app, `/api/admin/payments/${createdPayment.id}/sync-tbank-status`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.code, "payment_not_tbank");

    const balanceBeforeLiveSync = (await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance;
    response = await apiRequest(app, `/api/admin/payments/${liveSyncPayment.id}/sync-tbank-status`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.refundDetected, true);
    assert.match(response.payload.message, /Сумма списана/);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, balanceBeforeLiveSync - 150);
    const liveSyncRefund = await prisma.refundTransaction.findUniqueOrThrow({
      where: { paymentTransactionId: liveSyncPayment.id }
    });
    assert.equal(liveSyncRefund.refundType, "tbank_sync_detected");
    assert.equal(liveSyncRefund.status, "succeeded");
    const liveSyncLedger = await prisma.balanceTransaction.findUniqueOrThrow({
      where: { idempotencyKey: `tbank_sync_refund:${liveSyncPayment.id}` }
    });
    assert.equal(liveSyncLedger.type, "bank_refund");
    assert.equal(liveSyncLedger.source, "tbank_sync");
    assert.equal(liveSyncLedger.amount, -150);
    const liveSyncPaymentAfter = await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: liveSyncPayment.id } });
    assert.equal(liveSyncPaymentAfter.status, "refunded");
    assert.equal(liveSyncPaymentAfter.providerStatus, "REFUNDED");
    assert.ok(liveSyncPaymentAfter.lastSyncedAt);
    assert.equal(JSON.stringify(JSON.parse(liveSyncPaymentAfter.metadataJson ?? "{}")).includes("provider-token-must-not-leak"), false);
    assert.ok(await prisma.npdTaxRegisterEntry.findUnique({ where: { refundTransactionId: liveSyncRefund.id } }));

    response = await apiRequest(app, `/api/admin/payments/${liveSyncPayment.id}/sync-tbank-status`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.alreadyAccounted, true);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, balanceBeforeLiveSync - 150);
    assert.equal(await prisma.refundTransaction.count({ where: { paymentTransactionId: liveSyncPayment.id } }), 1);
    assert.equal(await prisma.balanceTransaction.count({ where: { idempotencyKey: `tbank_sync_refund:${liveSyncPayment.id}` } }), 1);

    const testSyncPayment = await createSyncPayment("TEST-FULL", "test");
    stateResponses.set(testSyncPayment.providerPaymentId!, {
      Success: true,
      TerminalKey: env.tbankTerminalKey,
      PaymentId: testSyncPayment.providerPaymentId,
      OrderId: testSyncPayment.orderId,
      Amount: 15000,
      Status: "REFUNDED"
    });
    response = await apiRequest(app, `/api/admin/payments/${testSyncPayment.id}/sync-tbank-status`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 200);
    const testSyncRefund = await prisma.refundTransaction.findUniqueOrThrow({ where: { paymentTransactionId: testSyncPayment.id } });
    assert.equal(await prisma.npdTaxRegisterEntry.count({ where: { refundTransactionId: testSyncRefund.id } }), 0);

    const noRefundSyncPayment = await createSyncPayment("NO-REFUND", "test");
    stateResponses.set(noRefundSyncPayment.providerPaymentId!, {
      Success: true,
      TerminalKey: env.tbankTerminalKey,
      PaymentId: noRefundSyncPayment.providerPaymentId,
      OrderId: noRefundSyncPayment.orderId,
      Amount: 15000,
      Status: "CONFIRMED"
    });
    response = await apiRequest(app, `/api/admin/payments/${noRefundSyncPayment.id}/sync-tbank-status`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.refundDetected, false);
    assert.equal(await prisma.refundTransaction.count({ where: { paymentTransactionId: noRefundSyncPayment.id } }), 0);

    const partialSyncPayment = await createSyncPayment("PARTIAL", "live");
    stateResponses.set(partialSyncPayment.providerPaymentId!, {
      Success: true,
      TerminalKey: env.tbankTerminalKey,
      PaymentId: partialSyncPayment.providerPaymentId,
      OrderId: partialSyncPayment.orderId,
      Amount: 15000,
      RefundedAmount: 5000,
      Status: "PARTIAL_REFUNDED"
    });
    const balanceBeforePartialSync = (await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance;
    response = await apiRequest(app, `/api/admin/payments/${partialSyncPayment.id}/sync-tbank-status`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.partialRefund, true);
    assert.equal(response.payload.manualReview, true);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, balanceBeforePartialSync);
    assert.equal((await prisma.refundTransaction.findUniqueOrThrow({ where: { paymentTransactionId: partialSyncPayment.id } })).status, "manual_review");
    assert.equal(await prisma.balanceTransaction.count({ where: { idempotencyKey: `tbank_sync_refund:${partialSyncPayment.id}` } }), 0);
    assert.equal(await prisma.npdTaxRegisterEntry.count({ where: { refundTransactionId: (await prisma.refundTransaction.findUniqueOrThrow({ where: { paymentTransactionId: partialSyncPayment.id } })).id } }), 0);

    const insufficientSyncPayment = await createSyncPayment("INSUFFICIENT", "live");
    stateResponses.set(insufficientSyncPayment.providerPaymentId!, {
      Success: true,
      TerminalKey: env.tbankTerminalKey,
      PaymentId: insufficientSyncPayment.providerPaymentId,
      OrderId: insufficientSyncPayment.orderId,
      Amount: 15000,
      Status: "REFUNDED"
    });
    const balanceBeforeInsufficientSync = (await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance;
    await prisma.user.update({ where: { id: client.id }, data: { balance: 0 } });
    response = await apiRequest(app, `/api/admin/payments/${insufficientSyncPayment.id}/sync-tbank-status`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.manualReview, true);
    assert.match(response.payload.message, /недостаточно средств/);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, 0);
    assert.equal(await prisma.balanceTransaction.count({ where: { idempotencyKey: `tbank_sync_refund:${insufficientSyncPayment.id}` } }), 0);
    assert.equal((await prisma.refundTransaction.findUniqueOrThrow({ where: { paymentTransactionId: insufficientSyncPayment.id } })).status, "manual_review");
    await prisma.user.update({ where: { id: client.id }, data: { balance: balanceBeforeInsufficientSync } });

    response = await apiRequest(app, `/api/admin/payments/${createdPayment.id}/refund`, {
      method: "POST",
      token: clientToken,
      body: { amount: 150, reason: "Проверка запрета возврата пользователем" }
    });
    assert.equal(response.status, 403);
    response = await apiRequest(app, `/api/admin/payments/${createdPayment.id}/refund`, {
      method: "POST",
      token: managerToken,
      body: { amount: 150, reason: "Проверка запрета возврата менеджером" }
    });
    assert.equal(response.status, 403);
    assert.equal(response.payload.code, "manager_permission_denied");
    response = await apiRequest(app, `/api/admin/payments/${createdPayment.id}/refund`, {
      method: "POST",
      token: adminToken,
      body: { amount: 151, reason: "Сумма больше исходного платежа" }
    });
    assert.equal(response.status, 400);
    assert.equal(await prisma.refundTransaction.count({ where: { paymentTransactionId: createdPayment.id } }), 0);

    const balanceBeforeRefund = (await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance;
    response = await apiRequest(app, `/api/admin/payments/${createdPayment.id}/refund`, {
      method: "POST",
      token: adminToken,
      body: { amount: 150, reason: "Возврат тестового платежа по обращению" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.refund.status, "succeeded");
    assert.equal(response.payload.idempotent, false);
    const completedRefund = await prisma.refundTransaction.findUniqueOrThrow({
      where: { paymentTransactionId: createdPayment.id }
    });
    assert.ok(completedRefund.balanceTransactionId);
    assert.equal((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: createdPayment.id } })).status, "refunded");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, balanceBeforeRefund - 150);
    const refundLedger = await prisma.balanceTransaction.findUniqueOrThrow({
      where: { idempotencyKey: `payment_refund:${completedRefund.id}` }
    });
    assert.equal(refundLedger.type, "refund");
    assert.equal(refundLedger.amount, -150);
    assert.equal(refundLedger.createdByAdminId, admin.id);
    assert.equal(await prisma.npdTaxRegisterEntry.count({
      where: { refundTransactionId: completedRefund.id }
    }), 0, "Mock-возврат не должен попадать в реестр «Мой налог»");
    response = await apiRequest(app, "/api/balance/me", {
      method: "GET",
      token: clientToken
    });
    assert.equal(response.status, 200);
    const refundHistoryEntry = response.payload.transactions.find((row: any) => row.id === refundLedger.id);
    assert.equal(refundHistoryEntry.amount, -150);
    assert.equal(refundHistoryEntry.source, "mock");
    assert.equal(refundHistoryEntry.comment, "Возврат тестового платежа по обращению");
    assert.equal(refundHistoryEntry.createdByAdmin.displayName, admin.displayName);

    response = await apiRequest(app, `/api/admin/payments/${createdPayment.id}/refund`, {
      method: "POST",
      token: adminToken,
      body: { amount: 150, reason: "Повторный возврат не должен менять баланс" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.idempotent, true);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance, balanceBeforeRefund - 150);
    assert.equal(await prisma.balanceTransaction.count({
      where: { idempotencyKey: `payment_refund:${completedRefund.id}` }
    }), 1);

    response = await apiRequest(app, `/api/admin/payments/${failedPaymentId}/refund`, {
      method: "POST",
      token: adminToken,
      body: { amount: 150, reason: "Неуспешный платёж нельзя вернуть" }
    });
    assert.equal(response.status, 409);
    assert.equal(response.payload.code, "payment_not_refundable");

    const balanceBeforeInsufficientRefundCheck = (await prisma.user.findUniqueOrThrow({ where: { id: client.id } })).balance;
    await prisma.user.update({ where: { id: client.id }, data: { balance: 0 } });
    response = await apiRequest(app, `/api/admin/payments/${webhookPayment.id}/refund`, {
      method: "POST",
      token: adminToken,
      body: { amount: 150, reason: "Проверка недостаточного основного баланса" }
    });
    assert.equal(response.status, 409);
    assert.equal(response.payload.code, "payment_refund_balance_insufficient");
    assert.equal(await prisma.refundTransaction.count({ where: { paymentTransactionId: webhookPayment.id } }), 0);
    await prisma.user.update({ where: { id: client.id }, data: { balance: balanceBeforeInsufficientRefundCheck } });

    response = await apiRequest(app, `/api/admin/payments/${webhookPayment.id}`, {
      method: "GET",
      token: adminToken
    });
    assert.equal(response.status, 200);
    assert.equal(Object.prototype.hasOwnProperty.call(response.payload.payment, "rawInitRequestJson"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(response.payload, "rawStateResponseJson"), true);
    assert.equal(response.payload.rawWebhookJson.includes("Token"), false);
    assert.equal(JSON.stringify(response.payload).includes(env.tbankPassword), false);
    response = await apiRequest(app, `/api/admin/payments/${createdPayment.id}`, {
      method: "GET",
      token: adminToken
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.refunds.length, 1);
    assert.equal(response.payload.refunds[0].status, "succeeded");

    response = await apiRequest(app, "/api/admin/npd-register", { method: "GET", token: adminToken });
    assert.equal(response.status, 200);
    assert.ok(response.payload.days.length >= 1);
    const npdEntries = response.payload.days.flatMap((day: any) => day.entries);
    const listedPaymentEntry = npdEntries.find((entry: any) => entry.id === tbankNpdEntry.id);
    const listedRefundEntry = npdEntries.find((entry: any) => entry.id === manualBankNpdEntry.id);
    assert.ok(listedPaymentEntry);
    assert.ok(listedRefundEntry);
    assert.equal(listedRefundEntry.refundTransaction.payment.id, manualBankPayment.id);
    assert.equal(npdEntries.some((entry: any) => entry.paymentTransactionId === createdPayment.id), false);
    assert.equal(npdEntries.some((entry: any) => entry.paymentTransactionId === testTerminalPayment.id), false);
    assert.ok(npdEntries.some((entry: any) => entry.paymentTransactionId === webhookPayment.id));
    assert.equal(npdEntries.some((entry: any) => entry.refundTransactionId === completedRefund.id), false);
    assert.ok(npdEntries.every((entry: any) => ["tbank", "manual_bank"].includes(entry.source)));
    assert.ok(npdEntries.every((entry: any) => entry.isTestOperation === false));
    for (const day of response.payload.days) {
      const dayEntries = day.entries as Array<{ operationType: string; amount: number; npdStatus: string }>;
      assert.equal(day.totals.paymentsCount, dayEntries.filter((entry) => entry.operationType === "payment").length);
      assert.equal(day.totals.refundsCount, dayEntries.filter((entry) => entry.operationType === "refund").length);
      assert.equal(day.totals.netAmount, dayEntries.reduce((sum, entry) => sum + entry.amount, 0));
    }
    const npdCountBeforeRepeatedList = await prisma.npdTaxRegisterEntry.count({
      where: { OR: [{ paymentTransactionId: { in: paymentIds } }, { refundTransactionId: { in: [completedRefund.id, manualBankRefund.id] } }] }
    });
    response = await apiRequest(app, `/api/admin/npd-register?from=${response.payload.from}&to=${response.payload.to}`, {
      method: "GET",
      token: adminToken
    });
    assert.equal(response.status, 200);
    assert.equal(await prisma.npdTaxRegisterEntry.count({
      where: { OR: [{ paymentTransactionId: { in: paymentIds } }, { refundTransactionId: { in: [completedRefund.id, manualBankRefund.id] } }] }
    }), npdCountBeforeRepeatedList);

    response = await apiRequest(app, `/api/admin/npd-register/${tbankNpdEntry.id}`, {
      method: "PATCH",
      token: adminToken,
      body: { npdStatus: "recorded", npdComment: "Чек сформирован в «Мой налог»" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.npdStatus, "recorded");
    assert.equal(response.payload.npdComment, "Чек сформирован в «Мой налог»");
    assert.ok(response.payload.npdRecordedAt);
    response = await apiRequest(app, `/api/admin/npd-register/${tbankNpdEntry.id}`, {
      method: "PATCH",
      token: adminToken,
      body: { npdStatus: "needs_review" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.npdStatus, "needs_review");
    assert.ok(await prisma.auditLog.findFirst({
      where: { actorUserId: admin.id, action: "admin.npd_register.update", entityId: tbankNpdEntry.id }
    }));

    response = await apiRequest(app, "/api/admin/npd-register", { method: "GET", token: managerToken });
    assert.equal(response.status, 403);
    assert.equal(response.payload.code, "manager_permission_denied");
    response = await apiRequest(app, `/api/admin/npd-register/${tbankNpdEntry.id}`, {
      method: "PATCH",
      token: managerToken,
      body: { npdStatus: "recorded" }
    });
    assert.equal(response.status, 403);
    assert.equal(response.payload.code, "manager_permission_denied");
    for (const token of [clientToken, performerToken]) {
      response = await apiRequest(app, "/api/admin/npd-register", { method: "GET", token });
      assert.equal(response.status, 403);
      response = await apiRequest(app, `/api/admin/npd-register/${tbankNpdEntry.id}`, {
        method: "PATCH",
        token,
        body: { npdStatus: "recorded" }
      });
      assert.equal(response.status, 403);
    }
  } finally {
    env.paymentProvider = originalPaymentProvider;
    env.nodeEnv = originalNodeEnv;
    env.tbankTerminalKey = originalTbankTerminalKey;
    env.tbankPassword = originalTbankPassword;
    env.tbankTerminalMode = originalTbankTerminalMode;
    globalThis.fetch = originalFetch;
    await prisma.auditLog.deleteMany({
      where: {
        actorUserId: admin.id,
        action: { in: ["admin.npd_register.update", "admin.bank_refund.create", "admin.payment.tbank_sync", "admin.payment.tbank_sync_refund", "admin.payment.tbank_sync_manual_review"] }
      }
    });
    const testRefunds = await prisma.refundTransaction.findMany({
      where: { paymentTransactionId: { in: paymentIds } },
      select: { id: true }
    });
    await prisma.refundTransaction.deleteMany({ where: { paymentTransactionId: { in: paymentIds } } });
    await prisma.paymentTransaction.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.balanceTransaction.deleteMany({
      where: {
        idempotencyKey: {
          in: [
            ...testRefunds.flatMap((refund) => [`payment_refund:${refund.id}`, `manual_bank_refund:${refund.id}`]),
            ...paymentIds.map((paymentId) => `tbank_sync_refund:${paymentId}`)
          ]
        }
      }
    });
    await prisma.balanceTransaction.deleteMany({ where: { comment: { in: orderIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [noConsentUser.id, managerUser.id] } } });
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
  const createdUserIds: string[] = [];
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
        acceptedConsentTypes: ["terms", "privacy", "personal_data_processing", "chat_rules", "payment_rules"],
        acceptedLegalDocumentTypes: requiredDocumentTypesForRegistration("client"),
        dependentDataTransferConfirmed: true
      }
    });
    assert.equal(response.status, 201);
    const createdUserId = response.payload.user.id;
    createdUserIds.push(createdUserId);
    const created = await prisma.user.findUniqueOrThrow({ where: { id: createdUserId } });
    assert.equal(created.phone, "+79224000320");
    assert.equal(created.normalizedPhone, "+79224000320");
    assert.equal(created.email, null);
    assert.equal(await prisma.userConsent.count({
      where: { userId: createdUserId, documentType: "marketing_notifications_consent" }
    }), 0);

    response = await apiRequest(app, "/api/auth/register", {
      method: "POST",
      body: {
        role: "client",
        phone: `8 922 400 03 20`,
        email: `duplicate-phone-${suffix}@zabota.local`,
        password: "password123",
        displayName: "Дубль телефона",
        cityId: client.cityId,
        acceptedConsentTypes: ["terms", "privacy", "personal_data_processing", "chat_rules", "payment_rules"],
        acceptedLegalDocumentTypes: requiredDocumentTypesForRegistration("client"),
        dependentDataTransferConfirmed: true
      }
    });
    assert.equal(response.status, 409);
    assert.equal(response.payload.error, "Пользователь с таким телефоном уже зарегистрирован");

    response = await apiRequest(app, "/api/auth/register", {
      method: "POST",
      body: {
        role: "performer",
        phone: `+7 901 ${String(suffix).slice(-7, -4)} ${String(suffix).slice(-4, -2)} ${String(suffix).slice(-2)}`,
        email: `helper-legal-${suffix}@zabota.local`,
        password: "password123",
        displayName: "Тест согласий помощника",
        cityId: client.cityId,
        acceptedConsentTypes: ["terms", "privacy", "personal_data_processing", "chat_rules", "payment_rules"],
        acceptedLegalDocumentTypes: requiredDocumentTypesForRegistration("performer"),
        helperNotEmployerAcknowledged: true,
        helperNoMedicalServicesConfirmed: true
      }
    });
    assert.equal(response.status, 201);
    createdUserIds.push(response.payload.user.id);
    assert.equal(await prisma.userConsent.count({
      where: { userId: response.payload.user.id, documentType: "marketing_notifications_consent" }
    }), 0);

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
    if (createdUserIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorUserId: { in: createdUserIds } },
            { entityType: "user", entityId: { in: createdUserIds } }
          ]
        }
      });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  }
}

async function runVkOAuthTests() {
  const app = createApp();
  const original = {
    oauthEnabled: env.oauthEnabled,
    vkIdEnabled: env.vkIdEnabled,
    clientId: env.vkIdClientId,
    clientSecret: env.vkIdClientSecret,
    redirectUri: env.vkIdRedirectUri
  };
  const originalFetch = globalThis.fetch;
  const providerUserId = `vk-test-${Date.now()}`;
  let createdUserId: string | undefined;
  let restoredPendingUserId: string | undefined;
  let unsafeArchivedUserId: string | undefined;
  try {
    const cancelWithoutSession = await rawAppRequest(app, "/api/auth/oauth/cancel", { method: "POST" });
    assert.equal(cancelWithoutSession.status, 200);
    assert.deepEqual(JSON.parse(cancelWithoutSession.text), { ok: true });
    const cancelCookies = JSON.stringify(cancelWithoutSession.headers["set-cookie"]);
    assert.match(cancelCookies, new RegExp(VK_OAUTH_TRANSACTION_COOKIE));
    assert.match(cancelCookies, new RegExp(VK_OAUTH_SESSION_COOKIE));
    assert.match(cancelCookies, /Max-Age=0/);

    env.oauthEnabled = false;
    env.vkIdEnabled = false;
    let response = await apiRequest(app, "/api/auth/oauth/vk/start", { method: "GET" });
    assert.equal(response.status, 503);

    env.oauthEnabled = true;
    env.vkIdEnabled = true;
    env.vkIdClientId = "vk-test-client";
    env.vkIdClientSecret = "vk-test-secret";
    env.vkIdRedirectUri = "http://localhost:4000/api/auth/oauth/vk/callback";

    const start = await rawAppRequest(app, "/api/auth/oauth/vk/start");
    assert.equal(start.status, 302);
    const authorizationUrl = new URL(String(start.headers.location));
    assert.equal(authorizationUrl.origin, "https://id.vk.ru");
    assert.ok(authorizationUrl.searchParams.get("state"));
    assert.ok(authorizationUrl.searchParams.get("code_challenge"));
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "s256");
    const transactionCookie = cookieHeader(start.headers["set-cookie"]);
    const state = authorizationUrl.searchParams.get("state")!;

    const invalidState = await rawAppRequest(app, "/api/auth/oauth/vk/callback?code=bad&device_id=device&state=wrong", {
      headers: { cookie: transactionCookie }
    });
    assert.equal(invalidState.status, 302);
    assert.match(String(invalidState.headers.location), /oauthError=vk/);

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://id.vk.ru/oauth2/auth")) {
        assert.match(url, /code_verifier=/);
        return new Response(JSON.stringify({ access_token: "test-access-token", user_id: providerUserId, state }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.startsWith("https://id.vk.ru/oauth2/user_info")) {
        return new Response(JSON.stringify({ user: { user_id: providerUserId, first_name: "VK", last_name: "Test" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unexpected VK test request: ${url}`);
    }) as typeof fetch;

    const callback = await rawAppRequest(app, `/api/auth/oauth/vk/callback?code=ok&device_id=device&state=${encodeURIComponent(state)}`, {
      headers: { cookie: transactionCookie }
    });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.location, "/app/oauth/complete");
    const sessionCookie = cookieHeader(callback.headers["set-cookie"], VK_OAUTH_SESSION_COOKIE);
    const session = await rawAppRequest(app, "/api/auth/oauth/session", { method: "POST", headers: { cookie: sessionCookie } });
    assert.equal(session.status, 200);
    const sessionPayload = JSON.parse(session.text);
    assert.equal(sessionPayload.user.role, "oauth_pending");
    assert.equal(sessionPayload.nextPath, "/app/oauth/complete");
    createdUserId = sessionPayload.user.id;
    assert.equal(await prisma.userIdentity.count({ where: { provider: "vk", providerUserId } }), 1);

    const city = await prisma.city.findFirstOrThrow({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
    response = await apiRequest(app, "/api/auth/oauth/complete-profile", {
      method: "POST",
      token: sessionPayload.token,
      body: {
        role: "client",
        cityId: city.id,
        phone: `+7901${String(Date.now()).slice(-7)}`,
        acceptedDocuments: requiredDocumentTypesForRegistration("client"),
        dependentDataTransferConfirmed: true
      }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.user.role, "client");
    assert.equal(response.payload.nextPath, "/app/client/requests");
    assert.equal(await isUserProfileComplete(sessionPayload.user.id), true);

    const completedIdentityCount = await prisma.userIdentity.count({ where: { userId: sessionPayload.user.id, provider: "vk" } });
    response = await apiRequest(app, "/api/auth/oauth/cancel", {
      method: "POST",
      token: sessionPayload.token
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.payload, { ok: true });
    assert.ok(await prisma.user.findUnique({ where: { id: sessionPayload.user.id } }));
    assert.equal(await prisma.userIdentity.count({ where: { userId: sessionPayload.user.id, provider: "vk" } }), completedIdentityCount);

    const repeatedIdentity = await resolveVkUser({
      providerUserId,
      profile: { user_id: providerUserId, first_name: "VK", last_name: "Updated" }
    });
    assert.equal(repeatedIdentity.user.id, createdUserId);
    assert.equal(await prisma.userIdentity.count({ where: { provider: "vk", providerUserId } }), 1);

    const demoClient = await prisma.user.findUniqueOrThrow({ where: { email: "client@zabota.local" } });
    const emailProviderUserId = `${providerUserId}-email`;
    const linkedByEmail = await resolveVkUser({
      providerUserId: emailProviderUserId,
      profile: { user_id: emailProviderUserId, email: demoClient.email ?? undefined, first_name: "Existing" }
    });
    assert.equal(linkedByEmail.user.id, demoClient.id);
    await prisma.userIdentity.delete({ where: { provider_providerUserId: { provider: "vk", providerUserId: emailProviderUserId } } });

    response = await apiRequest(app, "/api/auth/oauth/complete-profile", {
      method: "POST",
      token: sessionPayload.token,
      body: { role: "admin", cityId: city.id, phone: "+79000000099", acceptedDocuments: [] }
    });
    assert.equal(response.status, 400);
    response = await apiRequest(app, "/api/auth/oauth/complete-profile", {
      method: "POST",
      token: sessionPayload.token,
      body: { role: "manager", cityId: city.id, phone: "+79000000099", acceptedDocuments: [] }
    });
    assert.equal(response.status, 400);

    const admin = await prisma.user.findFirstOrThrow({ where: { role: { in: ["admin", "superadmin"] }, email: { not: null } } });
    await assert.rejects(
      () => resolveVkUser({
        providerUserId: `${providerUserId}-admin`,
        profile: { user_id: `${providerUserId}-admin`, email: admin.email ?? undefined, first_name: "Admin" }
      }),
      /VK ID нельзя привязать к профилю администратора/
    );

    const restoreProviderUserId = `${providerUserId}-restore`;
    const archivedPending = await prisma.user.create({
      data: {
        role: "oauth_pending",
        rolesJson: "[]",
        displayName: "Archived VK retry",
        status: "archived",
        archivedAt: new Date(),
        archivedByAdminId: admin.id,
        archiveReason: OAUTH_PENDING_CANCEL_ARCHIVE_REASON,
        identities: {
          create: {
            provider: "vk",
            providerUserId: restoreProviderUserId,
            displayName: "Archived VK retry"
          }
        }
      }
    });
    restoredPendingUserId = archivedPending.id;
    const restoreStart = await rawAppRequest(app, "/api/auth/oauth/vk/start");
    const restoreAuthorizationUrl = new URL(String(restoreStart.headers.location));
    const restoreState = restoreAuthorizationUrl.searchParams.get("state")!;
    const restoreTransactionCookie = cookieHeader(restoreStart.headers["set-cookie"]);
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://id.vk.ru/oauth2/auth")) {
        return new Response(JSON.stringify({ access_token: "restore-access-token", user_id: restoreProviderUserId, state: restoreState }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.startsWith("https://id.vk.ru/oauth2/user_info")) {
        return new Response(JSON.stringify({ user: { user_id: restoreProviderUserId, first_name: "VK", last_name: "Restored" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unexpected VK restore request: ${url}`);
    }) as typeof fetch;
    const restoreCallback = await rawAppRequest(
      app,
      `/api/auth/oauth/vk/callback?code=restore&device_id=device&state=${encodeURIComponent(restoreState)}`,
      { headers: { cookie: restoreTransactionCookie } }
    );
    assert.equal(restoreCallback.status, 302);
    assert.equal(restoreCallback.headers.location, "/app/oauth/complete");
    const restoredUser = await prisma.user.findUniqueOrThrow({ where: { id: archivedPending.id } });
    assert.equal(restoredUser.status, "active");
    assert.equal(restoredUser.role, "oauth_pending");
    assert.equal(restoredUser.archiveReason, null);
    const restoreSessionCookie = cookieHeader(restoreCallback.headers["set-cookie"], VK_OAUTH_SESSION_COOKIE);
    const restoreSession = await rawAppRequest(app, "/api/auth/oauth/session", {
      method: "POST",
      headers: { cookie: restoreSessionCookie }
    });
    assert.equal(restoreSession.status, 200);
    assert.equal(JSON.parse(restoreSession.text).nextPath, "/app/oauth/complete");
    const callbackRestoreAudit = await prisma.auditLog.findFirst({
      where: { action: "auth.oauth_pending.restore_for_retry", entityId: archivedPending.id }
    });
    assert.ok(callbackRestoreAudit);
    const callbackRestoreMetadata = JSON.parse(callbackRestoreAudit.payloadJson ?? "{}");
    assert.equal(callbackRestoreMetadata.provider, "vk");
    assert.equal(callbackRestoreMetadata.providerUserId, restoreProviderUserId);
    assert.equal(callbackRestoreMetadata.source, "vk_callback");

    const unsafeProviderUserId = `${providerUserId}-unsafe-restore`;
    const unsafeArchived = await prisma.user.create({
      data: {
        role: "oauth_pending",
        rolesJson: "[]",
        displayName: "Archived VK with payment",
        status: "archived",
        archivedAt: new Date(),
        archiveReason: OAUTH_PENDING_CANCEL_ARCHIVE_REASON,
        identities: {
          create: { provider: "vk", providerUserId: unsafeProviderUserId, displayName: "Archived VK with payment" }
        },
        paymentTransactions: {
          create: { provider: "mock", orderId: `VK-UNSAFE-${Date.now()}`, amount: 150, status: "failed" }
        }
      }
    });
    unsafeArchivedUserId = unsafeArchived.id;
    const unsafeStart = await rawAppRequest(app, "/api/auth/oauth/vk/start");
    const unsafeAuthorizationUrl = new URL(String(unsafeStart.headers.location));
    const unsafeState = unsafeAuthorizationUrl.searchParams.get("state")!;
    const unsafeTransactionCookie = cookieHeader(unsafeStart.headers["set-cookie"]);
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://id.vk.ru/oauth2/auth")) {
        return new Response(JSON.stringify({ access_token: "unsafe-access-token", user_id: unsafeProviderUserId, state: unsafeState }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.startsWith("https://id.vk.ru/oauth2/user_info")) {
        return new Response(JSON.stringify({ user: { user_id: unsafeProviderUserId, first_name: "Unsafe" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unexpected unsafe VK request: ${url}`);
    }) as typeof fetch;
    const unsafeCallback = await rawAppRequest(
      app,
      `/api/auth/oauth/vk/callback?code=unsafe&device_id=device&state=${encodeURIComponent(unsafeState)}`,
      { headers: { cookie: unsafeTransactionCookie } }
    );
    assert.equal(unsafeCallback.status, 302);
    assert.match(String(unsafeCallback.headers.location), /oauthReason=archived-not-restorable/);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: unsafeArchived.id } })).status, "archived");
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(env, {
      oauthEnabled: original.oauthEnabled,
      vkIdEnabled: original.vkIdEnabled,
      vkIdClientId: original.clientId,
      vkIdClientSecret: original.clientSecret,
      vkIdRedirectUri: original.redirectUri
    });
    if (createdUserId) {
      await prisma.auditLog.deleteMany({ where: { actorUserId: createdUserId } });
      await prisma.user.delete({ where: { id: createdUserId } }).catch(() => undefined);
    }
    if (restoredPendingUserId) {
      await prisma.auditLog.deleteMany({
        where: { OR: [{ actorUserId: restoredPendingUserId }, { entityId: restoredPendingUserId }] }
      });
      await prisma.user.delete({ where: { id: restoredPendingUserId } }).catch(() => undefined);
    }
    if (unsafeArchivedUserId) {
      await prisma.paymentTransaction.deleteMany({ where: { userId: unsafeArchivedUserId } });
      await prisma.user.delete({ where: { id: unsafeArchivedUserId } }).catch(() => undefined);
    }
  }
}

function cookieHeader(setCookie: unknown, cookieName?: string) {
  const values = Array.isArray(setCookie) ? setCookie.map(String) : [String(setCookie ?? "")];
  const value = cookieName
    ? values.find((item) => item.startsWith(`${cookieName}=`)) ?? ""
    : values[0] ?? "";
  assert.ok(value, "Expected Set-Cookie header");
  return value.split(";")[0]!;
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
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
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
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
) {
  const method = options.method ?? "GET";
  const bodyText = options.body === undefined ? "" : JSON.stringify(options.body);
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
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
