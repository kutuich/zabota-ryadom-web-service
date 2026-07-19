import type { ServiceCategory } from "@prisma/client";

export type PricingInput = {
  category: Pick<
    ServiceCategory,
    | "slug"
    | "name"
    | "basePrice"
    | "calculationUnit"
    | "minDurationHours"
    | "includedJson"
    | "excludedJson"
    | "clientInstructions"
    | "performerInstructions"
  >;
  city?: string;
  helpFor?: string | null;
  selectedActions?: string[];
  extraActions?: string[];
  additionalActions?: string[];
  dependentState?: string[];
  hygieneLevel?: HygieneLevelId | string | null;
  physicalLoadLevel?: PhysicalLevelId | string | null;
  physicalHelpLevel?: string | null;
  careState?: string | null;
  age?: number | null;
  dependentAge?: number | null;
  scheduleType?: string | null;
  date?: string | Date | null;
  time?: string | null;
  timeFrom?: string | null;
  durationHours?: number | null;
  expectedDurationHours?: number | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  weeklyPattern?: unknown;
  taskVolumeLevel?: TaskVolumeLevelId | string | null;
  urgencyFlags?: string[];
  address?: string | null;
  isRemoteAddress?: boolean;
  transportOption?: string | null;
  mobilityFlags?: {
    limitedMobility?: boolean;
    bedridden?: boolean;
    fallRisk?: boolean;
    wheelchair?: boolean;
    bigWeight?: boolean;
    cognitiveFeatures?: boolean;
    transferHelp?: boolean;
    positionChange?: boolean;
  };
  cookingFlags?: Record<string, boolean>;
  escortFlags?: Record<string, boolean>;
  childcareFlags?: Record<string, boolean>;
  adminManualPackage?: string | null;
  adminManualAdjustment?: number | null;
  urgency?: string;
  hasLimitedMobility?: boolean;
  needsCooking?: boolean;
  needsCleaning?: boolean;
  needsWalk?: boolean;
  needsHygieneHelp?: boolean;
  hasPets?: boolean;
  isRegular?: boolean;
  clientServiceFeeAmount?: number;
  performerServiceFeeAmount?: number;
  performerCommissionAmount?: number;
};

export type PricingAction = {
  id: string;
  group: string;
  title: string;
  shortDescription: string;
  includes: string[];
  helperSteps: string[];
  notIncluded: string[];
  safetyNotes: string[];
  pricingRole: "included" | "package_factor" | "paid_addon" | "schedule_specific";
  affectsPackageRecommendation: boolean;
  affectsPrice: boolean;
  coveredBy: string[];
};

export type PricingResult = {
  basePrice: number;
  durationHours: number;
  billableHours: number;
  calculationUnit: string;
  packageId: string;
  packageLabel: string;
  packageShortLabel: string;
  packageName: string;
  packageDescription: string;
  careLevel: string | null;
  careLevelLabel: string | null;
  visitFormat: string;
  workerPayment: number;
  clientServiceFee: number;
  performerServiceFee: number;
  clientTotal: number;
  performerNet: number;
  serviceMargin: number;
  recommendationReasons: string[];
  warnings: string[];
  includedActions: string[];
  notIncluded: string[];
  requiredConfirmations: string[];
  isManualReviewRequired: boolean;
  period: {
    visitsCount: number;
    totalHours: number;
    clientTotal: number;
    workerPayment: number;
    clientServiceFeeTotal: number;
    performerServiceFeeTotal: number;
    performerNetTotal: number;
    serviceMarginTotal: number;
  };
  additions: Array<{ label: string; amount: number; appliesTo: "performer" | "client_total" }>;
  included: string[];
  excluded: string[];
  performerPaymentAmount: number;
  clientServiceFeeAmount: number;
  performerServiceFeeAmount: number;
  performerCommissionAmount: number;
  clientTotalExpense: number;
  performerNetAmount: number;
  total: number;
  explanation: string;
  clientExplanation: string;
  performerExplanation: string;
  increaseFactors: string[];
  forbidden: string[];
};

type HygieneLevelId = keyof typeof HYGIENE_LEVELS;
type PhysicalLevelId = keyof typeof PHYSICAL_LEVELS;
type TaskVolumeLevelId = keyof typeof TASK_VOLUME_OPTIONS;

type PackagePreset = {
  id: string;
  label: string;
  shortLabel: string;
  baseWorkerPayment: number;
  minHours: number;
  calculationUnit: "visit" | "hour";
  included: string[];
  notIncluded: string[];
  extraHourAmount?: number;
  careLevel?: keyof typeof CARE_LEVELS;
};

type NormalizedPricingInput = {
  categorySlug: string;
  categoryName: string;
  durationHours: number;
  scheduleType: string;
  urgency: string;
  date?: Date | null;
  time?: string | null;
  selectedActions: Set<string>;
  dependentState: Set<string>;
  hygieneLevel: HygieneLevelId;
  physicalLoadLevel: PhysicalLevelId;
  taskVolumeLevel: TaskVolumeLevelId;
  isRemoteAddress: boolean;
  hasPets: boolean;
  mobilityFlags: Required<NonNullable<PricingInput["mobilityFlags"]>>;
  urgencyFlags: Set<string>;
};

const CLIENT_SERVICE_FEE = 50;
const PERFORMER_SERVICE_FEE = 50;
const SIMPLE_MEAL_ADDON = 200;
const SURCHARGE_CAP = 500;

export const forbiddenMedical = [
  "инъекции",
  "капельницы",
  "перевязки",
  "лечение",
  "диагностика",
  "назначение лекарств",
  "медицинский контроль лекарств",
  "медицинские процедуры"
];

export const HYGIENE_LEVELS = {
  none: { label: "Нет гигиенической помощи", rank: 0 },
  hygieneLight: { label: "Лёгкая гигиена", rank: 1 },
  hygieneHousehold: { label: "Бытовая гигиеническая помощь", rank: 2 },
  hygieneIntimate: { label: "Интимная гигиена / подмывание", rank: 3 }
} as const;

