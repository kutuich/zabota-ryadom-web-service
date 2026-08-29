import path from "node:path";
import { hashPassword } from "../src/services/passwordService";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import type { City, ServiceCategory, User } from "@prisma/client";
import { buildFullAddress, buildPublicAddress, buildYandexExactMapAddress, buildYandexPublicMapAddress, normalizeAddressParts } from "../src/services/addressService";
import { acceptLatestLegalDocuments, requiredDocumentTypesForRegistration, seedLegalDocuments } from "../src/services/legalService";
import { normalizeRussianPhone } from "../src/services/phoneService";
import { CITY_DIRECTORY } from "../src/services/cityDirectory";
import { ensureSettlementDirectory } from "../src/services/settlementService";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.preview") });

const prisma = new PrismaClient();
const password = "password123";
const baseEmails = ["admin@zabota.local", "client@zabota.local", "performer@zabota.local", "performer2@zabota.local"];

type DemoUsers = {
  admin: User;
  client: User;
  performer: User;
  performer2: User;
};

export async function seedDemoDatabase({ reset }: { reset: boolean }) {
  await cleanupDemoData(reset);

  const passwordHash = await hashPassword(password);
  const { yugorsk, sovetsky } = await seedCities();
  const categories = await seedCategories();
  const users = await seedUsers(passwordHash, yugorsk.id);
  await seedLegalDocuments(prisma, users.admin.id);
  await seedDemoLegalConsents(users);
  await seedProfiles(users, categories);
  await seedSettings();
  await seedKnowledgeBase();
  await seedPerformerDocuments(users.performer.id);
  await seedScenarios(users, yugorsk, sovetsky, categories);
  await backfillNormalizedPhones();
  await ensureSettlementDirectory();

  const counts = await collectCounts(reset);
  console.log(reset ? "Demo database reset completed" : "Demo seed completed");
  if (process.env.SEED_DEMO_DATA === "true" && (process.env.NODE_ENV !== "production" || process.env.DEMO_MODE === "true")) {
    console.table([
      { role: users.admin.role, email: users.admin.email, password },
      { role: users.client.role, email: users.client.email, password },
      { role: users.performer.role, email: users.performer.email, password },
      { role: users.performer2.role, email: users.performer2.email, password }
    ]);
  }
  console.table([counts]);
  return counts;
}

async function cleanupDemoData(reset: boolean) {
  if (reset) {
    await prisma.chatMessage.deleteMany();
    await prisma.complaint.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.balanceTransaction.deleteMany();
    await prisma.review.deleteMany();
    await prisma.userRiskFlag.deleteMany();
    await prisma.consent.deleteMany();
    await prisma.userConsent.deleteMany();
    await prisma.userConsentAuditLog.deleteMany();
    await prisma.consentExportLog.deleteMany();
    await prisma.chat.deleteMany();
    await prisma.requestResponse.deleteMany();
    await prisma.clientRequest.deleteMany();
    await prisma.performerDocument.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.knowledgeArticle.deleteMany();
    await prisma.clientProfile.deleteMany();
    await prisma.performerProfile.deleteMany();
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: null },
          { email: { notIn: baseEmails } }
        ]
      }
    });
    return;
  }

  const demoRequests = await prisma.clientRequest.findMany({
    where: { seedKey: { startsWith: "demo:" } },
    select: { id: true }
  });
  const requestIds = demoRequests.map((request) => request.id);
  const demoChats = requestIds.length
    ? await prisma.chat.findMany({ where: { requestId: { in: requestIds } }, select: { id: true } })
    : [];
  const chatIds = demoChats.map((chat) => chat.id);

  if (chatIds.length) await prisma.chatMessage.deleteMany({ where: { chatId: { in: chatIds } } });
  await prisma.complaint.deleteMany({
    where: {
      OR: [
        ...(requestIds.length ? [{ requestId: { in: requestIds } }] : []),
        { publicNumber: { startsWith: "SUP-DEMO-" } }
      ]
    }
  });
  if (requestIds.length) {
    await prisma.balanceTransaction.deleteMany({ where: { relatedRequestId: { in: requestIds } } });
    await prisma.review.deleteMany({ where: { requestId: { in: requestIds } } });
    await prisma.chat.deleteMany({ where: { requestId: { in: requestIds } } });
    await prisma.requestResponse.deleteMany({ where: { requestId: { in: requestIds } } });
    await prisma.clientRequest.deleteMany({ where: { id: { in: requestIds } } });
  }
  await prisma.balanceTransaction.deleteMany({ where: { comment: { contains: "demo seed" } } });
  await prisma.auditLog.deleteMany({ where: { action: { startsWith: "demo." } } });
  await prisma.performerDocument.deleteMany({ where: { fileName: { contains: "demo" } } });
  await seedLegalDocuments(prisma);
}

