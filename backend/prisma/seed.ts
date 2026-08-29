import { hashPassword } from "../src/services/passwordService";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { City, ServiceCategory, User } from "@prisma/client";
import type { UserRole } from "../src/types/domain";
import {
  buildFullAddress,
  buildPublicAddress,
  buildYandexExactMapAddress,
  buildYandexPublicMapAddress,
  normalizeAddressParts
} from "../src/services/addressService";
import { acceptLatestLegalDocuments, requiredDocumentTypesForRegistration, seedLegalDocuments } from "../src/services/legalService";
import { normalizeRussianPhone } from "../src/services/phoneService";
import { CITY_DIRECTORY } from "../src/services/cityDirectory";
import { ensureSettlementDirectory } from "../src/services/settlementService";
import {
  createDraftFromImport,
  ensureFederalCategoryStructure,
  publishCategoryStructure,
  type CategoryImportPayload
} from "../src/services/categoryStructureService";

const prisma = new PrismaClient();

const password = "password123";

async function main() {
  const passwordHash = await hashPassword(password);

  const yugorsk = await prisma.city.upsert({
    where: { slug: "yugorsk" },
    update: {
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
      districtsJson: JSON.stringify(["Центр", "Южный", "Северный", "Промзона"])
    },
    create: {
      name: "Югорск",
      slug: "yugorsk",
      region: "ХМАО - Югра",
      status: "active",
      defaultCommissionAmount: 50,
      minTopUpAmount: 150,
      timezone: "Asia/Yekaterinburg",
      pricingZone: "base_yugorsk",
      sortOrder: 10,
      mapCenterLat: 61.3133,
      mapCenterLng: 63.3319,
      mapDefaultRadiusMeters: 600,
      districtsJson: JSON.stringify(["Центр", "Южный", "Северный", "Промзона"])
    }
  });

  const sovetsky = await prisma.city.upsert({
    where: { slug: "sovetsky" },
    update: {
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
  for (const city of CITY_DIRECTORY) {
    await prisma.city.upsert({
      where: { slug: city.slug },
      update: { ...city, status: "inactive" },
      create: { ...city, status: "inactive", defaultCommissionAmount: 50, minTopUpAmount: 150 }
    });
  }

  const categories = [
    {
      slug: "companionship",
      name: "Присмотр и общение",
      basePrice: 700,
      calculationUnit: "visit",
      minDurationHours: 1,
      sortOrder: 10,
      description: "Быть рядом, наблюдать, поддерживать и общаться без медицинских процедур.",
      included: ["побыть рядом", "общение", "бытовой контроль безопасности", "подать воду или плед"],
      excluded: ["гигиена тела", "помощь в туалете", "перемещение с кровати", "медицинские процедуры"],
      clientInstructions: "Подходит для простого присмотра и общения. Если нужна гигиена или помощь с туалетом, выберите сиделку или уход за маломобильным.",
      performerInstructions: "Не соглашайтесь на тяжёлый уход в рамках присмотра. Если на месте объём сложнее, сообщите администратору.",
      pricingRules: { packages: ["short_help", "supervision_2h"], basePerformerPayment: 700 }
    },
    {
      slug: "escort",
      name: "Сопровождение",
      basePrice: 800,
      calculationUnit: "visit",
      minDurationHours: 2,
      sortOrder: 20,
      description: "Помочь добраться куда-то, подождать рядом и вернуться.",
      included: ["магазин", "аптека", "МФЦ", "банк", "поликлиника без медицинского сопровождения", "вызов такси"],
      excluded: ["медицинские консультации", "подписание документов вместо заказчика", "финансовые операции вместо заказчика", "перенос человека"],
      clientInstructions: "Укажите маршрут, длительность ожидания и мобильность человека.",
      performerInstructions: "Согласуйте маршрут, ожидание, транспорт и безопасность до принятия заявки.",
      pricingRules: { packages: ["accompaniment_standard"], basePerformerPayment: 800 }
    },
    {
      slug: "home-help",
      name: "Помощь по дому",
      basePrice: 700,
      calculationUnit: "visit",
      minDurationHours: 2,
      sortOrder: 30,
      description: "Бытовые задачи без ухода за телом человека.",
      included: ["лёгкая уборка", "мытьё посуды", "стирка", "глажка", "смена постельного белья без лежачего ухода"],
      excluded: ["уход за телом человека", "помощь в туалете", "перемещение человека", "генеральная уборка после ремонта"],
      clientInstructions: "Опишите объём бытовых задач. Уход за телом относится к другим категориям.",
      performerInstructions: "Если работа тяжёлая, длительная или условия плохие, нужна ручная проверка.",
      pricingRules: { packages: ["home_help_2h", "help_3_4h", "regular_help"], basePerformerPayment: 700 }
    },
    {
      slug: "cooking",
      name: "Приготовление еды",
      basePrice: 700,
      calculationUnit: "visit",
      minDurationHours: 1,
      sortOrder: 40,
      description: "Отдельный визит для приготовления простой домашней еды.",
      included: ["простая домашняя еда", "разложить по контейнерам", "посуда после готовки", "простой список продуктов"],
      excluded: ["назначение диеты", "лечебное питание по диагнозу", "сложное праздничное меню", "кормление тяжёлого лежачего человека"],
      clientInstructions: "Помощник учитывает бытовые пожелания, но не назначает лечебное питание.",
      performerInstructions: "Не берите медицинские назначения по питанию. Согласуйте продукты и объём заранее.",
      pricingRules: { packages: ["home_help_2h", "help_3_4h"], basePerformerPayment: 700 }
    },
    {
      slug: "elderly-care",
      name: "Сиделка для пожилого человека",
      basePrice: 700,
      calculationUnit: "visit",
      minDurationHours: 3,
      sortOrder: 50,
      description: "Регулярное присутствие и базовая бытовая помощь пожилому человеку.",
      included: ["общение и присмотр", "помощь с едой", "помощь с одеждой", "лёгкая бытовая гигиена", "связь с родственником"],
      excluded: ["полное подмывание лежачего", "смена подгузника лежачему", "перевязки", "обработка пролежней", "тяжёлое перемещение"],
      clientInstructions: "Если человек маломобильный или лежачий, выберите уход за маломобильным.",
      performerInstructions: "Обычная сиделка не выполняет медицинские процедуры и тяжёлый лежачий уход.",
      pricingRules: { packages: ["supervision_2h", "help_3_4h", "regular_help"], basePerformerPayment: 700 }
    },
    {
      slug: "limited-mobility-care",
      name: "Уход за маломобильным человеком",
      basePrice: 1200,
      calculationUnit: "visit",
      minDurationHours: 3,
      sortOrder: 60,
      description: "Бытовой уход за человеком с ограниченной мобильностью, включая гигиену без медпроцедур.",
      included: ["помощь с перемещением", "помощь с едой", "бытовая гигиена", "смена подгузника как бытовой уход", "смена положения тела"],
      excluded: ["инъекции", "капельницы", "перевязки", "обработка ран", "лечение пролежней", "катетеры и стомы"],
      clientInstructions: "Подробно опишите мобильность, вес, риски падения и гигиену. Медицинские процедуры запрещены.",
      performerInstructions: "Согласуйте безопасное перемещение. Если требуется два человека или подъём на руках, нужна ручная проверка.",
      pricingRules: { packages: ["help_3_4h", "regular_help"], basePerformerPayment: 1200 }
    },
    {
      slug: "delivery-errands",
      name: "Доставка / закупки / поручения",
      basePrice: 400,
      calculationUnit: "task",
      minDurationHours: 1,
      sortOrder: 70,
      description: "Небольшие закупки, доставка и бытовые поручения.",
      included: ["купить продукты рядом", "аптека без консультаций", "передать вещи", "небольшие поручения"],
      excluded: ["крупные финансовые операции", "получение кредитов", "медицинские консультации"],
      clientInstructions: "Укажите список, адрес и ограничения по сумме покупки.",
      performerInstructions: "Не берите рискованные финансовые поручения и не консультируйте по лекарствам.",
      pricingRules: { packages: ["short_help"], basePerformerPayment: 400 }
    },
    {
      slug: "walks",
      name: "Прогулки",
      basePrice: 800,
      calculationUnit: "visit",
      minDurationHours: 1,
      sortOrder: 80,
      description: "Прогулка рядом без медицинского сопровождения.",
      included: ["прогулка рядом", "безопасный маршрут", "связь с родственником по договорённости"],
      excluded: ["реабилитационные упражнения", "медицинский контроль", "перенос человека"],
      clientInstructions: "Укажите мобильность человека и маршрут.",
      performerInstructions: "Если требуется физическая поддержка или коляска, согласуйте условия заранее.",
      pricingRules: { packages: ["accompaniment_standard"], basePerformerPayment: 800 }
    },
    {
      slug: "small-household-tasks",
      name: "Мелкие бытовые задачи",
      basePrice: 400,
      calculationUnit: "task",
      minDurationHours: 1,
      sortOrder: 90,
      description: "Небольшие бытовые действия понятного объёма.",
      included: ["вынести мусор", "передвинуть лёгкие вещи", "помочь с простой задачей", "короткая бытовая помощь"],
      excluded: ["ремонтные работы повышенного риска", "тяжёлый физический труд", "медицинские процедуры"],
      clientInstructions: "Опишите одну понятную бытовую задачу и примерную длительность.",
      performerInstructions: "Не выполняйте опасные или тяжёлые работы без ручного согласования.",
      pricingRules: { packages: ["short_help"], basePerformerPayment: 400 }
    },
    {
      slug: "childcare",
      name: "Няня для ребёнка / няня для малышей",
      basePrice: 700,
      calculationUnit: "hour",
      minDurationHours: 2,
      sortOrder: 100,
      isChildcare: true,
      description: "Присмотр за ребёнком. Категория с отдельным допуском и видимым статусом справки.",
      included: ["присмотр", "игры", "безопасное нахождение рядом", "простая бытовая помощь в рамках присмотра"],
      excluded: ["медицинский уход", "назначение лекарств", "перевозка без отдельного согласования"],
      clientInstructions: "Проверьте статус справки об отсутствии судимости и допуск к категории.",
      performerInstructions: "Для категории нужен отдельный допуск. Медицинские действия и лекарства не выполняются.",
      pricingRules: { packages: ["supervision_2h", "help_3_4h"], basePerformerPayment: 700 }
    }
  ];
  const activeCategorySlugs = categories.map((category) => category.slug);
  await prisma.serviceCategory.updateMany({
    where: { slug: { notIn: activeCategorySlugs } },
    data: { isActive: false }
  });

  const categoryRecords = await Promise.all(
    categories.map((category) =>
      prisma.serviceCategory.upsert({
        where: { slug: category.slug },
        update: {
          name: category.name,
          isActive: true,
          basePrice: category.basePrice,
          calculationUnit: category.calculationUnit,
          minDurationHours: category.minDurationHours,
          sortOrder: category.sortOrder,
          isChildcare: Boolean(category.isChildcare),
          requiresCriminalRecord: Boolean(category.isChildcare),
          description: category.description,
          includedJson: JSON.stringify(category.included),
          excludedJson: JSON.stringify(category.excluded),
          complexityJson: JSON.stringify({ simple: "×1.00", standard: "×1.15", complex: "×1.35 или ручной расчёт" }),
          transferRules: "Если объём, физическая нагрузка или гигиена выходят за рамки категории, заявку нужно перевести в более подходящий формат.",
          medicalProhibitions: "Инъекции, капельницы, перевязки, лечение, диагностика, назначение лекарств и медицинский контроль не выполняются.",
          clientInstructions: category.clientInstructions,
          performerInstructions: category.performerInstructions,
          pricingRulesJson: JSON.stringify(category.pricingRules)
        },
        create: {
          slug: category.slug,
          name: category.name,
          basePrice: category.basePrice,
          calculationUnit: category.calculationUnit,
          minDurationHours: category.minDurationHours,
          sortOrder: category.sortOrder,
          isChildcare: Boolean(category.isChildcare),
          requiresCriminalRecord: Boolean(category.isChildcare),
          description: category.description,
          includedJson: JSON.stringify(category.included),
          excludedJson: JSON.stringify(category.excluded),
          complexityJson: JSON.stringify({ simple: "×1.00", standard: "×1.15", complex: "×1.35 или ручной расчёт" }),
          transferRules: "Если объём, физическая нагрузка или гигиена выходят за рамки категории, заявку нужно перевести в более подходящий формат.",
          medicalProhibitions: "Инъекции, капельницы, перевязки, лечение, диагностика, назначение лекарств и медицинский контроль не выполняются.",
          clientInstructions: category.clientInstructions,
          performerInstructions: category.performerInstructions,
          pricingRulesJson: JSON.stringify(category.pricingRules)
        }
      })
    )
  );

  const admin = await upsertUser({
    role: "superadmin",
    email: "admin@zabota.local",
    phone: "+79000000001",
    displayName: "Главный администратор",
    cityId: yugorsk.id,
    passwordHash,
    balance: 0,
    bonusBalance: 0
  });

  const client = await upsertUser({
    role: "client",
    email: "client@zabota.local",
    phone: "+79000000002",
    displayName: "Анна, заказчик",
    cityId: yugorsk.id,
    passwordHash,
    balance: 300,
    bonusBalance: 100
  });

  const performer = await upsertUser({
    role: "performer",
    email: "performer@zabota.local",
    phone: "+79000000003",
    displayName: "Марина, помощник",
    cityId: yugorsk.id,
    passwordHash,
    balance: 250,
    bonusBalance: 100
  });

  const secondPerformer = await upsertUser({
    role: "performer",
    email: "performer2@zabota.local",
    phone: "+79000000004",
    displayName: "Ольга, помощник",
    cityId: sovetsky.id,
    passwordHash,
    balance: 100,
    bonusBalance: 200
  });

  await seedLegalDocuments(prisma, admin.id);
  await seedUserLegalConsents(client.id, "client");
  await seedUserLegalConsents(performer.id, "performer");
  await seedUserLegalConsents(secondPerformer.id, "performer");

  await prisma.clientProfile.upsert({
    where: { userId: client.id },
    update: { fullName: "Анна Петрова", preferredContactMethod: "chat" },
    create: { userId: client.id, fullName: "Анна Петрова", preferredContactMethod: "chat" }
  });

  await backfillNormalizedPhones();

  await prisma.performerProfile.upsert({
    where: { userId: performer.id },
    update: {
      age: 42,
      about: "Помогаю по дому, сопровождаю на прогулки и в поликлинику без медицинских процедур.",
      experience: "4 года бытовой помощи и сопровождения.",
      services: JSON.stringify(["помощь пожилым", "помощь по дому", "сопровождение", "присмотр и общение"]),
      skills: JSON.stringify(["аккуратность", "общение", "готовка простой еды"]),
      districts: JSON.stringify(["Центр", "Южный"]),
      canTravelIndependently: true,
      canTravelOutsideCity: false,
      readyForHygieneHelp: true,
      readyForPhysicalHelp: true,
      readyForLimitedMobility: true,
      readyForChildren: false,
      readyForUrgentRequests: true,
      readyToProvideDocuments: true,
      selfEmployedStatus: "self_employed_provided",
      criminalRecordCertificateStatus: "criminal_record_not_provided",
      verificationStatuses: JSON.stringify([
        "phone_verified",
        "profile_completed",
        "self_employed_provided",
        "criminal_record_not_provided",
        "documents_optional"
      ]),
      childcareApprovalStatus: "missing_criminal_record",
      trustLevel: "profile_completed",
      rating: 4.8,
      completedJobsCount: 12,
      isAvailable: true
    },
    create: {
      userId: performer.id,
      age: 42,
      about: "Помогаю по дому, сопровождаю на прогулки и в поликлинику без медицинских процедур.",
      experience: "4 года бытовой помощи и сопровождения.",
      services: JSON.stringify(["помощь пожилым", "помощь по дому", "сопровождение", "присмотр и общение"]),
      skills: JSON.stringify(["аккуратность", "общение", "готовка простой еды"]),
      districts: JSON.stringify(["Центр", "Южный"]),
      canTravelIndependently: true,
      canTravelOutsideCity: false,
      readyForHygieneHelp: true,
      readyForPhysicalHelp: true,
      readyForLimitedMobility: true,
      readyForChildren: false,
      readyForUrgentRequests: true,
      readyToProvideDocuments: true,
      selfEmployedStatus: "self_employed_provided",
      criminalRecordCertificateStatus: "criminal_record_not_provided",
      verificationStatuses: JSON.stringify([
        "phone_verified",
        "profile_completed",
        "self_employed_provided",
        "criminal_record_not_provided",
        "documents_optional"
      ]),
      childcareApprovalStatus: "missing_criminal_record",
      trustLevel: "profile_completed",
      rating: 4.8,
      completedJobsCount: 12,
      isAvailable: true
    }
  });

  await prisma.performerProfile.upsert({
    where: { userId: secondPerformer.id },
    update: {
      age: 35,
      about: "Бытовая помощь, доставка и прогулки.",
      services: JSON.stringify(["доставка и поручения", "прогулки", "мелкие бытовые задачи"]),
      districts: JSON.stringify(["Советский"]),
      canTravelIndependently: true,
      canTravelOutsideCity: true,
      readyForHygieneHelp: false,
      readyForPhysicalHelp: false,
      readyForLimitedMobility: false,
      readyForChildren: true,
      readyForUrgentRequests: true,
      readyToProvideDocuments: true,
      selfEmployedStatus: "self_employed_verified",
      criminalRecordCertificateStatus: "criminal_record_verified",
      verificationStatuses: JSON.stringify([
        "phone_verified",
        "profile_completed",
        "self_employed_verified",
        "criminal_record_verified",
        "trusted_by_reviews"
      ]),
      childcareApprovalStatus: "approved",
      trustLevel: "trusted_by_reviews",
      rating: 4.9,
      completedJobsCount: 19,
      isAvailable: true
    },
    create: {
      userId: secondPerformer.id,
      age: 35,
      about: "Бытовая помощь, доставка и прогулки.",
      services: JSON.stringify(["доставка и поручения", "прогулки", "мелкие бытовые задачи"]),
      districts: JSON.stringify(["Советский"]),
      canTravelIndependently: true,
      canTravelOutsideCity: true,
      readyForHygieneHelp: false,
      readyForPhysicalHelp: false,
      readyForLimitedMobility: false,
      readyForChildren: true,
      readyForUrgentRequests: true,
      readyToProvideDocuments: true,
      selfEmployedStatus: "self_employed_verified",
      criminalRecordCertificateStatus: "criminal_record_verified",
      verificationStatuses: JSON.stringify([
        "phone_verified",
        "profile_completed",
        "self_employed_verified",
        "criminal_record_verified",
        "trusted_by_reviews"
      ]),
      childcareApprovalStatus: "approved",
      trustLevel: "trusted_by_reviews",
      rating: 4.9,
      completedJobsCount: 19,
      isAvailable: true
    }
  });

  const elderly = categoryRecords.find((category) => category.slug === "elderly-care")!;
  const escort = categoryRecords.find((category) => category.slug === "escort")!;
  const childcare = categoryRecords.find((category) => category.slug === "childcare")!;

  const firstRequest = await prisma.clientRequest.upsert({
    where: { seedKey: "seed-yugorsk-elderly-1" },
    update: {
      publicNumber: "ZR-2026-0001",
      title: "Помощь пожилому человеку с бытом и общением",
      status: "has_responses",
      visibilityStatus: "city_visible",
      priceEstimateAmount: 1400,
      pricingBreakdownJson: JSON.stringify({
        performerPaymentAmount: 1400,
        clientServiceFeeAmount: 50,
        clientTotalExpense: 1450,
        packageName: "Помощь 3–4 часа",
        explanation: "Рекомендуемая оплата помощнику 1400 ₽, сервисный сбор заказчика 50 ₽, ориентировочные общие расходы 1450 ₽."
      })
    },
    create: {
      seedKey: "seed-yugorsk-elderly-1",
      publicNumber: "ZR-2026-0001",
      clientId: client.id,
      cityId: yugorsk.id,
      categoryId: elderly.id,
      title: "Помощь пожилому человеку с бытом и общением",
      description:
        "Нужно прийти на 2 часа, помочь с лёгкой уборкой, приготовить простую еду и поговорить. Медицинские процедуры не требуются.",
      addressText: "Югорск, ул. Ленина, 12",
      approximateAddressText: "Югорск, район Центр",
      lat: 61.3145,
      lng: 63.333,
      approximateLat: 61.31,
      approximateLng: 63.33,
      district: "Центр",
      date: new Date("2026-07-22T00:00:00.000Z"),
      timeFrom: "10:00",
      timeTo: "12:00",
      expectedDurationHours: 2,
      urgency: "normal",
      hasElderlyPerson: true,
      needsCooking: true,
      needsCleaning: true,
      budgetAmount: 1400,
      priceEstimateAmount: 1400,
      pricingBreakdownJson: JSON.stringify({
        performerPaymentAmount: 1400,
        clientServiceFeeAmount: 50,
        clientTotalExpense: 1450,
        packageName: "Помощь 3–4 часа",
        explanation: "Рекомендуемая оплата помощнику 1400 ₽, сервисный сбор заказчика 50 ₽, ориентировочные общие расходы 1450 ₽."
      }),
      comment: "Проверить, что помощник готов к спокойному общению.",
      status: "has_responses",
      visibilityStatus: "city_visible"
    }
  });

  await prisma.clientRequest.upsert({
    where: { seedKey: "seed-yugorsk-escort-1" },
    update: {
      publicNumber: "ZR-2026-0002",
      status: "waiting_for_responses",
      visibilityStatus: "city_visible",
      priceEstimateAmount: 600,
      pricingBreakdownJson: JSON.stringify({
        performerPaymentAmount: 600,
        clientServiceFeeAmount: 50,
        clientTotalExpense: 650,
        packageName: "Обычное сопровождение",
        explanation: "Рекомендуемая оплата помощнику 600 ₽, сервисный сбор заказчика 50 ₽, ориентировочные общие расходы 650 ₽."
      })
    },
    create: {
      seedKey: "seed-yugorsk-escort-1",
      publicNumber: "ZR-2026-0002",
      clientId: client.id,
      cityId: yugorsk.id,
      categoryId: escort.id,
      title: "Сопровождение на прогулку и обратно",
      description: "Нужно сопроводить подопечного на прогулку во дворе. Без медицинского ухода.",
      addressText: "Югорск, ул. Мира, 5",
      approximateAddressText: "Югорск, район Южный",
      lat: 61.307,
      lng: 63.329,
      approximateLat: 61.31,
      approximateLng: 63.33,
      district: "Южный",
      date: new Date("2026-07-23T00:00:00.000Z"),
      timeFrom: "15:00",
      timeTo: "16:00",
      expectedDurationHours: 1,
      urgency: "normal",
      hasElderlyPerson: true,
      needsWalk: true,
      budgetAmount: 600,
      priceEstimateAmount: 600,
      pricingBreakdownJson: JSON.stringify({
        performerPaymentAmount: 600,
        clientServiceFeeAmount: 50,
        clientTotalExpense: 650,
        packageName: "Обычное сопровождение",
        explanation: "Рекомендуемая оплата помощнику 600 ₽, сервисный сбор заказчика 50 ₽, ориентировочные общие расходы 650 ₽."
      }),
      status: "waiting_for_responses",
      visibilityStatus: "city_visible"
    }
  });

  await prisma.clientRequest.upsert({
    where: { seedKey: "seed-yugorsk-childcare-1" },
    update: {
      publicNumber: "ZR-2026-0003",
      status: "waiting_for_responses",
      visibilityStatus: "city_visible",
      priceEstimateAmount: 1950,
      pricingBreakdownJson: JSON.stringify({
        performerPaymentAmount: 1950,
        clientServiceFeeAmount: 50,
        clientTotalExpense: 2000,
        packageName: "Няня для ребёнка / Няня для малышей",
        explanation: "Рекомендуемая оплата помощнику 1950 ₽, сервисный сбор заказчика 50 ₽, ориентировочные общие расходы 2000 ₽."
      })
    },
    create: {
      seedKey: "seed-yugorsk-childcare-1",
      publicNumber: "ZR-2026-0003",
      clientId: client.id,
      cityId: yugorsk.id,
      categoryId: childcare.id,
      title: "Няня на вечер для ребёнка 6 лет",
      description:
        "Нужно присмотреть за ребёнком дома 3 часа. Заказчик видит статус справки об отсутствии судимости помощника.",
      addressText: "Югорск, ул. Спортивная, 3",
      approximateAddressText: "Югорск, район Центр",
      lat: 61.318,
      lng: 63.336,
      approximateLat: 61.32,
      approximateLng: 63.34,
      district: "Центр",
      date: new Date("2026-07-25T00:00:00.000Z"),
      timeFrom: "18:00",
      timeTo: "21:00",
      expectedDurationHours: 3,
      urgency: "urgent",
      hasChild: true,
      budgetAmount: 1950,
      priceEstimateAmount: 1950,
      pricingBreakdownJson: JSON.stringify({
        performerPaymentAmount: 1950,
        clientServiceFeeAmount: 50,
        clientTotalExpense: 2000,
        packageName: "Няня для ребёнка / Няня для малышей",
        explanation: "Рекомендуемая оплата помощнику 1950 ₽, сервисный сбор заказчика 50 ₽, ориентировочные общие расходы 2000 ₽."
      }),
      comment: "Для категории няни заказчик должен видеть статус справки.",
      status: "waiting_for_responses",
      visibilityStatus: "city_visible"
    }
  });

  await prisma.requestResponse.upsert({
    where: {
      requestId_performerId: {
        requestId: firstRequest.id,
        performerId: performer.id
      }
    },
    update: {
      message: "Готова помочь. Подходит время, район знаю.",
      status: "pending"
    },
    create: {
      requestId: firstRequest.id,
      performerId: performer.id,
      message: "Готова помочь. Подходит время, район знаю.",
      status: "pending"
    }
  });

  await prisma.balanceTransaction.deleteMany({
    where: {
      OR: [
        { userId: performer.id, reason: "Стартовый бонус для теста" },
        { userId: client.id, reason: "Тестовое пополнение" }
      ]
    }
  });
  await prisma.balanceTransaction.createMany({
    data: [
      {
        userId: performer.id,
        type: "admin_bonus",
        amount: 100,
        balanceKind: "bonus",
        reason: "Стартовый бонус для теста",
        comment: "Seed-начисление для проверки пробного периода",
        balanceBefore: 0,
        balanceAfter: 100,
        createdByAdminId: admin.id
      },
      {
        userId: client.id,
        type: "top_up",
        amount: 300,
        balanceKind: "real",
        reason: "Тестовое пополнение",
        comment: "Seed mock payment",
        balanceBefore: 0,
        balanceAfter: 300
      }
    ]
  });

  await prisma.auditLog.deleteMany({ where: { action: "seed_completed" } });
  await prisma.auditLog.create({
    data: {
      actorUserId: admin.id,
      action: "seed_completed",
      entityType: "system",
      payloadJson: JSON.stringify({
        cities: [yugorsk.slug, sovetsky.slug],
        users: ["admin@zabota.local", "client@zabota.local", "performer@zabota.local"],
        note: "Seed can be rerun; transactional rows may append for audit visibility."
      })
    }
  });

  await seedSettings();
  await seedKnowledgeBase();
  await prisma.performerDocument.deleteMany({
    where: {
      OR: [
        { performerId: { in: [performer.id, secondPerformer.id] } },
        {
          fileName: {
            in: ["self-employed-example.pdf", "criminal-record-example.pdf", "Документ самозанятости.pdf", "Справка об отсутствии судимости.pdf"]
          }
        }
      ]
    }
  });
  await seedVisualAuditData({
    admin,
    client,
    performer,
    secondPerformer,
    yugorsk,
    sovetsky,
    categories: categoryRecords
  });
  await ensureSettlementDirectory();
  await ensureFederalCategoryStructure();
  await seedServiceStructureVersions(admin.id);

  console.log("Seed completed");
  if (process.env.SEED_DEMO_DATA === "true" && (process.env.NODE_ENV !== "production" || process.env.DEMO_MODE === "true")) {
    console.table([
      { role: "superadmin", email: "admin@zabota.local", password },
      { role: "client", email: "client@zabota.local", password },
      { role: "performer", email: "performer@zabota.local", password },
      { role: "performer", email: "performer2@zabota.local", password }
    ]);
  }
}

async function seedServiceStructureVersions(adminId: string) {
  for (const fileName of ["russia-v2.json", "khmao-v2.json", "yugorsk-v2.json"]) {
    const payload = JSON.parse(readFileSync(path.resolve(process.cwd(), "backend/prisma/structures", fileName), "utf8")) as CategoryImportPayload;
    const scope = payload.scope.type === "federal"
      ? { scopeKey: "federal" }
      : payload.scope.type === "region"
        ? { scopeKey: `region:${(await prisma.region.findUniqueOrThrow({ where: { slug: payload.scope.regionSlug! } })).id}` }
        : { scopeKey: `city:${(await prisma.city.findUniqueOrThrow({ where: { slug: payload.scope.citySlug! } })).id}` };
    const existing = await prisma.categoryStructure.findUnique({
      where: { scopeKey_versionNumber: { scopeKey: scope.scopeKey, versionNumber: payload.passport?.versionNumber ?? "2.0" } }
    });
    if (existing?.status === "draft") await publishCategoryStructure(existing.id, adminId);
    if (existing) continue;
    const draft = await createDraftFromImport(payload, adminId, fileName);
    await publishCategoryStructure(draft.id, adminId);
  }
}

async function seedSettings() {
  const settings = [
    ["clientServiceFeeAmount", 50, "Сервисный сбор заказчика, ₽", "payments"],
    ["performerServiceFeeAmount", 50, "Сервисный сбор помощника, ₽", "payments"],
    ["performerCommissionAmount", 50, "Сервисный сбор помощника, ₽", "payments"],
    ["serviceCommissionAmount", 50, "Устаревший ключ совместимости: сервисный сбор", "payments"],
    ["minTopUpAmount", 150, "Минимальное пополнение", "payments"],
    ["useBonusForCommission", true, "Использовать бонусный баланс для сервисных сборов", "payments"],
    ["chargeBonusFirst", true, "Сначала списывать бонусный баланс", "payments"],
    ["mapPrivacyRadiusMeters", 600, "Радиус скрытия точного адреса на карте", "privacy"],
    ["archiveAfterDays", 90, "Срок перехода неактивных данных в архив", "archive"],
    ["filterPhones", true, "Фильтр телефонов", "moderation"],
    ["filterLinks", true, "Фильтр ссылок", "moderation"],
    ["filterBankCards", true, "Фильтр банковских карт", "moderation"],
    ["filterAdultContent", true, "Фильтр 18+", "moderation"],
    ["filterProfanity", true, "Фильтр грубой лексики", "moderation"],
    ["chatWarningText", "Не передавайте телефон, ссылки, номера карт и коды из SMS в чате.", "Предупреждение в чате", "moderation"],
    ["medicalWarningText", "Сервис не принимает медицинские заявки: инъекции, капельницы, лечение, диагностику и перевязки.", "Предупреждение о медицинских услугах", "moderation"]
  ] as const;

  await Promise.all(
    settings.map(([key, value, label, group]) =>
      prisma.serviceSetting.upsert({
        where: { key },
        update: { valueJson: JSON.stringify(value), label, group },
        create: { key, valueJson: JSON.stringify(value), label, group }
      })
    )
  );
}

async function seedKnowledgeBase() {
  const articles = [
    ["all", "Как работает сервис", "how-service-works", "Сервис помогает заказчику разместить заявку, помощнику откликнуться, а сторонам общаться в рабочем чате.", "Старт"],
    ["client", "Как создать заявку", "how-create-request", "Выберите город, категорию, время, условия и проверьте рекомендуемую стоимость визита.", "Заказчикам"],
    ["performer", "Как помощник откликается на заявку", "how-performer-responds", "Помощник видит примерную точку, условия и отправляет отклик. Чат открывается только после выбора заказчика.", "Помощникам"],
    ["all", "Почему телефон не раскрывается сразу", "why-phone-hidden", "Контакты скрыты для безопасности. Общение начинается внутри сервиса.", "Безопасность"],
    ["all", "Как работает сервисный сбор", "service-fee-50", "Заказчик оплачивает сервисный сбор заказчика, помощник оплачивает сервисный сбор помощника. Списание происходит только после двойного подтверждения условий.", "Баланс"],
    ["all", "Какие услуги запрещены", "forbidden-medical-services", "Запрещены медицинские услуги: инъекции, капельницы, лечение, диагностика, перевязки и назначение лекарств.", "Правила"],
    ["performer", "Что означает справка об отсутствии судимости", "criminal-record-status", "Для обычных задач справка отображается как статус. Для нянь требования строже.", "Доверие"],
    ["all", "Как работает категория «Няня для малышей»", "childcare-rules", "Заказчик видит статус справки и отдельный допуск помощника к категории.", "Няни"]
  ] as const;

  await Promise.all(
    articles.map(([audience, title, slug, content, category], index) =>
      prisma.knowledgeArticle.upsert({
        where: { slug },
        update: { audience, title, content, category, sortOrder: index + 1, isPublished: true },
        create: { audience, title, slug, content, category, sortOrder: index + 1, isPublished: true }
      })
    )
  );
}

async function seedVisualAuditData(input: {
  admin: User;
  client: User;
  performer: User;
  secondPerformer: User;
  yugorsk: City;
  sovetsky: City;
  categories: ServiceCategory[];
}) {
  const {
    admin,
    client,
    performer,
    yugorsk,
    sovetsky,
    categories
  } = input;
  const bySlug = (slug: string) => {
    const category = categories.find((item) => item.slug === slug);
    if (!category) throw new Error(`Category ${slug} not found`);
    return category;
  };
  const category = {
    companionship: bySlug("companionship"),
    escort: bySlug("escort"),
    homeHelp: bySlug("home-help"),
    cooking: bySlug("cooking"),
    elderlyCare: bySlug("elderly-care"),
    mobilityCare: bySlug("limited-mobility-care"),
    childcare: bySlug("childcare"),
    errands: bySlug("delivery-errands")
  };
  const auditSeedKeys = [
    "visual-audit-active-no-response",
    "visual-audit-with-response",
    "visual-audit-open-chat",
    "visual-audit-waiting-client-confirmation",
    "visual-audit-waiting-performer-confirmation",
    "visual-audit-in-work",
    "visual-audit-completed",
    "visual-audit-not-agreed",
    "visual-audit-partial-match",
    "visual-audit-childcare-not-fit",
    "visual-audit-sovetsky-erand-other-city"
  ];

  const existingRequests = await prisma.clientRequest.findMany({
    where: { seedKey: { in: auditSeedKeys } },
    select: { id: true }
  });
  const requestIds = existingRequests.map((request) => request.id);
  const existingChats = requestIds.length
    ? await prisma.chat.findMany({ where: { requestId: { in: requestIds } }, select: { id: true } })
    : [];
  const chatIds = existingChats.map((chat) => chat.id);

  await prisma.$transaction(async (tx) => {
    if (chatIds.length) {
      await tx.chatMessage.deleteMany({ where: { chatId: { in: chatIds } } });
      await tx.complaint.deleteMany({ where: { chatId: { in: chatIds } } });
      await tx.chat.deleteMany({ where: { id: { in: chatIds } } });
    }
    if (requestIds.length) {
      await tx.balanceTransaction.deleteMany({ where: { relatedRequestId: { in: requestIds } } });
      await tx.review.deleteMany({ where: { requestId: { in: requestIds } } });
      await tx.complaint.deleteMany({ where: { requestId: { in: requestIds } } });
      await tx.requestResponse.deleteMany({ where: { requestId: { in: requestIds } } });
      await tx.clientRequest.deleteMany({ where: { id: { in: requestIds } } });
    }
    await tx.balanceTransaction.deleteMany({
      where: {
        OR: [
          { reason: { startsWith: "Visual audit" } },
          { comment: { startsWith: "Visual audit" } }
        ]
      }
    });
    await tx.complaint.deleteMany({ where: { publicNumber: { in: ["SUP-2026-0901", "SUP-2026-0902"] } } });
    await tx.performerDocument.deleteMany({
      where: {
        performerId: performer.id,
        fileName: { startsWith: "visual-audit-" }
      }
    });
    await tx.userRiskFlag.deleteMany({
      where: {
        userId: performer.id,
        reason: { startsWith: "Visual audit" }
      }
    });
    await tx.auditLog.deleteMany({ where: { action: { startsWith: "visual_audit.seed" } } });
  });

  const now = new Date();
  const requestData = [
    {
      key: "visual-audit-active-no-response",
      number: "ZR-2026-0901",
      title: "Visual audit: активная заявка без откликов",
      category: category.escort,
      status: "waiting_for_responses",
      district: "Центр",
      date: "2026-08-01",
      timeFrom: "10:00",
      timeTo: "11:00",
      hours: 1,
      amount: 600,
      packageName: "Обычное сопровождение",
      flags: { hasElderlyPerson: true, needsWalk: true },
      actions: ["escort", "walk"]
    },
    {
      key: "visual-audit-with-response",
      number: "ZR-2026-0902",
      title: "Visual audit: заявка с откликом помощника",
      category: category.homeHelp,
      status: "has_responses",
      district: "Южный",
      date: "2026-08-02",
      timeFrom: "12:00",
      timeTo: "14:00",
      hours: 2,
      amount: 950,
      packageName: "Бытовая помощь 2 часа",
      flags: { needsCleaning: true },
      actions: ["light_cleaning", "laundry"]
    },
    {
      key: "visual-audit-open-chat",
      number: "ZR-2026-0903",
      title: "Visual audit: открытый чат по заявке",
      category: category.companionship,
      status: "discussion",
      district: "Центр",
      date: "2026-08-03",
      timeFrom: "15:00",
      timeTo: "17:00",
      hours: 2,
      amount: 800,
      packageName: "Присмотр 2 часа",
      flags: { hasElderlyPerson: true },
      actions: ["companionship"]
    },
    {
      key: "visual-audit-waiting-client-confirmation",
      number: "ZR-2026-0904",
      title: "Visual audit: ожидание подтверждения заказчика",
      category: category.elderlyCare,
      status: "waiting_client_confirmation",
      district: "Северный",
      date: "2026-08-04",
      timeFrom: "09:00",
      timeTo: "12:00",
      hours: 3,
      amount: 1200,
      packageName: "Помощь 3–4 часа",
      flags: { hasElderlyPerson: true, needsCooking: true },
      actions: ["help_with_food", "simple_cooking"]
    },
    {
      key: "visual-audit-waiting-performer-confirmation",
      number: "ZR-2026-0905",
      title: "Visual audit: ожидание подтверждения помощника",
      category: category.homeHelp,
      status: "waiting_performer_confirmation",
      district: "Центр",
      date: "2026-08-05",
      timeFrom: "11:00",
      timeTo: "13:00",
      hours: 2,
      amount: 950,
      packageName: "Бытовая помощь 2 часа",
      flags: { needsCleaning: true, hasPets: true },
      actions: ["light_cleaning", "bed_linen"]
    },
    {
      key: "visual-audit-in-work",
      number: "ZR-2026-0906",
      title: "Visual audit: заявка в работе",
      category: category.mobilityCare,
      status: "in_progress",
      district: "Южный",
      date: "2026-08-06",
      timeFrom: "08:00",
      timeTo: "11:00",
      hours: 3,
      amount: 1450,
      packageName: "Уход маломобильного",
      flags: { hasLimitedMobility: true, needsHygieneHelp: true, hasElderlyPerson: true },
      actions: ["hygiene_help", "movement_help", "help_with_food"],
      dependentState: ["limited_mobility", "hygiene_help"]
    },
    {
      key: "visual-audit-completed",
      number: "ZR-2026-0907",
      title: "Visual audit: выполненная заявка для отзыва",
      category: category.homeHelp,
      status: "completed",
      district: "Центр",
      date: "2026-07-10",
      timeFrom: "13:00",
      timeTo: "15:00",
      hours: 2,
      amount: 950,
      packageName: "Бытовая помощь 2 часа",
      flags: { needsCleaning: true, needsCooking: true },
      actions: ["light_cleaning", "simple_cooking"],
      completed: true
    },
    {
      key: "visual-audit-not-agreed",
      number: "ZR-2026-0908",
      title: "Visual audit: архивный чат не согласовано",
      category: category.companionship,
      status: "has_responses",
      district: "Центр",
      date: "2026-08-07",
      timeFrom: "17:00",
      timeTo: "19:00",
      hours: 2,
      amount: 800,
      packageName: "Присмотр 2 часа",
      flags: { hasElderlyPerson: true },
      actions: ["companionship"]
    },
    {
      key: "visual-audit-partial-match",
      number: "ZR-2026-0909",
      title: "Visual audit: частично подходящая заявка по готовке",
      category: category.cooking,
      status: "waiting_for_responses",
      district: "Центр",
      date: "2026-08-08",
      timeFrom: "16:00",
      timeTo: "18:00",
      hours: 2,
      amount: 850,
      packageName: "Бытовая помощь 2 часа",
      flags: { needsCooking: true },
      actions: ["simple_cooking"]
    },
    {
      key: "visual-audit-childcare-not-fit",
      number: "ZR-2026-0910",
      title: "Visual audit: заявка няни с требованием справки",
      category: category.childcare,
      status: "waiting_for_responses",
      district: "Центр",
      date: "2026-08-09",
      timeFrom: "18:00",
      timeTo: "21:00",
      hours: 3,
      amount: 1950,
      packageName: "Няня для ребёнка / Няня для малышей",
      flags: { hasChild: true },
      actions: ["childcare"],
      dependentAge: 5
    }
  ];

  const createdRequests = new Map<string, any>();
  const auditAddress = seedAddress(yugorsk);
  for (const item of requestData) {
    const request = await prisma.clientRequest.create({
      data: {
        seedKey: item.key,
        publicNumber: item.number,
        clientId: client.id,
        cityId: yugorsk.id,
        categoryId: item.category.id,
        contactName: client.displayName,
        contactPhone: client.phone,
        helpFor: item.flags.hasChild ? "child" : item.flags.hasLimitedMobility ? "limited_mobility" : item.flags.hasElderlyPerson ? "elderly" : "home_family",
        additionalActionsJson: JSON.stringify(item.actions),
        dependentStateJson: JSON.stringify(item.dependentState ?? []),
        dependentAge: item.dependentAge,
        scheduleType: "once",
        repeatedVisitsAllowed: item.key === "visual-audit-active-no-response",
        title: item.title,
        description: `${item.title}. Данные нужны только для визуального аудита экранов. Медицинские услуги не требуются.`,
        addressText: auditAddress.fullAddress,
        approximateAddressText: auditAddress.publicAddress,
        addressCity: auditAddress.addressCity,
        addressStreet: auditAddress.addressStreet,
        addressHouse: auditAddress.addressHouse,
        addressApartment: auditAddress.addressApartment,
        addressEntrance: auditAddress.addressEntrance,
        addressFloor: auditAddress.addressFloor,
        addressIntercom: auditAddress.addressIntercom,
        addressComment: auditAddress.addressComment,
        fullAddress: auditAddress.fullAddress,
        publicAddress: auditAddress.publicAddress,
        yandexPublicMapAddress: auditAddress.yandexPublicMapAddress,
        yandexExactMapAddress: auditAddress.yandexExactMapAddress,
        lat: 61.31,
        lng: 63.33,
        approximateLat: 61.31,
        approximateLng: 63.33,
        district: item.district,
        date: new Date(`${item.date}T00:00:00.000Z`),
        timeFrom: item.timeFrom,
        timeTo: item.timeTo,
        expectedDurationHours: item.hours,
        urgency: item.category.slug === "childcare" ? "urgent" : "normal",
        hasElderlyPerson: Boolean(item.flags.hasElderlyPerson),
        hasChild: Boolean(item.flags.hasChild),
        hasLimitedMobility: Boolean(item.flags.hasLimitedMobility),
        physicalHelpLevel: item.flags.hasLimitedMobility ? "умеренная" : null,
        needsCooking: Boolean(item.flags.needsCooking),
        needsCleaning: Boolean(item.flags.needsCleaning),
        needsWalk: Boolean(item.flags.needsWalk),
        needsHygieneHelp: Boolean(item.flags.needsHygieneHelp),
        hasPets: Boolean(item.flags.hasPets),
        budgetAmount: item.amount,
        priceEstimateAmount: item.amount,
        pricingBreakdownJson: JSON.stringify(pricingQuote(item.amount, item.packageName, item.hours)),
        comment: "Visual audit seed: не использовать как реальную заявку.",
        status: item.status,
        visibilityStatus: "city_visible",
        selectedPerformerId: ["in_progress", "completed"].includes(item.status) ? performer.id : null,
        completedAt: item.completed ? now : null,
        archivedAt: item.completed ? now : null
      }
    });
    createdRequests.set(item.key, request);
  }

  async function createResponseAndChat(input: {
    key: string;
    responseStatus: string;
    chatStatus?: string;
    clientConfirmed?: boolean;
    performerConfirmed?: boolean;
    archived?: boolean;
    messages?: Array<{ senderId?: string | null; text: string; isSystem?: boolean; moderationStatus?: string; isHidden?: boolean }>;
  }) {
    const request = createdRequests.get(input.key)!;
    const response = await prisma.requestResponse.create({
      data: {
        requestId: request.id,
        performerId: performer.id,
        message: "Visual audit: готова обсудить условия заявки.",
        status: input.responseStatus,
        acceptedAt: ["discussion", "accepted_by_client"].includes(input.responseStatus) ? now : null,
        notAgreedAt: input.responseStatus === "not_agreed" ? now : null
      }
    });
    if (!input.chatStatus) return { request, response, chat: null };
    const chat = await prisma.chat.create({
      data: {
        requestId: request.id,
        responseId: response.id,
        clientId: client.id,
        performerId: performer.id,
        status: input.chatStatus,
        clientConfirmedAt: input.clientConfirmed ? now : null,
        performerConfirmedAt: input.performerConfirmed ? now : null,
        conditionsJson: JSON.stringify({ agreedPaymentAmount: request.priceEstimateAmount, source: "visual-audit-seed" }),
        notAgreedAt: input.chatStatus === "not_agreed" ? now : null,
        closedAt: input.archived ? now : null,
        archivedAt: input.archived ? now : null
      }
    });
    await prisma.chatMessage.createMany({
      data: (input.messages ?? [
        { senderId: null, text: `Сервис «Забота Рядом»: чат по заявке ${request.publicNumber} открыт для визуального аудита.`, isSystem: true },
        { senderId: client.id, text: "Здравствуйте. Нужно согласовать дату, время и объём помощи." },
        { senderId: performer.id, text: "Здравствуйте. Готова обсудить условия и подтвердить визит." }
      ]).map((message) => ({
        chatId: chat.id,
        senderId: message.senderId ?? null,
        text: message.text,
        isSystem: Boolean(message.isSystem),
        moderationStatus: message.moderationStatus ?? "clean",
        isHidden: Boolean(message.isHidden)
      }))
    });
    return { request, response, chat };
  }

  await createResponseAndChat({ key: "visual-audit-with-response", responseStatus: "pending" });
  const openChat = await createResponseAndChat({ key: "visual-audit-open-chat", responseStatus: "discussion", chatStatus: "open" });
  await createResponseAndChat({
    key: "visual-audit-waiting-client-confirmation",
    responseStatus: "discussion",
    chatStatus: "waiting_client_confirmation",
    performerConfirmed: true
  });
  await createResponseAndChat({
    key: "visual-audit-waiting-performer-confirmation",
    responseStatus: "discussion",
    chatStatus: "waiting_performer_confirmation",
    clientConfirmed: true
  });
  const inWorkChat = await createResponseAndChat({
    key: "visual-audit-in-work",
    responseStatus: "accepted_by_client",
    chatStatus: "in_work",
    clientConfirmed: true,
    performerConfirmed: true,
    messages: [
      { senderId: null, text: "Сервис «Забота Рядом»: заявка перешла в работу. Сервисный сбор списан.", isSystem: true },
      { senderId: client.id, text: "Сообщение скрыто, потому что содержит контактные данные.", moderationStatus: "flagged", isHidden: true },
      { senderId: performer.id, text: "Приняла условия, буду на месте к назначенному времени." }
    ]
  });
  await createResponseAndChat({
    key: "visual-audit-completed",
    responseStatus: "accepted_by_client",
    chatStatus: "completed",
    clientConfirmed: true,
    performerConfirmed: true,
    archived: true
  });
  await createResponseAndChat({
    key: "visual-audit-not-agreed",
    responseStatus: "not_agreed",
    chatStatus: "not_agreed",
    archived: true,
    messages: [
      { senderId: null, text: "Условия не согласованы. Чат перенесён в архив, заявка остаётся доступной.", isSystem: true },
      { senderId: performer.id, text: "Готова предложить новые условия позже." }
    ]
  });

  await prisma.performerDocument.createMany({
    data: [
      {
        performerId: performer.id,
        type: "self_employed",
        fileName: "visual-audit-self-employed.pdf",
        fileUrl: "/uploads/visual-audit-self-employed.pdf",
        status: "verified",
        uploadedAt: new Date("2026-07-01T08:00:00.000Z"),
        verifiedAt: new Date("2026-07-02T08:00:00.000Z"),
        adminComment: "Visual audit seed"
      },
      {
        performerId: performer.id,
        type: "criminal_record",
        fileName: "visual-audit-criminal-record.pdf",
        fileUrl: "/uploads/visual-audit-criminal-record.pdf",
        status: "uploaded",
        uploadedAt: new Date("2026-07-03T08:00:00.000Z"),
        adminComment: "Visual audit seed"
      }
    ]
  });

  await prisma.complaint.createMany({
    data: [
      {
        publicNumber: "SUP-2026-0901",
        type: "question",
        requestId: openChat.request.id,
        chatId: openChat.chat?.id,
        fromUserId: client.id,
        againstUserId: performer.id,
        reason: "Visual audit: вопрос по заявке",
        description: "Проверка экрана связи с администратором.",
        status: "in_progress",
        adminComment: "Администратор взял обращение в работу.",
        adminResponse: "Мы проверяем ситуацию и вернёмся с ответом.",
        isVisibleToUser: true
      },
      {
        publicNumber: "SUP-2026-0902",
        type: "suggestion",
        requestId: inWorkChat.request.id,
        chatId: inWorkChat.chat?.id,
        fromUserId: performer.id,
        againstUserId: client.id,
        reason: "Visual audit: предложение помощника",
        description: "Проверка обращения помощника к администратору.",
        status: "new",
        adminComment: "Нужно проверить после аудита.",
        isVisibleToUser: true
      }
    ]
  });

  const completedRequest = createdRequests.get("visual-audit-completed")!;
  await prisma.review.upsert({
    where: {
      requestId_fromUserId_toUserId: {
        requestId: completedRequest.id,
        fromUserId: performer.id,
        toUserId: client.id
      }
    },
    update: {
      rating: 5,
      text: "Visual audit: заказчик подробно описал условия.",
      likedText: "Понятное время и адрес.",
      improvementText: "Нет замечаний."
    },
    create: {
      requestId: completedRequest.id,
      fromUserId: performer.id,
      toUserId: client.id,
      rating: 5,
      text: "Visual audit: заказчик подробно описал условия.",
      likedText: "Понятное время и адрес.",
      improvementText: "Нет замечаний."
    }
  });

  await prisma.balanceTransaction.createMany({
    data: [
      {
        userId: client.id,
        type: "top_up",
        amount: 500,
        balanceKind: "real",
        reason: "Visual audit: основное пополнение заказчика",
        comment: "Visual audit seed",
        balanceBefore: 0,
        balanceAfter: 500
      },
      {
        userId: client.id,
        type: "admin_bonus",
        amount: 200,
        balanceKind: "bonus",
        reason: "Visual audit: бонус заказчика",
        comment: "Visual audit seed",
        balanceBefore: 0,
        balanceAfter: 200,
        createdByAdminId: admin.id
      },
      {
        userId: client.id,
        type: "client_service_fee",
        amount: -50,
        balanceKind: "bonus",
        reason: "Visual audit: сервисный сбор заказчика",
        comment: "Visual audit seed",
        balanceBefore: 200,
        balanceAfter: 150,
        relatedRequestId: inWorkChat.request.id
      },
      {
        userId: performer.id,
        type: "top_up",
        amount: 300,
        balanceKind: "real",
        reason: "Visual audit: основное пополнение помощника",
        comment: "Visual audit seed",
        balanceBefore: 0,
        balanceAfter: 300
      },
      {
        userId: performer.id,
        type: "admin_bonus",
        amount: 150,
        balanceKind: "bonus",
        reason: "Visual audit: бонус помощника",
        comment: "Visual audit seed",
        balanceBefore: 0,
        balanceAfter: 150,
        createdByAdminId: admin.id
      },
      {
        userId: performer.id,
        type: "performer_service_fee",
        amount: -50,
        balanceKind: "bonus",
        reason: "Visual audit: сервисный сбор помощника",
        comment: "Visual audit seed",
        balanceBefore: 150,
        balanceAfter: 100,
        relatedRequestId: inWorkChat.request.id
      }
    ]
  });

  await prisma.userRiskFlag.create({
    data: {
      userId: performer.id,
      type: "chat_contact_attempt",
      severity: "medium",
      reason: "Visual audit: флагованное сообщение в чате"
    }
  });

  await prisma.auditLog.createMany({
    data: [
      {
        actorUserId: admin.id,
        action: "visual_audit.seed.requests",
        entityType: "request",
        payloadJson: JSON.stringify({ requestNumbers: requestData.map((item) => item.number) })
      },
      {
        actorUserId: admin.id,
        action: "visual_audit.seed.chats",
        entityType: "chat",
        payloadJson: JSON.stringify({ note: "Seeded chats for visual audit" })
      }
    ]
  });

  const sovetskyAuditAddress = seedAddress(sovetsky);
  await prisma.clientRequest.create({
    data: {
      seedKey: "visual-audit-sovetsky-erand-other-city",
      publicNumber: "ZR-2026-0911",
      clientId: client.id,
      cityId: sovetsky.id,
      categoryId: category.errands.id,
      title: "Visual audit: заявка в другом городе",
      description: "Заявка нужна для административного списка городов и счётчика заявок.",
      addressText: sovetskyAuditAddress.fullAddress,
      approximateAddressText: sovetskyAuditAddress.publicAddress,
      addressCity: sovetskyAuditAddress.addressCity,
      addressStreet: sovetskyAuditAddress.addressStreet,
      addressHouse: sovetskyAuditAddress.addressHouse,
      addressApartment: sovetskyAuditAddress.addressApartment,
      addressEntrance: sovetskyAuditAddress.addressEntrance,
      addressFloor: sovetskyAuditAddress.addressFloor,
      addressIntercom: sovetskyAuditAddress.addressIntercom,
      addressComment: sovetskyAuditAddress.addressComment,
      fullAddress: sovetskyAuditAddress.fullAddress,
      publicAddress: sovetskyAuditAddress.publicAddress,
      yandexPublicMapAddress: sovetskyAuditAddress.yandexPublicMapAddress,
      yandexExactMapAddress: sovetskyAuditAddress.yandexExactMapAddress,
      district: "Советский",
      date: new Date("2026-08-10T00:00:00.000Z"),
      timeFrom: "10:00",
      timeTo: "11:00",
      expectedDurationHours: 1,
      budgetAmount: 500,
      priceEstimateAmount: 500,
      pricingBreakdownJson: JSON.stringify(pricingQuote(500, "Короткая помощь", 1)),
      status: "waiting_for_responses",
      visibilityStatus: "city_visible"
    }
  });
}

function pricingQuote(performerPaymentAmount: number, packageName: string, billableHours: number) {
  const packageMeta = seededPackageMeta(packageName);
  return {
    performerPaymentAmount,
    clientServiceFeeAmount: 50,
    clientTotalExpense: performerPaymentAmount + 50,
    performerServiceFeeAmount: 50,
    performerCommissionAmount: 50,
    performerNetAmount: performerPaymentAmount - 50,
    serviceMarginAmount: 100,
    packageId: packageMeta.id,
    packageTitle: packageName,
    packageLabel: packageName,
    packageName,
    packagePriceMin: packageMeta.min,
    packagePriceMax: packageMeta.max,
    packageDescription: "Пакет подобран для проверки отображения.",
    billableHours,
    included: ["согласованный объём помощи", "общение в чате", "без медицинских процедур"],
    excluded: ["медицинские процедуры", "передача контактов до согласования"],
    increaseFactors: ["изменение длительности", "увеличение объёма помощи"],
    additions: [],
    clientExplanation: `Рекомендуемая оплата помощнику ${performerPaymentAmount} ₽. Сервисный сбор заказчика 50 ₽. Ориентировочные общие расходы ${performerPaymentAmount + 50} ₽.`,
    performerExplanation: `Рекомендуемая оплата за визит ${performerPaymentAmount} ₽. Сервисный сбор помощника 50 ₽. Ориентировочный доход после сервисного сбора ${performerPaymentAmount - 50} ₽.`
  };
}

function seededPackageMeta(packageName: string) {
  if (packageName === "Короткая помощь") return { id: "short_help", min: 400, max: 700 };
  if (packageName === "Присмотр 2 часа") return { id: "supervision_2h", min: 700, max: 1200 };
  if (packageName === "Сопровождение стандарт") return { id: "accompaniment_standard", min: 800, max: 1500 };
  if (packageName === "Помощь 3–4 часа") return { id: "help_3_4h", min: 1200, max: 2000 };
  if (packageName === "Регулярная помощь") return { id: "regular_help", min: 700, max: null };
  return { id: "home_help_2h", min: 700, max: 1100 };
}

function seedAddress(city: City) {
  const parts = normalizeAddressParts({
    city: city.name,
    street: "ул. Мира",
    house: "10",
    apartment: "15",
    entrance: "2",
    floor: "3",
    intercom: "15",
    addressComment: "вход со двора"
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

async function upsertUser(input: {
  role: UserRole;
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
      phone: normalizedPhone,
      normalizedPhone,
      rolesJson: JSON.stringify([input.role]),
      displayName: input.displayName,
      cityId: input.cityId,
      status: "active",
      balance: input.balance,
      bonusBalance: input.bonusBalance,
      isPhoneVerified: true,
      isEmailVerified: true,
      phoneVerifiedAt: verifiedAt,
      emailVerifiedAt: verifiedAt
    },
    create: {
      role: input.role,
      rolesJson: JSON.stringify([input.role]),
      email: input.email,
      phone: normalizedPhone,
      normalizedPhone,
      displayName: input.displayName,
      cityId: input.cityId,
      passwordHash: input.passwordHash,
      status: "active",
      balance: input.balance,
      bonusBalance: input.bonusBalance,
      isPhoneVerified: true,
      isEmailVerified: true,
      phoneVerifiedAt: verifiedAt,
      emailVerifiedAt: verifiedAt
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

async function seedUserLegalConsents(userId: string, role: "client" | "performer") {
  await acceptLatestLegalDocuments({
    userId,
    documentTypes: [
      ...requiredDocumentTypesForRegistration(role),
      ...(role === "performer" ? ["helper_documents_consent"] : []),
      "marketing_notifications_consent"
    ],
    source: "seed",
    client: prisma
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