export const PHYSICAL_LEVELS = {
  none: { label: "Нет физической помощи", rank: 0 },
  physicalLight: { label: "Лёгкая физическая поддержка", rank: 1 },
  physicalMedium: { label: "Средняя физическая помощь", rank: 2 },
  physicalHeavy: { label: "Тяжёлая физическая помощь", rank: 3 }
} as const;

export const TASK_VOLUME_OPTIONS = {
  minimal: { label: "Минимальный", adjustment: -150 },
  basic: { label: "Базовый", adjustment: 0 },
  extended: { label: "Расширенный", adjustment: 150 },
  manual: { label: "Требуется ручная корректировка", adjustment: 0 }
} as const;

export const CARE_LEVELS = {
  careVisit: { label: "Уходовый визит", rates: { 1: 500, 2: 1000, 3: 1350, 4: 1700 } },
  advancedCareVisit: { label: "Уходовый повышенный", rates: { 1: 575, 2: 1150, 3: 1550, 4: 1950 } },
  complexCareVisit: { label: "Сложный уходовый", rates: { 1: 625, 2: 1250, 3: 1700, 4: 2150 } },
  heavyCareVisit: { label: "Тяжёлый уходовый", rates: { 1: 650, 2: 1300, 3: 1800, 4: 2300 } }
} as const;

export const SURCHARGES = {
  urgent: { label: "Срочно сегодня/завтра", amount: 200 },
  evening: { label: "Вечер после 18:00", amount: 200 },
  weekend: { label: "Выходной", amount: 200 },
  holiday: { label: "Праздник", amount: 400 }
} as const;

export const TRANSPORT_OPTIONS = {
  city: { label: "В пределах города", warning: "" },
  separate: {
    label: "Удалённый адрес / СНТ / дача",
    warning: "Транспорт для СНТ, дач и удалённых адресов рассчитывается отдельно по договорённости."
  }
} as const;

export const PACKAGES: Record<string, PackagePreset> = {
  shortVisit: preset("shortVisit", "Короткий визит", "Короткий визит", 500, 1, [
    "простые бытовые действия",
    "понятный небольшой объём помощи"
  ], ["медицинские услуги", "тяжёлый уход", "большой объём бытовых задач"], 300),
  householdVisit: preset("householdVisit", "Стандартный бытовой визит", "Бытовой визит", 950, 2, [
    "лёгкая уборка",
    "стирка, бельё или глажка в согласованном объёме",
    "простая бытовая помощь"
  ], ["уход за телом человека", "тяжёлый физический труд", "медицинские услуги"], 300),
  careVisit: preset("careVisit", "Уходовый визит", "Уходовый", 1000, 2, [
    "присмотр и общение",
    "помощь с едой",
    "лёгкая бытовая гигиена"
  ], ["тяжёлое перемещение", "регулярная интимная гигиена", "медицинские процедуры"], 400, "careVisit"),
  advancedCareVisit: preset("advancedCareVisit", "Уходовый повышенный", "Повышенный уход", 1150, 2, [
    "помощь с туалетом или подгузником в бытовом объёме",
    "подмывание в согласованном объёме",
    "помощь с пересаживанием при безопасных условиях"
  ], ["лечение пролежней", "катетеры и стомы", "медицинские процедуры"], 450, "advancedCareVisit"),
  complexCareVisit: preset("complexCareVisit", "Сложный уходовый", "Сложный уход", 1250, 2, [
    "несколько факторов ухода",
    "интимная гигиена или выраженная маломобильность",
    "согласованный уходовый объём"
  ], ["подъём на руках", "работа двух помощников без отдельного согласования", "медицинские процедуры"], 550, "complexCareVisit"),
  heavyCareVisit: preset("heavyCareVisit", "Тяжёлый уходовый", "Тяжёлый уход", 1300, 2, [
    "помощь лежачему или почти лежачему человеку",
    "смена положения тела в бытовом объёме",
    "сложная бытовая гигиена"
  ], ["подъём на руках без безопасных условий", "медицинские процедуры"], 600, "heavyCareVisit"),
  escortRegular: preset("escortRegular", "Обычное сопровождение", "Сопровождение", 600, 2, [
    "магазин, аптека, МФЦ, банк, почта",
    "поликлиника без медицинских услуг",
    "помощь вызвать такси"
  ], ["подписание документов вместо заказчика", "финансовые операции вместо заказчика", "медицинское сопровождение"], 300),
  escortLimitedMobility: preset("escortLimitedMobility", "Сопровождение с ограниченной мобильностью", "Сопровождение с поддержкой", 800, 2, [
    "поддержка при ходьбе",
    "ожидание рядом",
    "помощь с верхней одеждой"
  ], ["перенос человека на руках", "медицинское сопровождение"], 400),
  escortWheelchairAccessible: preset("escortWheelchairAccessible", "Сопровождение на коляске при доступной среде", "Сопровождение на коляске", 700, 2, [
    "маршрут с доступной средой",
    "сопровождение рядом",
    "помощь с дверями и лифтом"
  ], ["перенос коляски по лестнице", "медицинское сопровождение"], 400),
  simpleCookingVisit: preset("simpleCookingVisit", "Простая готовка", "Простая готовка", 850, 1, [
    "простая домашняя еда",
    "порядок на рабочей поверхности",
    "простая посуда после готовки"
  ], ["лечебное питание", "полноценная готовка на 1-2 дня"], 300),
  fullCookingVisit: preset("fullCookingVisit", "Полноценная готовка", "Полная готовка", 1300, 2, [
    "домашняя еда на 1-2 дня",
    "посуда после готовки",
    "порядок на кухне"
  ], ["лечебное питание", "сложное праздничное меню"], 350),
  longSupervision3h: preset("longSupervision3h", "Длительный присмотр", "Длительный присмотр", 900, 3, [
    "присмотр на несколько часов",
    "общение",
    "бытовой контроль безопасности"
  ], ["гигиена тела", "помощь с туалетом", "медицинские услуги"], 300)
};