async function seedCities() {
  for (const city of CITY_DIRECTORY) {
    await prisma.city.upsert({
      where: { slug: city.slug },
      update: { ...city, status: "inactive" },
      create: { ...city, status: "inactive", defaultCommissionAmount: 50, minTopUpAmount: 150 }
    });
  }
  const yugorsk = await prisma.city.upsert({
    where: { slug: "yugorsk" },
    update: {
      name: "Югорск",
      region: "ХМАО - Югра",
      status: "active",
      isActive: true,
      defaultCommissionAmount: 50,
      minTopUpAmount: 150,
      timezone: "Asia/Yekaterinburg",
      pricingZone: "base_yugorsk",
      sortOrder: 10,
      mapCenterLat: 61.3133,
      mapCenterLng: 63.3319,
      mapDefaultRadiusMeters: 600,
      districtsJson: JSON.stringify(["Центр", "Южный", "Северный"])
    },
    create: {
      name: "Югорск",
      slug: "yugorsk",
      region: "ХМАО - Югра",
      status: "active",
      isActive: true,
      defaultCommissionAmount: 50,
      minTopUpAmount: 150,
      timezone: "Asia/Yekaterinburg",
      pricingZone: "base_yugorsk",
      sortOrder: 10,
      mapCenterLat: 61.3133,
      mapCenterLng: 63.3319,
      mapDefaultRadiusMeters: 600,
      districtsJson: JSON.stringify(["Центр", "Южный", "Северный"])
    }
  });

  const sovetsky = await prisma.city.upsert({
    where: { slug: "sovetsky" },
    update: {
      name: "Советский",
      region: "ХМАО - Югра",
      status: "active",
      isActive: true,
      defaultCommissionAmount: 50,
      minTopUpAmount: 150,
      timezone: "Asia/Yekaterinburg",
      pricingZone: "base_sovetsky",
      sortOrder: 20,
      mapCenterLat: 61.3614,
      mapCenterLng: 63.5842,
      mapDefaultRadiusMeters: 600,
      districtsJson: JSON.stringify(["Советский", "Западный", "Восточный"])
    },
    create: {
      name: "Советский",
      slug: "sovetsky",
      region: "ХМАО - Югра",
      status: "active",
      isActive: true,
      defaultCommissionAmount: 50,
      minTopUpAmount: 150,
      timezone: "Asia/Yekaterinburg",
      pricingZone: "base_sovetsky",
      sortOrder: 20,
      mapCenterLat: 61.3614,
      mapCenterLng: 63.5842,
      mapDefaultRadiusMeters: 600,
      districtsJson: JSON.stringify(["Советский", "Западный", "Восточный"])
    }
  });

  await Promise.all([
    upsertCity("ekaterinburg", "Екатеринбург", "Свердловская область", "Asia/Yekaterinburg", "future_large_city", 30, 56.8389, 60.6057, ["Центр", "Уралмаш", "Академический"]),
    upsertCity("saint_petersburg", "Санкт-Петербург", "Санкт-Петербург", "Europe/Moscow", "future_large_city", 40, 59.9386, 30.3141, ["Центр", "Петроградская сторона", "Московский район"]),
    upsertCity("moscow", "Москва", "Москва", "Europe/Moscow", "future_large_city", 50, 55.7558, 37.6173, ["Центр", "Север", "Юг", "Запад", "Восток"]),
    upsertCity("tyumen", "Тюмень", "Тюменская область", "Asia/Yekaterinburg", "future_large_city", 60, 57.1522, 65.5272, ["Центр", "Восточный", "Заречный"]),
    upsertCity("volgograd", "Волгоград", "Волгоградская область", "Europe/Volgograd", "future_large_city", 70, 48.708, 44.5133, ["Центр", "Краснооктябрьский", "Советский"]),
    upsertCity("nizhny_novgorod", "Нижний Новгород", "Нижегородская область", "Europe/Moscow", "future_large_city", 80, 56.3269, 44.0059, ["Центр", "Автозаводский", "Сормовский"])
  ]);

  return { yugorsk, sovetsky };
}

async function seedCategories() {
  const rows = [
    category("companionship", "Присмотр и общение", 500, 10, ["побыть рядом", "общение"], ["медицинские процедуры"]),
    category("home-help", "Помощь по дому", 950, 20, ["лёгкая уборка", "стирка", "смена постельного"], ["генеральная уборка после ремонта"]),
    category("cooking", "Приготовление еды", 850, 30, ["простая домашняя еда", "посуда после готовки"], ["лечебное питание как медицинская услуга"]),
    category("escort", "Сопровождение", 600, 40, ["магазин", "аптека", "поликлиника без медицинских услуг"], ["медицинское сопровождение"]),
    category("elderly-care", "Сиделка для пожилого человека", 1200, 50, ["присмотр", "помощь с едой"], ["медицинские процедуры"]),
    category("limited-mobility-care", "Уход за маломобильным человеком", 1450, 60, ["помощь с перемещением", "бытовая гигиена"], ["инъекции", "перевязки"]),
    category("childcare", "Няня для ребёнка / няня для малышей", 650, 70, ["присмотр", "игры"], ["медицинский уход"], true),
    category("delivery-errands", "Доставка / закупки / поручения", 500, 80, ["купить продукты рядом", "аптека без консультаций"], ["крупные финансовые операции"]),
    category("walks", "Прогулки", 650, 90, ["прогулка рядом", "безопасный маршрут"], ["реабилитационные упражнения"]),
    category("small-household-tasks", "Мелкие бытовые задачи", 650, 100, ["вынести мусор", "простая бытовая помощь"], ["опасные работы"])
  ];

  const records = await Promise.all(rows.map((row) =>
    prisma.serviceCategory.upsert({
      where: { slug: row.slug },
      update: row,
      create: row
    })
  ));
  return Object.fromEntries(records.map((record) => [record.slug, record])) as Record<string, ServiceCategory>;
}

