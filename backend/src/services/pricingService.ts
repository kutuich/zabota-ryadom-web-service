import type { ServiceCategory } from "@prisma/client";

export type PricingPackageId =
  | "short_help"
  | "home_help_2h"
  | "supervision_2h"
  | "accompaniment_standard"
  | "help_3_4h"
  | "regular_help";

export type PricingAddonId =
  | "extra_hour"
  | "waiting"
  | "second_address"
  | "shopping"
  | "simple_meal_extra"
  | "urgent"
  | "transport_expenses";

export type PricingPackage = {
  id: PricingPackageId;
  title: string;
  shortDescription: string;
  durationLabel: string;
  priceMin: number;
  priceMax: number | null;
  includedActions: string[];
  possibleAddons: PricingAddonId[];
  exclusions: string[];
  recommendedFor: string[];
};

export type PricingAddon = {
  id: PricingAddonId;
  title: string;
  priceMin: number | null;
  priceMax: number | null;
  unit: "hour" | "visit" | "actual";
  priceLabel: string;
};

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
  packageId?: PricingPackageId | string | null;
  helperAmount?: number | null;
  selectedAddonIds?: Array<PricingAddonId | string>;
  addonQuantities?: Partial<Record<PricingAddonId, number>>;
  addonAmounts?: Partial<Record<PricingAddonId, number>>;
  city?: string;
  helpFor?: string | null;
  selectedActions?: string[];
  extraActions?: string[];
  additionalActions?: string[];
  dependentState?: string[];
  hygieneLevel?: string | null;
  physicalLoadLevel?: string | null;
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
  taskVolumeLevel?: string | null;
  urgencyFlags?: string[];
  address?: string | null;
  isRemoteAddress?: boolean;
  transportOption?: string | null;
  mobilityFlags?: Record<string, boolean | undefined>;
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

export type QuoteAddon = PricingAddon & {
  quantity: number;
  amountMin: number | null;
  amountMax: number | null;
  selectedAmount: number | null;
};

export type PricingResult = {
  packageId: PricingPackageId;
  packageTitle: string;
  packageLabel: string;
  packageShortLabel: string;
  packageName: string;
  packageDescription: string;
  packagePriceMin: number;
  packagePriceMax: number | null;
  durationHours: number;
  billableHours: number;
  calculationUnit: string;
  basePrice: number;
  helperAmount: number;
  workerPayment: number;
  performerPaymentAmount: number;
  customerServiceFeeAmount: number;
  clientServiceFee: number;
  clientServiceFeeAmount: number;
  helperServiceFeeAmount: number;
  performerServiceFee: number;
  performerServiceFeeAmount: number;
  performerCommissionAmount: number;
  customerTotalAmount: number;
  clientTotal: number;
  clientTotalExpense: number;
  helperNetAmount: number;
  performerNet: number;
  performerNetAmount: number;
  serviceMargin: number;
  customerTotalMin: number;
  customerTotalMax: number | null;
  helperNetMin: number;
  helperNetMax: number | null;
  minTopUpAmount: number;
  addons: QuoteAddon[];
  additions: Array<{ label: string; amount: number; appliesTo: "performer" | "client_total" }>;
  includedActions: string[];
  included: string[];
  notIncluded: string[];
  excluded: string[];
  possibleAddons: PricingAddon[];
  recommendedFor: string[];
  recommendationReasons: string[];
  warnings: string[];
  requiredConfirmations: string[];
  isManualReviewRequired: boolean;
  careLevel: null;
  careLevelLabel: null;
  visitFormat: string;
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
  total: number;
  explanation: string;
  clientExplanation: string;
  performerExplanation: string;
  increaseFactors: string[];
  forbidden: string[];
};

const CUSTOMER_SERVICE_FEE = 50;
const HELPER_SERVICE_FEE = 50;
const MIN_TOP_UP_AMOUNT = 150;

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

export const PRICING_ADDONS: Record<PricingAddonId, PricingAddon> = {
  extra_hour: addon("extra_hour", "Дополнительный час", 250, 400, "hour", "250–400 ₽/час"),
  waiting: addon("waiting", "Ожидание", 200, 300, "hour", "200–300 ₽/час"),
  second_address: addon("second_address", "Второй адрес", 150, 300, "visit", "150–300 ₽"),
  shopping: addon("shopping", "Покупки", 200, 400, "visit", "200–400 ₽"),
  simple_meal_extra: addon("simple_meal_extra", "Помощь с простой едой сверх пакета", 150, 300, "visit", "150–300 ₽"),
  urgent: addon("urgent", "Срочная заявка", 200, 500, "visit", "200–500 ₽"),
  transport_expenses: addon("transport_expenses", "Транспорт / такси / парковка", null, null, "actual", "по факту расходов")
};