export const ACTION_GUIDE: Record<string, PricingAction> = {
  hygieneLight: action("hygieneLight", "Гигиена", "Лёгкая гигиена", "Помочь выполнить простые гигиенические действия без интимной зоны.", ["помочь умыться", "помочь расчесаться", "подготовить полотенце"], ["действовать спокойно", "спрашивать согласие перед действием"], ["медицинские процедуры", "обработка ран"], ["если требуется медицинская помощь, остановиться и сообщить заказчику"], "package_factor", true, false, ["hygieneHousehold", "hygieneIntimate"]),
  hygieneHousehold: action("hygieneHousehold", "Гигиена", "Бытовая гигиеническая помощь", "Более активная помощь с обычной бытовой гигиеной.", ["помочь умыться", "помочь сменить домашнюю одежду", "убрать использованные материалы"], ["сохранять уважительный тон", "согласовать усложнение задачи"], ["интимная гигиена, если она не выбрана", "медицинские процедуры"], [], "package_factor", true, false, ["hygieneIntimate"]),
  hygieneIntimate: action("hygieneIntimate", "Гигиена", "Интимная гигиена / подмывание", "Деликатная помощь, связанная с интимной зоной или уходом после туалета.", ["подготовить воду, полотенце, перчатки", "помочь с подмыванием", "убрать расходные материалы"], ["соблюдать приватность", "не выполнять несогласованные действия"], ["обработка пролежней", "применение лекарств", "медицинские процедуры"], ["интимная помощь выполняется только в согласованном объёме"], "package_factor", true, false, []),
  toiletHelp: action("toiletHelp", "Гигиена", "Помощь с туалетом", "Помочь безопасно дойти до туалета и привести одежду в порядок.", ["сопроводить до туалета", "подать салфетки или воду"], ["соблюдать приватность", "не торопить человека"], ["медицинские процедуры"], [], "package_factor", true, false, []),
  diaper: action("diaper", "Гигиена", "Подгузник / памперс", "Помощь с бытовой заменой подгузника в согласованном уходовом визите.", ["подготовить расходные материалы", "помочь с заменой", "убрать использованные материалы"], ["действовать деликатно", "при раздражении кожи сообщить заказчику"], ["лечение раздражения", "обработка ран"], ["Подгузник сам по себе не считается отдельной услугой, но влияет на уровень ухода и может повысить формат визита."], "package_factor", true, false, []),
  commode: action("commode", "Гигиена", "Кресло-туалет", "Помощь с использованием кресла-туалета без подъёма человека на руках.", ["подготовить кресло-туалет", "помочь безопасно воспользоваться"], ["оценить безопасность перемещения"], ["подъём на руках", "медицинский уход"], [], "package_factor", true, false, []),
  heatServeFood: action("heatServeFood", "Питание", "Разогреть / подать еду", "Разогреть готовую еду, подать воду, чай или тарелку.", ["разогреть еду", "подать напиток", "убрать посуду в согласованном объёме"], ["уточнить, какую еду можно подать"], ["лечебное питание", "контроль лекарств"], [], "included", false, false, []),
  mealControl: action("mealControl", "Питание", "Контроль питания", "Напомнить о еде и воде в бытовом смысле.", ["напомнить о приёме пищи", "подать воду", "сообщить, если человек отказывается есть"], ["не заставлять есть", "не менять рацион без согласования"], ["медицинский контроль питания", "назначение диеты"], [], "package_factor", true, false, []),
  feedingHelp: action("feedingHelp", "Питание", "Помощь при приёме пищи", "Помочь человеку поесть без медицинских манипуляций.", ["помочь удобно устроиться", "подать ложку или чашку"], ["не торопить", "при ухудшении остановиться"], ["зондовое питание", "медицинский контроль глотания"], [], "package_factor", true, false, []),
  simpleMealWithinVisit: action("simpleMealWithinVisit", "Питание", "Простая еда в рамках визита", "Приготовить простую еду в рамках согласованного визита.", ["сварить кашу", "сделать чай", "приготовить бутерброды"], ["согласовать простое блюдо", "оставить кухню в порядке"], ["полноценная готовка на 1-2 дня", "большая закупка продуктов"], ["Простая еда в рамках визита добавляет 200 ₽ к оплате помощнику, если согласована дополнительно."], "paid_addon", true, true, []),
  physicalLight: action("physicalLight", "Физическая помощь", "Лёгкая физическая поддержка", "Человек двигается сам, но нужна рука или страховка рядом.", ["поддержать за руку", "быть рядом при передвижении"], ["не тянуть человека", "при риске падения остановиться"], ["пересаживание", "подъём на руках"], [], "package_factor", true, false, ["physicalMedium", "physicalHeavy"]),
  physicalMedium: action("physicalMedium", "Физическая помощь", "Средняя физическая помощь", "Заметная помощь при вставании, пересаживании или перемещении.", ["помочь встать", "помочь пересесть при участии человека"], ["оценить безопасность", "не выполнять опасный подъём"], ["подъём человека на руках"], [], "package_factor", true, false, ["physicalHeavy"]),
  physicalHeavy: action("physicalHeavy", "Физическая помощь", "Тяжёлая физическая помощь", "Высокая физическая нагрузка или риск небезопасного перемещения.", ["помочь изменить положение при безопасных условиях", "поддержать при выраженной слабости"], ["остановиться при риске падения", "запросить согласование администратора"], ["подъём на руках", "работа одного помощника при небезопасных условиях"], ["Есть признаки тяжёлого ухода. Администратор должен подтвердить, что задача выполнима одним помощником."], "package_factor", true, false, []),
  transferHelp: action("transferHelp", "Физическая помощь", "Пересаживание", "Помощь пересесть при участии человека и безопасных условиях.", ["помочь пересесть", "страховать движение"], ["заранее согласовать условия"], ["подъём на руках"], [], "package_factor", true, false, []),
  positionChange: action("positionChange", "Физическая помощь", "Смена положения тела", "Помощь изменить положение в бытовом объёме.", ["помочь повернуться", "поправить подушки"], ["не выполнять опасный подъём"], ["медицинский уход", "лечение пролежней"], [], "package_factor", true, false, []),
  lightCleaning: action("lightCleaning", "Помощь по дому", "Лёгкая уборка", "Небольшой бытовой объём в рамках визита.", ["протереть поверхности", "подмести или пропылесосить в согласованной зоне"], ["согласовать объём заранее"], ["генеральная уборка", "мытьё окон"], [], "package_factor", true, false, []),
  laundry: action("laundry", "Помощь по дому", "Стирка", "Запустить стирку или развесить бельё в согласованном объёме.", ["запустить стиральную машину", "развесить бельё"], ["уточнить режим стирки"], ["химчистка", "большой объём без согласования"], [], "package_factor", true, false, []),
  ironing: action("ironing", "Помощь по дому", "Глажка", "Погладить небольшое количество вещей.", ["погладить согласованные вещи"], ["проверить материал и режим"], ["сложные ткани без указаний"], [], "package_factor", true, false, []),
  bedLinenChange: action("bedLinenChange", "Помощь по дому", "Смена постельного белья", "Смена постельного в бытовом объёме.", ["снять старое бельё", "застелить чистое"], ["не выполнять физически опасные действия"], ["смена белья лежачему человеку без ухода"], [], "package_factor", true, false, []),
  communication: action("communication", "Присмотр и общение", "Присмотр и общение", "Побыть рядом, поговорить, проследить за бытовой безопасностью.", ["общение", "бытовой контроль безопасности"], ["не спорить и не давить"], ["медицинское наблюдение"], [], "package_factor", true, false, []),
  escortRegularAction: action("escortRegularAction", "Сопровождение", "Сопровождение", "Сопроводить по делам без медицинских услуг.", ["помочь добраться", "дождаться рядом"], ["согласовать маршрут и время"], ["медицинское сопровождение"], [], "package_factor", true, false, []),
  escortWalk: action("escortWalk", "Сопровождение", "Прогулка", "Спокойная прогулка рядом.", ["согласованный маршрут", "нахождение рядом"], ["учитывать погоду и самочувствие"], ["медицинская реабилитация"], [], "package_factor", true, false, []),
  errands: action("errands", "Сопровождение", "Покупки / поручения", "Выполнить бытовое поручение или закупку.", ["магазин, аптека, почта", "передать чек"], ["согласовать список и деньги"], ["финансовые операции вместо заказчика"], [], "package_factor", true, false, []),
  simpleCookingVisit: action("simpleCookingVisit", "Готовка", "Простая готовка отдельным визитом", "Простая домашняя еда отдельным визитом.", ["приготовить простое блюдо", "оставить кухню в порядке"], ["согласовать список блюд"], ["уходовые задачи", "полноценная готовка на несколько дней"], [], "schedule_specific", true, false, []),
  fullCookingVisit: action("fullCookingVisit", "Готовка", "Полноценная готовка", "Готовка домашней еды на 1-2 дня.", ["приготовить домашнюю еду", "помыть посуду после готовки"], ["уточнить меню и продукты"], ["лечебное питание", "медицинские назначения"], [], "schedule_specific", true, false, [])
};