function category(slug: string, name: string, basePrice: number, sortOrder: number, included: string[], excluded: string[], isChildcare = false) {
  return {
    slug,
    name,
    description: `${name}: демо-категория для проверки кабинетов.`,
    includedJson: JSON.stringify(included),
    excludedJson: JSON.stringify(excluded),
    complexityJson: JSON.stringify({ simple: "простая", standard: "стандартная", complex: "сложная" }),
    transferRules: "Если объём изменился, согласуйте условия в чате до начала визита.",
    medicalProhibitions: "Медицинские процедуры запрещены.",
    clientInstructions: "Опишите условия заявки и дождитесь откликов помощников.",
    performerInstructions: "Проверьте объём работ, адресные условия и ограничения до подтверждения визита.",
    pricingRulesJson: JSON.stringify({ demo: true }),
    basePrice,
    calculationUnit: isChildcare ? "hour" : "visit",
    minDurationHours: isChildcare ? 2 : 1,
    sortOrder,
    isActive: true,
    isChildcare,
    requiresCriminalRecord: isChildcare
  };
}

async function seedUsers(passwordHash: string, cityId: string): Promise<DemoUsers> {
  const admin = await upsertUser({
    role: "superadmin",
    email: "admin@zabota.local",
    phone: "+79000000001",
    displayName: "Администратор",
    cityId,
    passwordHash,
    balance: 0,
    bonusBalance: 0
  });
  const client = await upsertUser({
    role: "client",
    email: "client@zabota.local",
    phone: "+79000000002",
    displayName: "Заказчик",
    cityId,
    passwordHash,
    balance: 300,
    bonusBalance: 100
  });
  const performer = await upsertUser({
    role: "performer",
    email: "performer@zabota.local",
    phone: "+79000000003",
    displayName: "Помощник",
    cityId,
    passwordHash,
    balance: 300,
    bonusBalance: 50
  });
  const performer2 = await upsertUser({
    role: "performer",
    email: "performer2@zabota.local",
    phone: "+79000000004",
    displayName: "Помощник 2",
    cityId,
    passwordHash,
    balance: 180,
    bonusBalance: 150
  });
  return { admin, client, performer, performer2 };
}

async function upsertUser(input: {
  role: string;
  email: string;
  phone: string;
  displayName: string;
  cityId: string;
  passwordHash: string;
  balance: number;
  bonusBalance: number;
}) {
  const normalizedPhone = normalizeRussianPhone(input.phone);
  const verifiedAt = new Date();
  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      role: input.role,
      rolesJson: JSON.stringify([input.role]),
      phone: normalizedPhone,
      normalizedPhone,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      cityId: input.cityId,
      status: "active",
      balance: input.balance,
      bonusBalance: input.bonusBalance,
      isPhoneVerified: true,
      isEmailVerified: true,
      phoneVerifiedAt: verifiedAt,
      emailVerifiedAt: verifiedAt,
      blockedAt: null,
      blockReason: null,
      archivedAt: null,
      lastSeenAt: new Date()
    },
    create: {
      role: input.role,
      rolesJson: JSON.stringify([input.role]),
      email: input.email,
      phone: normalizedPhone,
      normalizedPhone,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      cityId: input.cityId,
      status: "active",
      balance: input.balance,
      bonusBalance: input.bonusBalance,
      isPhoneVerified: true,
      isEmailVerified: true,
      phoneVerifiedAt: verifiedAt,
      emailVerifiedAt: verifiedAt,
      lastSeenAt: new Date()
    }
  });
}