export const PRICING_PACKAGES: Record<PricingPackageId, PricingPackage> = {
  short_help: {
    id: "short_help",
    title: "Короткая помощь",
    shortDescription: "Небольшая бытовая задача или простое поручение в пределах одного часа.",
    durationLabel: "до 1 часа",
    priceMin: 400,
    priceMax: 700,
    includedActions: ["простые бытовые действия", "небольшое поручение", "помощь в согласованном объёме"],
    possibleAddons: ["extra_hour", "second_address", "shopping", "urgent", "transport_expenses"],
    exclusions: ["задачи за пределами согласованного часа", "медицинские процедуры", "тяжёлая физическая нагрузка"],
    recommendedFor: ["одна короткая задача", "простое поручение", "небольшая помощь по дому"]
  },
  home_help_2h: {
    id: "home_help_2h",
    title: "Бытовая помощь 2 часа",
    shortDescription: "Несколько бытовых задач в пределах двух согласованных часов.",
    durationLabel: "2 часа",
    priceMin: 700,
    priceMax: 1100,
    includedActions: ["лёгкая уборка", "мытьё посуды", "вынос мусора", "простые поручения", "помощь с простой едой в рамках пакета"],
    possibleAddons: ["extra_hour", "second_address", "shopping", "simple_meal_extra", "urgent", "transport_expenses"],
    exclusions: ["генеральная уборка", "задачи за пределами согласованного времени", "медицинские процедуры"],
    recommendedFor: ["помощь по дому", "несколько бытовых задач", "простая еда вместе с бытовой помощью"]
  },
  supervision_2h: {
    id: "supervision_2h",
    title: "Присмотр 2 часа",
    shortDescription: "Присмотр, общение и согласованные бытовые мелочи в течение двух часов.",
    durationLabel: "2 часа",
    priceMin: 700,
    priceMax: 1200,
    includedActions: ["присмотр", "общение", "помощь с едой", "простые бытовые действия в пределах времени"],
    possibleAddons: ["extra_hour", "waiting", "urgent", "transport_expenses"],
    exclusions: ["постоянное медицинское наблюдение", "медицинские процедуры", "задачи, меняющие характер заявки"],
    recommendedFor: ["присмотр за подопечным", "общение", "бытовая поддержка рядом"]
  },
  accompaniment_standard: {
    id: "accompaniment_standard",
    title: "Сопровождение стандарт",
    shortDescription: "Сопровождение по одному согласованному маршруту с ожиданием до 30 минут.",
    durationLabel: "один согласованный выход",
    priceMin: 800,
    priceMax: 1500,
    includedActions: ["один маршрут", "помощь при передвижении в бытовом объёме", "ожидание до 30 минут, если согласовано"],
    possibleAddons: ["waiting", "second_address", "shopping", "urgent", "transport_expenses"],
    exclusions: ["второй адрес без согласования", "длительное ожидание", "транспортные расходы"],
    recommendedFor: ["поездка в учреждение", "прогулка или сопровождение", "помощь по согласованному маршруту"]
  },
  help_3_4h: {
    id: "help_3_4h",
    title: "Помощь 3–4 часа",
    shortDescription: "Расширенный объём бытовой помощи, присмотра или сопровождения.",
    durationLabel: "3–4 часа",
    priceMin: 1200,
    priceMax: 2000,
    includedActions: ["согласованный набор бытовых задач", "присмотр и общение", "помощь по дому в пределах времени"],
    possibleAddons: ["extra_hour", "second_address", "shopping", "simple_meal_extra", "urgent", "transport_expenses"],
    exclusions: ["задачи сверх четырёх часов", "медицинские процедуры", "несогласованная смена характера заявки"],
    recommendedFor: ["расширенный объём помощи", "длительный присмотр", "несколько задач за один выход"]
  },
  regular_help: {
    id: "regular_help",
    title: "Регулярная помощь",
    shortDescription: "Повторяющиеся выходы по заранее согласованному графику и составу задач.",
    durationLabel: "по согласованному графику",
    priceMin: 700,
    priceMax: null,
    includedActions: ["согласованный состав задач", "согласованная продолжительность", "повторяющийся график"],
    possibleAddons: ["extra_hour", "waiting", "second_address", "shopping", "simple_meal_extra", "urgent", "transport_expenses"],
    exclusions: ["изменение объёма без повторного согласования", "медицинские процедуры"],
    recommendedFor: ["помощь по расписанию", "повторные выходы", "регулярная бытовая поддержка"]
  }
};

// Compatibility export for consumers that previously read the package catalog by this name.
export const PACKAGES = PRICING_PACKAGES;