const ACTION_ALIASES: Record<string, string> = {
  light_cleaning: "lightCleaning",
  laundry: "laundry",
  ironing: "ironing",
  bed_linen: "bedLinenChange",
  simple_cooking: "simpleMealWithinVisit",
  full_cooking: "fullCookingVisit",
  food_help: "feedingHelp",
  clothes_help: "physicalLight",
  wash_help: "hygieneLight",
  toilet_help: "toiletHelp",
  diaper_change: "diaper",
  washing: "hygieneIntimate",
  movement_help: "transferHelp",
  escort: "escortRegularAction",
  walk: "escortWalk",
  errands: "errands",
  companionship: "communication",
  hygiene: "hygieneHousehold",
  diaper_help: "diaper",
  limited_mobility: "physicalMedium",
  fall_risk: "physicalLight",
  bedridden: "positionChange"
};

export function calculatePrice(input: PricingInput): PricingResult {
  const normalized = normalizePricingInput(input);
  const recommendation = recommendPackage(input);
  const selectedPackage = PACKAGES[input.adminManualPackage ?? recommendation.recommendedPackageId] ?? PACKAGES[recommendation.recommendedPackageId];
  const clientServiceFeeAmount = input.clientServiceFeeAmount ?? CLIENT_SERVICE_FEE;
  const performerServiceFeeAmount = input.performerServiceFeeAmount ?? input.performerCommissionAmount ?? PERFORMER_SERVICE_FEE;
  const billableHours = selectedPackage.careLevel
    ? clampCareHours(normalized.durationHours)
    : Math.max(normalized.durationHours, selectedPackage.minHours);
  const additions: Array<{ label: string; amount: number; appliesTo: "performer" | "client_total" }> = [];
  const requiredConfirmations: string[] = [...recommendation.requiredConfirmations];
  let manualReviewRequired = recommendation.manualReviewRequired;

  const baseWorkerPayment = selectedPackage.careLevel
    ? CARE_LEVELS[selectedPackage.careLevel].rates[billableHours as 1 | 2 | 3 | 4]
    : selectedPackage.baseWorkerPayment;
  let workerPayment = baseWorkerPayment;

  if (!selectedPackage.careLevel) {
    const volume = TASK_VOLUME_OPTIONS[normalized.taskVolumeLevel];
    if (volume.adjustment !== 0) {
      workerPayment = Math.max(0, workerPayment + volume.adjustment);
      additions.push({ label: `Объём задач: ${volume.label}`, amount: volume.adjustment, appliesTo: "performer" });
    }
    if (normalized.taskVolumeLevel === "manual") {
      manualReviewRequired = true;
      requiredConfirmations.push("Объём задач требует ручной корректировки администратором.");
    }
  }

  if (normalized.selectedActions.has("simpleMealWithinVisit") && selectedPackage.id !== "simpleCookingVisit" && selectedPackage.id !== "fullCookingVisit") {
    workerPayment += SIMPLE_MEAL_ADDON;
    additions.push({ label: "Простая еда в рамках визита", amount: SIMPLE_MEAL_ADDON, appliesTo: "performer" });
  }

  const extraHours = selectedPackage.careLevel ? 0 : Math.max(0, Math.ceil(billableHours - selectedPackage.minHours));
  if (extraHours > 0 && selectedPackage.extraHourAmount) {
    const amount = extraHours * selectedPackage.extraHourAmount;
    workerPayment += amount;
    additions.push({ label: `Дополнительное время: ${extraHours} ч`, amount, appliesTo: "performer" });
  }

  const surcharges = calculateSurcharges(normalized);
  if (surcharges.total > 0) {
    workerPayment += surcharges.total;
    additions.push(...surcharges.items.map((item) => ({ label: item.label, amount: item.amount, appliesTo: "performer" as const })));
  }
  if (surcharges.uncappedTotal > SURCHARGE_CAP) {
    manualReviewRequired = true;
    requiredConfirmations.push("Автоматические надбавки превысили 500 ₽. Остальное нужно подтвердить администратору.");
  }

  if (typeof input.adminManualAdjustment === "number" && Number.isFinite(input.adminManualAdjustment)) {
    workerPayment = Math.max(0, workerPayment + input.adminManualAdjustment);
    additions.push({ label: "Ручная корректировка администратора", amount: input.adminManualAdjustment, appliesTo: "performer" });
  }

  const warnings = mergeUnique(recommendation.warnings, surcharges.warnings);
  if (normalized.hasPets) {
    warnings.push("Есть домашние животные. Условия нужно согласовать в чате до начала визита.");
  }
  if (normalized.isRemoteAddress) {
    warnings.push(TRANSPORT_OPTIONS.separate.warning);
    requiredConfirmations.push("Транспорт для удалённого адреса согласуется отдельно.");
  }

  const performerPaymentAmount = Math.round(workerPayment);
  const clientTotalExpense = performerPaymentAmount + clientServiceFeeAmount;
  const performerNetAmount = Math.max(0, performerPaymentAmount - performerServiceFeeAmount);
  const serviceMargin = clientServiceFeeAmount + performerServiceFeeAmount;
  const includedFromActions = Array.from(normalized.selectedActions)
    .map((actionId) => ACTION_GUIDE[actionId])
    .filter(Boolean)
    .flatMap((action) => action.includes);
  const notIncludedFromActions = Array.from(normalized.selectedActions)
    .map((actionId) => ACTION_GUIDE[actionId])
    .filter(Boolean)
    .flatMap((action) => action.notIncluded);
  const included = mergeUnique(selectedPackage.included, includedFromActions, safeJsonArray(input.category.includedJson));
  const excluded = mergeUnique(selectedPackage.notIncluded, notIncludedFromActions, safeJsonArray(input.category.excludedJson), forbiddenMedical);
  const increaseFactors = buildIncreaseFactors(normalized, recommendation.reasons, additions);
  const period = calculatePeriodSummary(input, {
    durationHours: normalized.durationHours,
    workerPayment: performerPaymentAmount,
    clientTotal: clientTotalExpense,
    clientServiceFee: clientServiceFeeAmount,
    performerServiceFee: performerServiceFeeAmount,
    performerNet: performerNetAmount,
    serviceMargin
  });

  return {
    basePrice: baseWorkerPayment,
    durationHours: normalized.durationHours,
    billableHours,
    calculationUnit: selectedPackage.calculationUnit,
    packageId: selectedPackage.id,
    packageLabel: selectedPackage.label,
    packageShortLabel: selectedPackage.shortLabel,
    packageName: selectedPackage.label,
    packageDescription: recommendation.reasons.join("; ") || "Формат визита выбран по категории, длительности и объёму помощи.",
    careLevel: selectedPackage.careLevel ?? null,
    careLevelLabel: selectedPackage.careLevel ? CARE_LEVELS[selectedPackage.careLevel].label : null,
    visitFormat: selectedPackage.label,
    workerPayment: performerPaymentAmount,
    clientServiceFee: clientServiceFeeAmount,
    performerServiceFee: performerServiceFeeAmount,
    clientTotal: clientTotalExpense,
    performerNet: performerNetAmount,
    serviceMargin,
    recommendationReasons: recommendation.reasons,
    warnings,
    includedActions: included,
    notIncluded: excluded,
    requiredConfirmations: mergeUnique(requiredConfirmations),
    isManualReviewRequired: manualReviewRequired,
    period,
    additions,
    included,
    excluded,
    performerPaymentAmount,
    clientServiceFeeAmount,
    performerServiceFeeAmount,
    performerCommissionAmount: performerServiceFeeAmount,
    clientTotalExpense,
    performerNetAmount,
    total: performerPaymentAmount,
    explanation: buildExplanation(selectedPackage.label, performerPaymentAmount, clientServiceFeeAmount, clientTotalExpense, additions, recommendation.reasons),
    clientExplanation:
      `Рекомендуемый формат визита: ${selectedPackage.label}. Рекомендуемая оплата помощнику ${performerPaymentAmount} ₽, сервисный сбор заказчика ${clientServiceFeeAmount} ₽, ориентировочные общие расходы ${clientTotalExpense} ₽.`,
    performerExplanation:
      `Рекомендуемая оплата за визит ${performerPaymentAmount} ₽. Сервисный сбор помощника ${performerServiceFeeAmount} ₽. Ориентировочный доход после сервисного сбора ${performerNetAmount} ₽.`,
    increaseFactors,
    forbidden: forbiddenMedical
  };
}