async function backfillNormalizedPhones() {
  const users = await prisma.user.findMany({
    where: { normalizedPhone: null },
    select: { id: true, phone: true }
  });
  for (const user of users) {
    if (!user.phone) {
      console.warn(`Cannot normalize phone for user ${user.id}: phone is empty`);
      continue;
    }
    try {
      const normalizedPhone = normalizeRussianPhone(user.phone);
      await prisma.user.update({
        where: { id: user.id },
        data: { phone: normalizedPhone, normalizedPhone }
      });
    } catch (error) {
      console.warn(`Cannot normalize phone for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function seedDemoLegalConsents(users: DemoUsers) {
  await acceptLatestLegalDocuments({
    userId: users.client.id,
    documentTypes: [...requiredDocumentTypesForRegistration("client"), "marketing_notifications_consent"],
    source: "demo_seed",
    client: prisma
  });
  for (const user of [users.performer, users.performer2]) {
    await acceptLatestLegalDocuments({
      userId: user.id,
      documentTypes: [...requiredDocumentTypesForRegistration("performer"), "helper_documents_consent", "marketing_notifications_consent"],
      source: "demo_seed",
      client: prisma
    });
  }
}

async function seedProfiles(users: DemoUsers, categories: Record<string, ServiceCategory>) {
  await prisma.clientProfile.upsert({
    where: { userId: users.client.id },
    update: {
      fullName: "Заказчик",
      preferredContactMethod: "chat",
      rating: 4.8,
      completedRequestsCount: 2,
      complaintsCount: 1
    },
    create: {
      userId: users.client.id,
      fullName: "Заказчик",
      preferredContactMethod: "chat",
      rating: 4.8,
      completedRequestsCount: 2,
      complaintsCount: 1
    }
  });

  await prisma.performerProfile.upsert({
    where: { userId: users.performer.id },
    update: performerProfileData(categories),
    create: {
      userId: users.performer.id,
      ...performerProfileData(categories)
    }
  });

  await prisma.performerProfile.upsert({
    where: { userId: users.performer2.id },
    update: performerProfileData(categories, {
      readyForHygieneHelp: false,
      readyForLimitedMobility: false,
      readyForChildren: false,
      rating: 4.4,
      completedJobsCount: 3,
      profileComment: "Готов к лёгким бытовым задачам, доставке и поручениям."
    }),
    create: {
      userId: users.performer2.id,
      ...performerProfileData(categories, {
        readyForHygieneHelp: false,
        readyForLimitedMobility: false,
        readyForChildren: false,
        rating: 4.4,
        completedJobsCount: 3,
        profileComment: "Готов к лёгким бытовым задачам, доставке и поручениям."
      })
    }
  });
}

function performerProfileData(categories: Record<string, ServiceCategory>, overrides: Partial<ReturnType<typeof performerProfileDataBase>> = {}) {
  return { ...performerProfileDataBase(categories), ...overrides };
}

function performerProfileDataBase(categories: Record<string, ServiceCategory>) {
  return {
    age: 39,
    about: "Аккуратная бытовая помощь и сопровождение.",
    experience: "3 года помощи пожилым людям и семьям.",
    services: JSON.stringify([
      categories["home-help"].name,
      categories.escort.name,
      categories.cooking.name,
      categories.companionship.name
    ]),
    skills: JSON.stringify(["уборка", "простая готовка", "сопровождение", "спокойное общение"]),
    districts: JSON.stringify(["Центр", "Южный"]),
    canTravelIndependently: true,
    canTravelOutsideCity: false,
    readyForHygieneHelp: false,
    readyForPhysicalHelp: true,
    readyForLimitedMobility: true,
    readyForChildren: true,
    readyForUrgentRequests: false,
    readyToProvideDocuments: true,
    selfEmployedStatus: "self_employed_provided",
    criminalRecordCertificateStatus: "criminal_record_uploaded",
    verificationStatuses: JSON.stringify(["phone_verified", "profile_completed", "self_employed_provided", "criminal_record_uploaded"]),
    childcareApprovalStatus: "missing_criminal_record",
    trustLevel: "profile_completed",
    rating: 4.7,
    completedJobsCount: 8,
    complaintsCount: 0,
    isAvailable: true,
    profileComment: "Готов к бытовым заявкам, сопровождению и присмотру без медицинских процедур."
  };
}

async function seedSettings() {
  const settings = [
    ["clientServiceFeeAmount", 50, "Сервисный сбор заказчика, ₽", "payments"],
    ["performerServiceFeeAmount", 50, "Сервисный сбор помощника, ₽", "payments"],
    ["performerCommissionAmount", 50, "Сервисный сбор помощника, ₽", "payments"],
    ["serviceCommissionAmount", 50, "Устаревший ключ совместимости: сервисный сбор", "payments"],
    ["minTopUpAmount", 150, "Минимальное пополнение, ₽", "payments"],
    ["useBonusForCommission", true, "Бонусный баланс", "payments"],
    ["chargeBonusFirst", true, "Сначала списывать бонусы", "payments"],
    ["mapPrivacyRadiusMeters", 600, "Радиус скрытия адреса", "privacy"],
    ["archiveAfterDays", 90, "Срок архивирования", "archive"],
    ["filterPhones", true, "Фильтр телефонов", "moderation"],
    ["filterLinks", true, "Фильтр ссылок", "moderation"],
    ["filterBankCards", true, "Фильтр банковских карт", "moderation"],
    ["filterAdultContent", true, "Фильтр 18+", "moderation"],
    ["filterProfanity", true, "Фильтр грубой лексики", "moderation"],
    ["chatWarningText", "Не передавайте телефон, ссылки, данные банковских карт и коды из SMS. Общение по заявке ведётся внутри сервиса.", "Текст предупреждения о контактах", "moderation"]
  ] as const;

  await Promise.all(settings.map(([key, value, label, group]) =>
    prisma.serviceSetting.upsert({
      where: { key },
      update: { valueJson: JSON.stringify(value), label, group },
      create: { key, valueJson: JSON.stringify(value), label, group }
    })
  ));
}

async function seedKnowledgeBase() {
  const articles = [
    ["all", "Как работает сервис", "demo-how-service-works", "Заказчик создаёт заявку, помощник откликается, стороны обсуждают условия в чате по заявке.", "Старт"],
    ["client", "Как создать заявку", "demo-how-create-request", "Заполните город, категорию, дату, время, длительность и описание помощи.", "Заказчикам"],
    ["client", "Как выбрать помощника", "demo-how-choose-performer", "Сравните отклики, рейтинг и статусы проверок помощника.", "Заказчикам"],
    ["all", "Как работает сервисный сбор", "demo-service-fee", "Сервисный сбор заказчика и сервисный сбор помощника списываются только после двойного подтверждения условий.", "Оплата"],
    ["all", "Почему телефон не раскрывается сразу", "demo-phone-hidden", "Контакты скрыты для безопасности, общение ведётся внутри сервиса.", "Безопасность"],
    ["all", "Какие услуги запрещены", "demo-forbidden-services", "Запрещены медицинские услуги: инъекции, капельницы, перевязки, лечение, диагностика и назначение лекарств.", "Правила"],
    ["all", "Почему медицинские услуги запрещены", "demo-why-medical-forbidden", "Сервис не является медицинской организацией и оказывает только бытовую помощь.", "Правила"],
    ["all", "Как обратиться к администратору", "demo-contact-admin", "Откройте раздел «Обращения» в своём кабинете и отправьте сообщение.", "Поддержка"],
    ["all", "Что делать, если заявка сорвалась", "demo-request-failed", "Напишите администратору. История заявки и чата сохранится для разбора.", "Поддержка"]
  ] as const;

  await Promise.all(articles.map(([audience, title, slug, content, category], index) =>
    prisma.knowledgeArticle.upsert({
      where: { slug },
      update: { audience, title, content, category, isPublished: true, sortOrder: index * 10 + 10 },
      create: { audience, title, slug, content, category, isPublished: true, sortOrder: index * 10 + 10 }
    })
  ));
}

async function seedPerformerDocuments(performerId: string) {
  await prisma.performerDocument.deleteMany({ where: { performerId } });
  await prisma.performerDocument.createMany({
    data: [
      {
        performerId,
        type: "self_employed",
        fileName: "demo-self-employed.pdf",
        fileUrl: "/uploads/demo-self-employed.pdf",
        status: "uploaded",
        uploadedAt: new Date("2026-07-10T09:00:00.000Z")
      },
      {
        performerId,
        type: "criminal_record",
        fileName: "demo-criminal-record.pdf",
        fileUrl: "/uploads/demo-criminal-record.pdf",
        status: "uploaded",
        uploadedAt: new Date("2026-07-11T09:00:00.000Z")
      }
    ]
  });
}

async function seedScenarios(users: DemoUsers, yugorsk: City, sovetsky: City, categories: Record<string, ServiceCategory>) {
  const requests = await Promise.all([
    createRequest(users.client, yugorsk, categories["home-help"], {
      seedKey: "demo:published-no-responses",
      publicNumber: "ZR-2026-1001",
      title: "Помощь с уборкой и приготовлением еды",
      status: "waiting_for_responses",
      date: "2026-07-24",
      timeFrom: "10:00",
      timeTo: "12:00",
      payment: 950,
      packageName: "Бытовая помощь 2 часа",
      hasElderlyPerson: true,
      needsCooking: true,
      needsCleaning: true
    }),
    createRequest(users.client, yugorsk, categories.escort, {
      seedKey: "demo:with-response",
      publicNumber: "ZR-2026-1002",
      title: "Сопровождение в поликлинику",
      status: "has_responses",
      date: "2026-07-25",
      timeFrom: "09:30",
      timeTo: "11:30",
      payment: 600,
      packageName: "Обычное сопровождение"
    }),
    createRequest(users.client, yugorsk, categories.companionship, {
      seedKey: "demo:open-chat",
      publicNumber: "ZR-2026-1003",
      title: "Присмотр и общение на несколько часов",
      status: "discussion",
      date: "2026-07-26",
      timeFrom: "14:00",
      timeTo: "16:00",
      payment: 600,
      packageName: "Присмотр 2 часа",
      hasElderlyPerson: true
    }),
    createRequest(users.client, yugorsk, categories["home-help"], {
      seedKey: "demo:waiting-client-confirmation",
      publicNumber: "ZR-2026-1004",
      title: "Бытовая помощь после обеда",
      status: "waiting_client_confirmation",
      date: "2026-07-27",
      timeFrom: "13:00",
      timeTo: "15:00",
      payment: 950,
      packageName: "Бытовая помощь 2 часа",
      needsCleaning: true
    }),
    createRequest(users.client, yugorsk, categories.cooking, {
      seedKey: "demo:waiting-performer-confirmation",
      publicNumber: "ZR-2026-1005",
      title: "Приготовление простой домашней еды",
      status: "waiting_performer_confirmation",
      date: "2026-07-28",
      timeFrom: "11:00",
      timeTo: "13:00",
      payment: 850,
      packageName: "Бытовая помощь 2 часа",
      needsCooking: true
    }),
    createRequest(users.client, yugorsk, categories["home-help"], {
      seedKey: "demo:in-work",
      publicNumber: "ZR-2026-1006",
      title: "Помощь по дому в работе",
      status: "in_progress",
      date: "2026-07-29",
      timeFrom: "12:00",
      timeTo: "14:00",
      payment: 950,
      packageName: "Бытовая помощь 2 часа",
      selectedPerformerId: users.performer.id,
      needsCleaning: true
    }),
    createRequest(users.client, yugorsk, categories.escort, {
      seedKey: "demo:completed-review",
      publicNumber: "ZR-2026-1007",
      title: "Завершённое сопровождение",
      status: "completed",
      date: "2026-07-20",
      timeFrom: "10:00",
      timeTo: "12:00",
      payment: 600,
      packageName: "Обычное сопровождение",
      selectedPerformerId: users.performer.id,
      completedAt: new Date("2026-07-20T12:10:00.000Z")
    }),
    createRequest(users.client, yugorsk, categories.companionship, {
      seedKey: "demo:not-agreed-archived-chat",
      publicNumber: "ZR-2026-1008",
      title: "Не согласованный присмотр",
      status: "waiting_for_responses",
      date: "2026-07-30",
      timeFrom: "16:00",
      timeTo: "18:00",
      payment: 600,
      packageName: "Присмотр 2 часа",
      hasElderlyPerson: true
    }),
    createRequest(users.client, yugorsk, categories["limited-mobility-care"], {
      seedKey: "demo:not-fit-hygiene",
      publicNumber: "ZR-2026-1009",
      title: "Уход за маломобильным человеком",
      status: "waiting_for_responses",
      date: "2026-07-31",
      timeFrom: "09:00",
      timeTo: "12:00",
      payment: 1450,
      packageName: "Уход маломобильного",
      hasLimitedMobility: true,
      needsHygieneHelp: true
    }),
    createRequest(users.client, yugorsk, categories.childcare, {
      seedKey: "demo:childcare-requires-certificate",
      publicNumber: "ZR-2026-1010",
      title: "Няня для ребёнка на вечер",
      status: "waiting_for_responses",
      date: "2026-08-01",
      timeFrom: "18:00",
      timeTo: "21:00",
      payment: 1950,
      packageName: "Няня для ребёнка / Няня для малышей",
      hasChild: true,
      dependentAge: 5
    }),
    createRequest(users.client, sovetsky, categories["delivery-errands"], {
      seedKey: "demo:different-city",
      publicNumber: "ZR-2026-1011",
      title: "Закупка продуктов в другом городе",
      status: "waiting_for_responses",
      date: "2026-08-02",
      timeFrom: "12:00",
      timeTo: "13:00",
      payment: 500,
      packageName: "Короткая помощь"
    })
  ]);

  const byKey = Object.fromEntries(requests.map((request) => [request.seedKey!, request]));
  await createResponseAndMaybeChat(byKey["demo:with-response"], users, "pending");
  await createResponseAndMaybeChat(byKey["demo:open-chat"], users, "discussion_response", "open");
  await createResponseAndMaybeChat(byKey["demo:waiting-client-confirmation"], users, "discussion_response", "waiting_client_confirmation", {
    performerConfirmedAt: new Date("2026-07-17T09:00:00.000Z")
  });
  await createResponseAndMaybeChat(byKey["demo:waiting-performer-confirmation"], users, "discussion_response", "waiting_performer_confirmation", {
    clientConfirmedAt: new Date("2026-07-17T10:00:00.000Z")
  });
  await createResponseAndMaybeChat(byKey["demo:in-work"], users, "accepted_by_client", "in_work", {
    clientConfirmedAt: new Date("2026-07-17T11:00:00.000Z"),
    performerConfirmedAt: new Date("2026-07-17T11:10:00.000Z")
  });
  await createResponseAndMaybeChat(byKey["demo:completed-review"], users, "accepted_by_client", "completed", {
    clientConfirmedAt: new Date("2026-07-20T09:00:00.000Z"),
    performerConfirmedAt: new Date("2026-07-20T09:05:00.000Z"),
    closedAt: new Date("2026-07-20T12:10:00.000Z"),
    archivedAt: new Date("2026-07-20T12:10:00.000Z")
  });
  await createResponseAndMaybeChat(byKey["demo:not-agreed-archived-chat"], users, "not_agreed", "not_agreed", {
    notAgreedAt: new Date("2026-07-17T12:00:00.000Z"),
    archivedAt: new Date("2026-07-17T12:00:00.000Z")
  });

  const flaggedChat = await prisma.chat.findFirst({ where: { requestId: byKey["demo:open-chat"].id } });
  await prisma.complaint.create({
    data: {
      publicNumber: "SUP-DEMO-2026-0001",
      type: "complaint",
      requestId: byKey["demo:open-chat"].id,
      chatId: flaggedChat?.id,
      fromUserId: users.client.id,
      againstUserId: users.performer.id,
      reason: "Проверка обращения к администратору",
      description: "Демо-обращение для визуального аудита.",
      status: "in_review",
      adminComment: "Принято в работу",
      adminResponse: "Администратор проверяет ситуацию."
    }
  });

  await seedTransactions(users, byKey["demo:in-work"].id);
  await prisma.auditLog.createMany({
    data: [
      { actorUserId: users.admin.id, action: "demo.seed_completed", entityType: "system", payloadJson: JSON.stringify({ resettable: true }) },
      { actorUserId: users.client.id, action: "demo.request_view", entityType: "request", entityId: byKey["demo:open-chat"].id },
      { actorUserId: users.performer.id, action: "demo.chat_view", entityType: "chat", entityId: flaggedChat?.id }
    ]
  });
}

async function createRequest(
  client: User,
  city: City,
  category: ServiceCategory,
  options: {
    seedKey: string;
    publicNumber: string;
    title: string;
    status: string;
    date: string;
    timeFrom: string;
    timeTo: string;
    payment: number;
    packageName: string;
    selectedPerformerId?: string;
    completedAt?: Date;
    hasElderlyPerson?: boolean;
    hasChild?: boolean;
    hasLimitedMobility?: boolean;
    needsCooking?: boolean;
    needsCleaning?: boolean;
    needsHygieneHelp?: boolean;
    dependentAge?: number;
  }
) {
  const address = demoAddress(city, "ул. Мира", "10", {
    apartment: "15",
    entrance: "2",
    floor: "3",
    intercom: "15",
    addressComment: "вход со двора"
  });
  return prisma.clientRequest.create({
    data: {
      seedKey: options.seedKey,
      publicNumber: options.publicNumber,
      clientId: client.id,
      cityId: city.id,
      categoryId: category.id,
      contactName: client.displayName,
      contactPhone: client.phone,
      helpFor: options.hasChild ? "child" : options.hasLimitedMobility ? "limited_mobility" : options.hasElderlyPerson ? "elderly" : "home_family",
      additionalActionsJson: JSON.stringify(["light_cleaning", options.needsCooking ? "simple_cooking" : ""].filter(Boolean)),
      dependentStateJson: JSON.stringify([options.hasLimitedMobility ? "limited_mobility" : "", options.needsHygieneHelp ? "hygiene_help" : ""].filter(Boolean)),
      dependentAge: options.dependentAge ?? (options.hasElderlyPerson ? 74 : undefined),
      scheduleType: "once",
      title: options.title,
      description: `${options.title}. Нужно согласовать точный объём работ, длительность и условия визита. Медицинские процедуры не входят.`,
      addressText: address.fullAddress,
      approximateAddressText: address.publicAddress,
      addressCity: address.addressCity,
      addressStreet: address.addressStreet,
      addressHouse: address.addressHouse,
      addressApartment: address.addressApartment,
      addressEntrance: address.addressEntrance,
      addressFloor: address.addressFloor,
      addressIntercom: address.addressIntercom,
      addressComment: address.addressComment,
      fullAddress: address.fullAddress,
      publicAddress: address.publicAddress,
      yandexPublicMapAddress: address.yandexPublicMapAddress,
      yandexExactMapAddress: address.yandexExactMapAddress,
      district: city.slug === "yugorsk" ? "Центр" : "Советский",
      date: new Date(`${options.date}T00:00:00.000Z`),
      timeFrom: options.timeFrom,
      timeTo: options.timeTo,
      expectedDurationHours: Math.max(1, Number(options.timeTo.slice(0, 2)) - Number(options.timeFrom.slice(0, 2))),
      hasElderlyPerson: Boolean(options.hasElderlyPerson),
      hasChild: Boolean(options.hasChild),
      hasLimitedMobility: Boolean(options.hasLimitedMobility),
      needsCooking: Boolean(options.needsCooking),
      needsCleaning: Boolean(options.needsCleaning),
      needsHygieneHelp: Boolean(options.needsHygieneHelp),
      budgetAmount: options.payment,
      priceEstimateAmount: options.payment,
      pricingBreakdownJson: JSON.stringify(pricingQuote(options.payment, options.packageName)),
      status: options.status,
      visibilityStatus: "city_visible",
      selectedPerformerId: options.selectedPerformerId,
      completedAt: options.completedAt,
      archivedAt: options.status === "completed" ? options.completedAt : undefined
    }
  });
}

async function createResponseAndMaybeChat(
  request: Awaited<ReturnType<typeof createRequest>>,
  users: DemoUsers,
  responseStatus: string,
  chatStatus?: string,
  chatState: {
    clientConfirmedAt?: Date;
    performerConfirmedAt?: Date;
    notAgreedAt?: Date;
    closedAt?: Date;
    archivedAt?: Date;
  } = {}
) {
  const response = await prisma.requestResponse.create({
    data: {
      requestId: request.id,
      performerId: users.performer.id,
      message: "Готов обсудить условия заявки в чате.",
      status: responseStatus,
      acceptedAt: ["accepted_by_client", "discussion_response"].includes(responseStatus) ? new Date() : undefined,
      notAgreedAt: responseStatus === "not_agreed" ? new Date() : undefined
    }
  });

  if (!chatStatus) return response;

  const chat = await prisma.chat.create({
    data: {
      requestId: request.id,
      responseId: response.id,
      clientId: users.client.id,
      performerId: users.performer.id,
      status: chatStatus,
      clientConfirmedAt: chatState.clientConfirmedAt,
      performerConfirmedAt: chatState.performerConfirmedAt,
      notAgreedAt: chatState.notAgreedAt,
      closedAt: chatState.closedAt,
      archivedAt: chatState.archivedAt,
      conditionsJson: JSON.stringify({ publicNumber: request.publicNumber, priceEstimateAmount: request.priceEstimateAmount })
    }
  });

  await prisma.chatMessage.createMany({
    data: [
      {
        chatId: chat.id,
        senderId: null,
        text: "Сервис «Забота Рядом»: чат по заявке открыт. Обсудите дату, время, объём работ и условия выполнения.",
        isSystem: true
      },
      {
        chatId: chat.id,
        senderId: users.client.id,
        text: "Здравствуйте. Нужно уточнить время и состав работ.",
        moderationStatus: "clean"
      },
      {
        chatId: chat.id,
        senderId: users.performer.id,
        text: "Сообщение скрыто, потому что содержит контактные данные.",
        moderationStatus: "flagged",
        isHidden: true
      }
    ]
  });
  return response;
}

async function seedTransactions(users: DemoUsers, requestId: string) {
  await prisma.balanceTransaction.createMany({
    data: [
      { userId: users.client.id, type: "top_up", amount: 350, balanceKind: "real", reason: "Тестовое пополнение", comment: "demo seed", balanceBefore: 0, balanceAfter: 350 },
      { userId: users.client.id, type: "client_service_fee", amount: -50, balanceKind: "real", reason: "Сервисный сбор заказчика за согласованный визит", comment: "demo seed", balanceBefore: 350, balanceAfter: 300, relatedRequestId: requestId },
      { userId: users.client.id, type: "admin_bonus", amount: 100, balanceKind: "bonus", reason: "Пробный бонус", comment: "demo seed", balanceBefore: 0, balanceAfter: 100, createdByAdminId: users.admin.id },
      { userId: users.performer.id, type: "top_up", amount: 350, balanceKind: "real", reason: "Тестовое пополнение", comment: "demo seed", balanceBefore: 0, balanceAfter: 350 },
      { userId: users.performer.id, type: "performer_service_fee", amount: -50, balanceKind: "real", reason: "Сервисный сбор помощника за согласованный визит", comment: "demo seed", balanceBefore: 350, balanceAfter: 300, relatedRequestId: requestId },
      { userId: users.performer.id, type: "admin_bonus", amount: 50, balanceKind: "bonus", reason: "Пробный бонус", comment: "demo seed", balanceBefore: 0, balanceAfter: 50, createdByAdminId: users.admin.id }
    ]
  });
}

function pricingQuote(performerPaymentAmount: number, packageName: string) {
  const clientServiceFeeAmount = 50;
  const performerServiceFeeAmount = 50;
  const packageMeta = demoPackageMeta(packageName);
  return {
    basePrice: performerPaymentAmount,
    durationHours: 2,
    billableHours: 2,
    calculationUnit: "visit",
    packageId: packageMeta.id,
    packageTitle: packageName,
    packageLabel: packageName,
    packageName,
    packagePriceMin: packageMeta.min,
    packagePriceMax: packageMeta.max,
    packageDescription: "Пакет подобран для проверки карточек заявки.",
    included: ["согласованный объём помощи", "общение в чате", "без медицинских процедур"],
    excluded: ["медицинские процедуры", "передача контактов до согласования"],
    additions: [],
    performerPaymentAmount,
    clientServiceFeeAmount,
    performerServiceFeeAmount,
    performerCommissionAmount: performerServiceFeeAmount,
    clientTotalExpense: performerPaymentAmount + clientServiceFeeAmount,
    performerNetAmount: performerPaymentAmount - performerServiceFeeAmount,
    serviceMarginAmount: clientServiceFeeAmount + performerServiceFeeAmount,
    total: performerPaymentAmount,
    explanation: `Пакет визита: ${packageName}. Рекомендуемая оплата помощнику ${performerPaymentAmount} ₽.`,
    clientExplanation: `Рекомендуемая оплата помощнику ${performerPaymentAmount} ₽. Сервисный сбор заказчика ${clientServiceFeeAmount} ₽. Ориентировочные общие расходы ${performerPaymentAmount + clientServiceFeeAmount} ₽.`,
    performerExplanation: `Рекомендуемая оплата за визит ${performerPaymentAmount} ₽. Сервисный сбор помощника ${performerServiceFeeAmount} ₽. Ориентировочный доход после сервисного сбора ${performerPaymentAmount - performerServiceFeeAmount} ₽.`,
    increaseFactors: ["увеличение длительности", "изменение объёма помощи"],
    forbidden: ["инъекции", "капельницы", "перевязки", "лечение", "диагностика"]
  };
}

function demoPackageMeta(packageName: string) {
  if (packageName === "Короткая помощь") return { id: "short_help", min: 400, max: 700 };
  if (packageName === "Присмотр 2 часа") return { id: "supervision_2h", min: 700, max: 1200 };
  if (packageName === "Сопровождение стандарт") return { id: "accompaniment_standard", min: 800, max: 1500 };
  if (packageName === "Помощь 3–4 часа") return { id: "help_3_4h", min: 1200, max: 2000 };
  if (packageName === "Регулярная помощь") return { id: "regular_help", min: 700, max: null };
  return { id: "home_help_2h", min: 700, max: 1100 };
}

function upsertCity(
  slug: string,
  name: string,
  region: string,
  timezone: string,
  pricingZone: string,
  sortOrder: number,
  mapCenterLat: number,
  mapCenterLng: number,
  districts: string[]
) {
  return prisma.city.upsert({
    where: { slug },
    update: {
      name,
      region,
      status: "inactive",
      isActive: false,
      defaultCommissionAmount: 50,
      minTopUpAmount: 150,
      timezone,
      pricingZone,
      sortOrder,
      mapCenterLat,
      mapCenterLng,
      mapDefaultRadiusMeters: 600,
      districtsJson: JSON.stringify(districts)
    },
    create: {
      slug,
      name,
      region,
      status: "inactive",
      isActive: false,
      defaultCommissionAmount: 50,
      minTopUpAmount: 150,
      timezone,
      pricingZone,
      sortOrder,
      mapCenterLat,
      mapCenterLng,
      mapDefaultRadiusMeters: 600,
      districtsJson: JSON.stringify(districts)
    }
  });
}

function demoAddress(
  city: City,
  street: string,
  house: string,
  details: { apartment?: string; entrance?: string; floor?: string; intercom?: string; addressComment?: string } = {}
) {
  const parts = normalizeAddressParts({
    city: city.name,
    street,
    house,
    ...details
  }, city.name);
  return {
    addressCity: parts.city,
    addressStreet: parts.street,
    addressHouse: parts.house,
    addressApartment: parts.apartment,
    addressEntrance: parts.entrance,
    addressFloor: parts.floor,
    addressIntercom: parts.intercom,
    addressComment: parts.addressComment,
    fullAddress: buildFullAddress(parts),
    publicAddress: buildPublicAddress(parts),
    yandexPublicMapAddress: buildYandexPublicMapAddress(parts),
    yandexExactMapAddress: buildYandexExactMapAddress(parts)
  };
}

async function collectCounts(reset: boolean) {
  return {
    reset,
    usersLeft: await prisma.user.count(),
    demoUsers: await prisma.user.count({ where: { email: { in: baseEmails } } }),
    requests: await prisma.clientRequest.count({ where: { seedKey: { startsWith: "demo:" } } }),
    chats: await prisma.chat.count(),
    complaints: await prisma.complaint.count(),
    balanceTransactions: await prisma.balanceTransaction.count()
  };
}

export async function disconnectDemoPrisma() {
  await prisma.$disconnect();
}