export function calculatePrice(input: PricingInput): PricingResult {
  const actions = new Set([...(input.selectedActions ?? []), ...(input.extraActions ?? []), ...(input.additionalActions ?? [])]);
  const packageId = resolvePackageId(input, actions);
  const selectedPackage = PRICING_PACKAGES[packageId];
  const customerFee = input.clientServiceFeeAmount ?? CUSTOMER_SERVICE_FEE;
  const helperFee = input.performerServiceFeeAmount ?? input.performerCommissionAmount ?? HELPER_SERVICE_FEE;
  const selectedAddons = resolveSelectedAddons(input, actions);
  const addonMin = sumNullable(selectedAddons.map((item) => item.amountMin));
  const addonMax = sumNullable(selectedAddons.map((item) => item.amountMax));
  const packageMaxWithAddons = selectedPackage.priceMax === null || addonMax === null ? null : selectedPackage.priceMax + addonMax;
  const rangeMin = selectedPackage.priceMin + (addonMin ?? 0);
  const rangeMax = packageMaxWithAddons;
  const requestedHelperAmount = positiveInteger(input.helperAmount);
  const manualAdjustment = Math.trunc(input.adminManualAdjustment ?? 0);
  const selectedAddonAmount = selectedAddons.reduce((sum, item) => sum + (item.selectedAmount ?? item.amountMin ?? 0), 0);
  const helperAmount = Math.max(0, (requestedHelperAmount ?? selectedPackage.priceMin) + selectedAddonAmount + manualAdjustment);
  const customerTotal = helperAmount + customerFee;
  const helperNet = Math.max(0, helperAmount - helperFee);
  const durationHours = normalizeDuration(input.expectedDurationHours ?? input.durationHours, packageId);
  const reasons = recommendationReasons(packageId, input, actions);
  const requiredConfirmations = selectedAddons
    .filter((item) => item.unit === "actual")
    .map((item) => `${item.title}: сумма согласуется отдельно по факту расходов.`);
  const warnings = requiredConfirmations.length > 0 ? [...requiredConfirmations] : [];
  const explanation = selectedPackage.priceMax === null
    ? `${selectedPackage.title}: по согласованию, обычно от ${selectedPackage.priceMin} ₽ за выход. Точная сумма согласовывается в чате до двойного подтверждения.`
    : `${selectedPackage.title}: ${selectedPackage.priceMin}–${selectedPackage.priceMax} ₽ за выход. Точная сумма согласовывается в чате до двойного подтверждения.`;
  const possibleAddons = selectedPackage.possibleAddons.map((id) => PRICING_ADDONS[id]);

  return {
    packageId,
    packageTitle: selectedPackage.title,
    packageLabel: selectedPackage.title,
    packageShortLabel: selectedPackage.title,
    packageName: selectedPackage.title,
    packageDescription: selectedPackage.shortDescription,
    packagePriceMin: selectedPackage.priceMin,
    packagePriceMax: selectedPackage.priceMax,
    durationHours,
    billableHours: durationHours,
    calculationUnit: "visit",
    basePrice: selectedPackage.priceMin,
    helperAmount,
    workerPayment: helperAmount,
    performerPaymentAmount: helperAmount,
    customerServiceFeeAmount: customerFee,
    clientServiceFee: customerFee,
    clientServiceFeeAmount: customerFee,
    helperServiceFeeAmount: helperFee,
    performerServiceFee: helperFee,
    performerServiceFeeAmount: helperFee,
    performerCommissionAmount: helperFee,
    customerTotalAmount: customerTotal,
    clientTotal: customerTotal,
    clientTotalExpense: customerTotal,
    helperNetAmount: helperNet,
    performerNet: helperNet,
    performerNetAmount: helperNet,
    serviceMargin: customerFee + helperFee,
    customerTotalMin: rangeMin + customerFee,
    customerTotalMax: rangeMax === null ? null : rangeMax + customerFee,
    helperNetMin: Math.max(0, rangeMin - helperFee),
    helperNetMax: rangeMax === null ? null : Math.max(0, rangeMax - helperFee),
    minTopUpAmount: MIN_TOP_UP_AMOUNT,
    addons: selectedAddons,
    additions: selectedAddons.map((item) => ({
      label: `${item.title} (${item.priceLabel})`,
      amount: item.selectedAmount ?? item.amountMin ?? 0,
      appliesTo: "performer" as const
    })),
    includedActions: selectedPackage.includedActions,
    included: selectedPackage.includedActions,
    notIncluded: selectedPackage.exclusions,
    excluded: selectedPackage.exclusions,
    possibleAddons,
    recommendedFor: selectedPackage.recommendedFor,
    recommendationReasons: reasons,
    warnings,
    requiredConfirmations,
    isManualReviewRequired: requiredConfirmations.length > 0,
    careLevel: null,
    careLevelLabel: null,
    visitFormat: selectedPackage.title,
    period: {
      visitsCount: 1,
      totalHours: durationHours,
      clientTotal: customerTotal,
      workerPayment: helperAmount,
      clientServiceFeeTotal: customerFee,
      performerServiceFeeTotal: helperFee,
      performerNetTotal: helperNet,
      serviceMarginTotal: customerFee + helperFee
    },
    total: customerTotal,
    explanation,
    clientExplanation: `${explanation} Сервисный сбор Заказчика — ${customerFee} ₽.`,
    performerExplanation: `Согласованная стоимость помощи уменьшается на сервисный сбор Помощника ${helperFee} ₽.`,
    increaseFactors: possibleAddons.map((item) => `${item.title}: ${item.priceLabel}`),
    forbidden: forbiddenMedical
  };
}