export function recommendPackage(input: PricingInput) {
  const normalized = normalizePricingInput(input);
  const actions = normalized.selectedActions;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const requiredConfirmations: string[] = [];
  let manualReviewRequired = false;
  const hygieneRank = HYGIENE_LEVELS[normalized.hygieneLevel].rank;
  const physicalRank = PHYSICAL_LEVELS[normalized.physicalLoadLevel].rank;
  const hasAction = (...ids: string[]) => ids.some((id) => actions.has(id));
  const hasEscort = normalized.categorySlug === "escort" || normalized.categorySlug === "walks" || hasAction("escortRegularAction", "escortWalk", "errands");
  const hasHousehold = normalized.categorySlug === "home-help" || hasAction("lightCleaning", "laundry", "ironing", "bedLinenChange");
  const hasCooking = normalized.categorySlug === "cooking" || hasAction("simpleCookingVisit", "fullCookingVisit");
  const hasSimpleCooking = hasAction("simpleCookingVisit", "simpleMealWithinVisit");
  const hasFullCooking = hasAction("fullCookingVisit");
  const hasCareFood = hasAction("mealControl", "feedingHelp", "heatServeFood");
  const hasHygiene = hygieneRank > 0 || hasAction("hygieneLight", "hygieneHousehold", "hygieneIntimate", "toiletHelp", "diaper", "commode");
  const hasMobilityCare = physicalRank > 0 || normalized.mobilityFlags.limitedMobility || normalized.mobilityFlags.bedridden || normalized.mobilityFlags.transferHelp || normalized.mobilityFlags.positionChange || hasAction("physicalLight", "physicalMedium", "physicalHeavy", "transferHelp", "positionChange");
  const hasCare = normalized.categorySlug === "elderly-care" || normalized.categorySlug === "limited-mobility-care" || hasHygiene || hasCareFood || hasMobilityCare || normalized.mobilityFlags.cognitiveFeatures;

  if (hasEscort) {
    if (normalized.mobilityFlags.wheelchair || hasAction("escortWheelchairAccessible")) {
      reasons.push("выбрано сопровождение на коляске или требуется доступная среда");
      return recommendation("escortWheelchairAccessible", null, reasons, warnings, requiredConfirmations, manualReviewRequired);
    }
    if (normalized.mobilityFlags.limitedMobility || normalized.mobilityFlags.fallRisk || physicalRank > 0 || hasAction("physicalLight", "physicalMedium", "physicalHeavy")) {
      reasons.push("сопровождение требует поддержки при ограниченной мобильности или риске падения");
      return recommendation("escortLimitedMobility", null, reasons, warnings, requiredConfirmations, manualReviewRequired);
    }
    reasons.push("выбрано обычное сопровождение без выраженной физической помощи");
    return recommendation("escortRegular", null, reasons, warnings, requiredConfirmations, manualReviewRequired);
  }

  const heavyReasons = [
    normalized.mobilityFlags.bedridden ? "лежачий человек" : "",
    normalized.mobilityFlags.bigWeight ? "большой вес" : "",
    normalized.mobilityFlags.positionChange || hasAction("positionChange") ? "смена положения тела" : "",
    physicalRank >= PHYSICAL_LEVELS.physicalHeavy.rank || hasAction("physicalHeavy") ? "тяжёлая физическая помощь" : ""
  ].filter(Boolean);
  if (heavyReasons.length > 0) {
    reasons.push(...heavyReasons);
    warnings.push("Есть признаки тяжёлого ухода. Администратор должен подтвердить, что задача выполнима одним помощником.");
    requiredConfirmations.push("Подтвердить, что задача выполнима одним помощником и условия безопасны.");
    manualReviewRequired = true;
    return recommendation("heavyCareVisit", "heavyCareVisit", reasons, warnings, requiredConfirmations, manualReviewRequired);
  }

  const complexReasons = [
    normalized.mobilityFlags.limitedMobility ? "выраженная маломобильность" : "",
    normalized.hygieneLevel === "hygieneIntimate" || hasAction("hygieneIntimate") ? "интимная гигиена" : "",
    normalized.mobilityFlags.transferHelp || hasAction("transferHelp") ? "пересаживание" : "",
    normalized.mobilityFlags.fallRisk ? "высокий риск падения" : "",
    physicalRank >= PHYSICAL_LEVELS.physicalMedium.rank ? "средняя или тяжёлая физическая помощь" : ""
  ].filter(Boolean);
  if (complexReasons.length >= 2) {
    reasons.push(...complexReasons);
    return recommendation("complexCareVisit", "complexCareVisit", reasons, warnings, requiredConfirmations, manualReviewRequired);
  }

  const advancedReasons = [
    hasAction("diaper") || normalized.dependentState.has("diaper_help") ? "подгузник" : "",
    normalized.hygieneLevel === "hygieneIntimate" || hasAction("hygieneIntimate") ? "подмывание" : "",
    normalized.hygieneLevel === "hygieneHousehold" || hasAction("hygieneHousehold") ? "бытовая гигиеническая помощь" : "",
    hasAction("commode") ? "кресло-туалет" : "",
    hasAction("toiletHelp") || normalized.dependentState.has("toilet_help") ? "помощь с туалетом" : "",
    normalized.mobilityFlags.limitedMobility ? "маломобильность" : "",
    normalized.mobilityFlags.transferHelp || hasAction("transferHelp") ? "пересаживание" : "",
    hasCare && hasHousehold && actions.has("simpleMealWithinVisit") ? "совмещены уход, быт и простая еда" : ""
  ].filter(Boolean);
  if (advancedReasons.length > 0 && (advancedReasons.length >= 2 || hasCare)) {
    reasons.push(...advancedReasons);
    return recommendation("advancedCareVisit", "advancedCareVisit", reasons, warnings, requiredConfirmations, manualReviewRequired);
  }

  const careReasons = [
    hasCareFood ? "помощь с едой" : "",
    hasAction("physicalLight") ? "помощь с одеждой или лёгкая поддержка" : "",
    normalized.hygieneLevel === "hygieneLight" || hasAction("hygieneLight") ? "лёгкая гигиена" : "",
    normalized.hygieneLevel === "hygieneHousehold" || hasAction("hygieneHousehold") ? "бытовая гигиеническая помощь" : "",
    actions.has("communication") ? "присмотр и общение" : "",
    normalized.mobilityFlags.cognitiveFeatures ? "когнитивные особенности" : ""
  ].filter(Boolean);
  if (hasCare || careReasons.length > 0) {
    reasons.push(...(careReasons.length ? careReasons : ["уходовый характер заявки"]));
    return recommendation("careVisit", "careVisit", reasons, warnings, requiredConfirmations, manualReviewRequired);
  }

  if (hasFullCooking) {
    reasons.push("выбрана полноценная готовка отдельным визитом");
    return recommendation("fullCookingVisit", null, reasons, warnings, requiredConfirmations, manualReviewRequired);
  }
  if (hasCooking || hasSimpleCooking) {
    reasons.push("выбрана простая готовка");
    return recommendation("simpleCookingVisit", null, reasons, warnings, requiredConfirmations, manualReviewRequired);
  }
  if (hasHousehold) {
    reasons.push("выбраны бытовые задачи");
    return recommendation("householdVisit", null, reasons, warnings, requiredConfirmations, manualReviewRequired);
  }
  if (normalized.durationHours >= 3 && normalized.categorySlug === "companionship") {
    reasons.push("присмотр длится несколько часов");
    return recommendation("longSupervision3h", null, reasons, warnings, requiredConfirmations, manualReviewRequired);
  }

  reasons.push("небольшой объём простой помощи");
  return recommendation("shortVisit", null, reasons, warnings, requiredConfirmations, manualReviewRequired);
}

function normalizePricingInput(input: PricingInput): NormalizedPricingInput {
  const rawActions = [
    ...(input.selectedActions ?? []),
    ...(input.extraActions ?? []),
    ...(input.additionalActions ?? [])
  ];
  const rawDependentState = [...(input.dependentState ?? [])];
  const selectedActions = new Set<string>();
  const dependentState = new Set<string>();
  for (const value of rawActions) {
    const normalized = ACTION_ALIASES[value] ?? value;
    if (ACTION_GUIDE[normalized]) selectedActions.add(normalized);
    if (value.startsWith("taskVolume:")) dependentState.add(value);
    if (value === "transportSeparate") dependentState.add(value);
  }
  for (const value of rawDependentState) {
    dependentState.add(value);
    const alias = ACTION_ALIASES[value];
    if (alias && ACTION_GUIDE[alias]) selectedActions.add(alias);
  }
  if (input.needsCleaning) selectedActions.add("lightCleaning");
  if (input.needsWalk) selectedActions.add("escortWalk");
  if (input.needsHygieneHelp) selectedActions.add("hygieneHousehold");
  if (input.needsCooking) {
    if (input.category.slug === "cooking") selectedActions.add("simpleCookingVisit");
    else selectedActions.add("simpleMealWithinVisit");
  }
  if (input.hasLimitedMobility) dependentState.add("limited_mobility");
  if (input.helpFor === "limited_mobility") dependentState.add("limited_mobility");
  if (input.helpFor === "child") dependentState.add("child");

  const hygieneLevel = normalizeHygieneLevel(input.hygieneLevel, selectedActions, dependentState);
  const physicalLoadLevel = normalizePhysicalLevel(input.physicalLoadLevel ?? input.physicalHelpLevel, selectedActions, dependentState);
  const taskVolumeLevel = normalizeTaskVolume(input.taskVolumeLevel, selectedActions, dependentState);
  const time = input.time ?? input.timeFrom ?? null;
  const date = normalizeDate(input.date);
  const urgencyFlags = new Set(input.urgencyFlags ?? []);
  if (input.urgency === "urgent" || input.scheduleType === "urgent") urgencyFlags.add("urgent");
  if (isEvening(time)) urgencyFlags.add("evening");
  if (date && isWeekend(date)) urgencyFlags.add("weekend");

  const mobilityFlags = {
    limitedMobility: Boolean(input.mobilityFlags?.limitedMobility || dependentState.has("limited_mobility")),
    bedridden: Boolean(input.mobilityFlags?.bedridden || dependentState.has("bedridden")),
    fallRisk: Boolean(input.mobilityFlags?.fallRisk || dependentState.has("fall_risk")),
    wheelchair: Boolean(input.mobilityFlags?.wheelchair || dependentState.has("wheelchair") || selectedActions.has("escortWheelchairAccessible")),
    bigWeight: Boolean(input.mobilityFlags?.bigWeight || dependentState.has("big_weight")),
    cognitiveFeatures: Boolean(input.mobilityFlags?.cognitiveFeatures || dependentState.has("cognitive_features")),
    transferHelp: Boolean(input.mobilityFlags?.transferHelp || selectedActions.has("transferHelp")),
    positionChange: Boolean(input.mobilityFlags?.positionChange || selectedActions.has("positionChange"))
  };

  return {
    categorySlug: input.category.slug,
    categoryName: input.category.name,
    durationHours: normalizeDuration(input.durationHours ?? input.expectedDurationHours),
    scheduleType: input.scheduleType ?? "once",
    urgency: input.urgency ?? "normal",
    date,
    time,
    selectedActions,
    dependentState,
    hygieneLevel,
    physicalLoadLevel,
    taskVolumeLevel,
    isRemoteAddress: Boolean(input.isRemoteAddress || input.transportOption === "separate" || dependentState.has("transportSeparate")),
    hasPets: Boolean(input.hasPets),
    mobilityFlags,
    urgencyFlags
  };
}