function resolvePackageId(input: PricingInput, actions: Set<string>): PricingPackageId {
  const explicit = input.packageId ?? input.adminManualPackage ?? storedPackageId(actions);
  if (explicit && isPackageId(explicit)) return explicit;
  if (input.scheduleType === "regular" || input.urgency === "regular" || input.isRegular) return "regular_help";
  if (hasAny(actions, ["escort", "accompaniment", "walk", "wheelchair"]) || /сопровожд/i.test(`${input.category.slug} ${input.category.name}`)) {
    return "accompaniment_standard";
  }
  const duration = input.expectedDurationHours ?? input.durationHours ?? 0;
  if (duration >= 3) return "help_3_4h";
  if (hasAny(actions, ["supervision", "communication", "watch", "meal_help"]) || /присмотр|нян/i.test(`${input.category.slug} ${input.category.name}`)) {
    return "supervision_2h";
  }
  if (duration > 0 && duration <= 1) return "short_help";
  return "home_help_2h";
}

function resolveSelectedAddons(input: PricingInput, actions: Set<string>): QuoteAddon[] {
  const ids = new Set<string>(input.selectedAddonIds ?? []);
  for (const action of actions) {
    if (action.startsWith("pricingAddon:")) ids.add(action.slice("pricingAddon:".length));
  }
  if (input.scheduleType === "urgent" || input.urgency === "urgent" || input.urgencyFlags?.includes("urgent")) ids.add("urgent");
  if (input.isRemoteAddress || input.transportOption === "separate" || actions.has("transportSeparate")) ids.add("transport_expenses");

  return [...ids].filter(isAddonId).map((id) => {
    const item = PRICING_ADDONS[id];
    const quantity = Math.max(1, Number(input.addonQuantities?.[id] ?? 1));
    const selectedAmount = positiveInteger(input.addonAmounts?.[id]) ?? null;
    return {
      ...item,
      quantity,
      amountMin: item.priceMin === null ? null : item.priceMin * quantity,
      amountMax: item.priceMax === null ? null : item.priceMax * quantity,
      selectedAmount
    };
  });
}

function recommendationReasons(packageId: PricingPackageId, input: PricingInput, actions: Set<string>): string[] {
  const reasons = [`Выбран формат «${PRICING_PACKAGES[packageId].title}».`];
  if (input.packageId || input.adminManualPackage || storedPackageId(actions)) reasons.push("Формат выбран Заказчиком для этой заявки.");
  else if (packageId === "regular_help") reasons.push("Указан регулярный график помощи.");
  else if (packageId === "help_3_4h") reasons.push("Указана продолжительность от трёх часов.");
  else if (packageId === "accompaniment_standard") reasons.push("В заявке указано сопровождение.");
  else reasons.push("Формат рекомендован по длительности и составу задач.");
  return reasons;
}

function normalizeDuration(value: number | null | undefined, packageId: PricingPackageId): number {
  if (value && Number.isFinite(value) && value > 0) return value;
  if (packageId === "short_help") return 1;
  if (packageId === "help_3_4h") return 3;
  return 2;
}

function storedPackageId(actions: Set<string>): string | null {
  const token = [...actions].find((item) => item.startsWith("pricingPackage:"));
  return token?.slice("pricingPackage:".length) ?? null;
}

function isPackageId(value: string): value is PricingPackageId {
  return Object.prototype.hasOwnProperty.call(PRICING_PACKAGES, value);
}

function isAddonId(value: string): value is PricingAddonId {
  return Object.prototype.hasOwnProperty.call(PRICING_ADDONS, value);
}

function hasAny(values: Set<string>, expected: string[]): boolean {
  return expected.some((item) => values.has(item));
}

function positiveInteger(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

function sumNullable(values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function addon(
  id: PricingAddonId,
  title: string,
  priceMin: number | null,
  priceMax: number | null,
  unit: PricingAddon["unit"],
  priceLabel: string
): PricingAddon {
  return { id, title, priceMin, priceMax, unit, priceLabel };
}