function calculateSurcharges(input: NormalizedPricingInput) {
  const items: Array<{ label: string; amount: number }> = [];
  let total = 0;
  let uncappedTotal = 0;
  const warnings: string[] = [];
  for (const flag of input.urgencyFlags) {
    const surcharge = SURCHARGES[flag as keyof typeof SURCHARGES];
    if (!surcharge) continue;
    uncappedTotal += surcharge.amount;
    const allowed = Math.max(0, SURCHARGE_CAP - total);
    const amount = Math.min(surcharge.amount, allowed);
    if (amount > 0) {
      total += amount;
      items.push({ label: surcharge.label, amount });
    }
  }
  if (uncappedTotal > SURCHARGE_CAP) {
    warnings.push("Надбавки выше 500 ₽ требуют подтверждения администратора.");
  }
  return { items, total, uncappedTotal, warnings };
}

function calculatePeriodSummary(
  input: PricingInput,
  money: {
    durationHours: number;
    workerPayment: number;
    clientTotal: number;
    clientServiceFee: number;
    performerServiceFee: number;
    performerNet: number;
    serviceMargin: number;
  }
) {
  const visitsCount = estimateVisitsCount(input);
  return {
    visitsCount,
    totalHours: roundMoney(visitsCount * money.durationHours),
    clientTotal: visitsCount * money.clientTotal,
    workerPayment: visitsCount * money.workerPayment,
    clientServiceFeeTotal: visitsCount * money.clientServiceFee,
    performerServiceFeeTotal: visitsCount * money.performerServiceFee,
    performerNetTotal: visitsCount * money.performerNet,
    serviceMarginTotal: visitsCount * money.serviceMargin
  };
}

function estimateVisitsCount(input: PricingInput) {
  if (input.scheduleType !== "regular" && input.urgency !== "regular" && !input.isRegular) return 1;
  const start = normalizeDate(input.periodStart);
  const end = normalizeDate(input.periodEnd);
  if (!start || !end || end < start) return 4;
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const weekly = Array.isArray(input.weeklyPattern) ? Math.max(1, input.weeklyPattern.length) : 1;
  return Math.max(1, Math.ceil((days / 7) * weekly));
}

function preset(
  id: string,
  label: string,
  shortLabel: string,
  baseWorkerPayment: number,
  minHours: number,
  included: string[],
  notIncluded: string[],
  extraHourAmount?: number,
  careLevel?: keyof typeof CARE_LEVELS
): PackagePreset {
  return { id, label, shortLabel, baseWorkerPayment, minHours, calculationUnit: "visit", included, notIncluded, extraHourAmount, careLevel };
}

function action(
  id: string,
  group: string,
  title: string,
  shortDescription: string,
  includes: string[],
  helperSteps: string[],
  notIncluded: string[],
  safetyNotes: string[],
  pricingRole: PricingAction["pricingRole"],
  affectsPackageRecommendation: boolean,
  affectsPrice: boolean,
  coveredBy: string[]
): PricingAction {
  return { id, group, title, shortDescription, includes, helperSteps, notIncluded, safetyNotes, pricingRole, affectsPackageRecommendation, affectsPrice, coveredBy };
}

function recommendation(
  recommendedPackageId: string,
  careLevel: string | null,
  reasons: string[],
  warnings: string[],
  requiredConfirmations: string[],
  manualReviewRequired: boolean
) {
  return { recommendedPackageId, careLevel, reasons: mergeUnique(reasons), warnings: mergeUnique(warnings), requiredConfirmations: mergeUnique(requiredConfirmations), manualReviewRequired };
}

function normalizeHygieneLevel(value: unknown, actions: Set<string>, state: Set<string>): HygieneLevelId {
  if (typeof value === "string" && value in HYGIENE_LEVELS) return value as HygieneLevelId;
  if (actions.has("hygieneIntimate") || actions.has("diaper") || state.has("diaper_help") || state.has("toilet_help")) return "hygieneIntimate";
  if (actions.has("hygieneHousehold") || state.has("hygiene_help")) return "hygieneHousehold";
  if (actions.has("hygieneLight")) return "hygieneLight";
  return "none";
}

function normalizePhysicalLevel(value: unknown, actions: Set<string>, state: Set<string>): PhysicalLevelId {
  if (typeof value === "string") {
    if (value in PHYSICAL_LEVELS) return value as PhysicalLevelId;
    const lower = value.toLowerCase();
    if (lower.includes("тяж") || lower.includes("heavy")) return "physicalHeavy";
    if (lower.includes("сред") || lower.includes("умерен") || lower.includes("medium")) return "physicalMedium";
    if (lower.includes("лёг") || lower.includes("лег") || lower.includes("light")) return "physicalLight";
  }
  if (actions.has("physicalHeavy") || state.has("bedridden")) return "physicalHeavy";
  if (actions.has("physicalMedium") || actions.has("transferHelp") || state.has("limited_mobility")) return "physicalMedium";
  if (actions.has("physicalLight") || state.has("fall_risk")) return "physicalLight";
  return "none";
}

function normalizeTaskVolume(value: unknown, actions: Set<string>, state: Set<string>): TaskVolumeLevelId {
  if (typeof value === "string" && value in TASK_VOLUME_OPTIONS) return value as TaskVolumeLevelId;
  const encoded = Array.from(state).find((item) => item.startsWith("taskVolume:"));
  if (encoded) {
    const level = encoded.split(":")[1];
    if (level in TASK_VOLUME_OPTIONS) return level as TaskVolumeLevelId;
  }
  if (actions.has("laundry") || actions.has("ironing") || actions.has("bedLinenChange")) return "extended";
  return "basic";
}

function buildIncreaseFactors(normalized: NormalizedPricingInput, reasons: string[], additions: Array<{ label: string; amount: number }>) {
  return mergeUnique(
    reasons,
    additions.map((item) => item.label),
    normalized.hygieneLevel !== "none" ? [HYGIENE_LEVELS[normalized.hygieneLevel].label] : [],
    normalized.physicalLoadLevel !== "none" ? [PHYSICAL_LEVELS[normalized.physicalLoadLevel].label] : [],
    normalized.hasPets ? ["домашние животные"] : [],
    normalized.isRemoteAddress ? ["удалённый адрес"] : []
  );
}

function normalizeDuration(value?: number | null) {
  if (!value || Number.isNaN(value) || value <= 0) return 1;
  return Math.min(Math.max(value, 1), 12);
}

function clampCareHours(value: number) {
  return Math.min(Math.max(Math.ceil(value), 1), 4);
}

function normalizeDate(value?: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function isEvening(time?: string | null) {
  if (!time) return false;
  const hour = Number(time.split(":")[0]);
  return Number.isFinite(hour) && hour >= 18;
}

function buildExplanation(
  packageName: string,
  performerPaymentAmount: number,
  clientServiceFeeAmount: number,
  clientTotalExpense: number,
  additions: Array<{ label: string; amount: number }>,
  reasons: string[]
) {
  const parts = [
    `Рекомендуемый формат визита: ${packageName}`,
    `рекомендуемая оплата помощнику ${performerPaymentAmount} ₽`,
    `сервисный сбор заказчика ${clientServiceFeeAmount} ₽`,
    `ориентировочные общие расходы ${clientTotalExpense} ₽`
  ];
  if (reasons.length > 0) {
    parts.push(`почему выбран формат: ${reasons.join(", ")}`);
  }
  if (additions.length > 0) {
    parts.push(`учтено: ${additions.map((item) => `${item.label}${item.amount > 0 ? ` +${item.amount} ₽` : item.amount < 0 ? ` ${item.amount} ₽` : ""}`).join(", ")}`);
  }
  return parts.join("; ");
}

function safeJsonArray(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function mergeUnique(...groups: string[][]) {
  return Array.from(new Set(groups.flat().filter(Boolean)));
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
