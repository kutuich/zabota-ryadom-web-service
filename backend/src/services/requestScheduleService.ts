import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { HttpError } from "../utils/http";
import {
  calculateRecommendedAmount,
  getEffectiveCategoryStructure,
  MEDICAL_PROCEDURE_WARNING,
  type RequestFrequencyCode
} from "./categoryStructureService";

type DbClient = Prisma.TransactionClient | typeof prisma;

export const PUBLIC_CATEGORY_SLUGS = ["home-help", "supervision", "shopping-delivery", "accompaniment"] as const;
export const REQUEST_FREQUENCIES = ["urgent_today", "once", "daily", "weekly", "several_weekly", "regular_schedule"] as const;
export type RequestFrequency = typeof REQUEST_FREQUENCIES[number];

export type SelectedRequestTask = {
  categoryId: string;
  subcategoryId?: string | null;
  taskTemplateId?: string | null;
};

export type VisitSlotInput = { id: string; startTime: string; durationMinutes: number };
export type DayScheduleInput = { dayOfWeek: number; slots: VisitSlotInput[] };
export type RequestScheduleInput = {
  frequency: RequestFrequency;
  startDate: string;
  endDate?: string | null;
  weeksCount?: number | null;
  visitCount?: number | null;
  daysOfWeek?: number[];
  slots?: VisitSlotInput[];
  daySchedules?: DayScheduleInput[];
};

export type ExpandedVisit = {
  id: string;
  sequence: number;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  scheduledStart: string;
  scheduledEnd: string;
  timezone: string;
};

export type CalculatedExpandedVisit = ExpandedVisit & {
  calculatedEndTime: string;
  calculatedHelpPrice: number | null;
  calculatedSubtotal: number;
  helpAmount: number | null;
  pricingBreakdown: Array<{
    pricingRuleId: string;
    min: number | null;
    max: number | null;
    amount: number | null;
    coveredTaskKeys: string[];
    comment: string | null;
  }>;
  customerServiceFee: number;
  helperServiceFee: number;
  unpricedTasks: any[];
};

const publicTitles: Record<string, string> = {
  "home-help": "Помощь по дому",
  supervision: "Уход на дому",
  "shopping-delivery": "Покупки и поручения",
  accompaniment: "Сопровождение"
};

const hiddenPublicSlugs = new Set(["regular-help", "regular_help", "urgent-help", "urgent_help", "documents-household", "documents_and_household_organization", "other"]);
const prohibitedTerms = ["укол", "инъекц", "капельниц", "перевяз", "обработка ран", "назначить лекар", "выдач", "диагност", "лечение", "медицинск", "экстренн"];

export function flattenRequestCatalog(categoriesResult: any) {
  const directions = (categoriesResult.categories ?? [])
    .filter((category: any) => (PUBLIC_CATEGORY_SLUGS as readonly string[]).includes(category.slug) && !hiddenPublicSlugs.has(category.slug))
    .map((category: any) => {
      const tasks: any[] = [];
      if (category.slug === "accompaniment") {
        tasks.push({
          id: `${category.id}:root`,
          categoryId: category.id,
          categorySlug: category.slug,
          categoryTitle: publicTitles[category.slug],
          subcategoryId: null,
          taskTemplateId: null,
          slug: "accompaniment",
          title: "Сопроводить",
          aliases: ["сопровождение", "проводить", "встретить", "поликлиника", "магазин"]
        });
      } else {
        for (const child of category.children ?? []) {
          const templates = child.taskTemplates ?? [];
          if (templates.length === 0) {
            tasks.push(flatTask(category, child, null));
          } else {
            for (const template of templates) tasks.push(flatTask(category, child, template));
          }
        }
        for (const template of category.taskTemplates ?? []) tasks.push(flatTask(category, null, template));
      }
      const seen = new Set<string>();
      const deduplicated = tasks.filter((task) => {
        const title = normalizeTaskTitle(task.title);
        const key = `${category.structureId}:${task.slug || title}:${title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return {
        id: category.id,
        slug: category.slug,
        title: publicTitles[category.slug] ?? category.title,
        subtitle: category.slug === "supervision" ? "Без медицинских процедур" : null,
        safetyRules: category.safetyRules ?? [],
        tasks: deduplicated
      };
    })
    .sort((left: any, right: any) => PUBLIC_CATEGORY_SLUGS.indexOf(left.slug) - PUBLIC_CATEGORY_SLUGS.indexOf(right.slug));
  return { ...categoriesResult, directions };
}

function flatTask(category: any, subcategory: any, template: any) {
  const title = template?.title ?? subcategory?.title;
  const slug = template?.slug ?? subcategory?.slug;
  return {
    id: `${category.id}:${subcategory?.id ?? "root"}:${template?.id ?? "none"}`,
    categoryId: category.id,
    categorySlug: category.slug,
    categoryTitle: publicTitles[category.slug] ?? category.title,
    subcategoryId: subcategory?.id ?? null,
    subcategorySlug: subcategory?.slug ?? null,
    taskTemplateId: template?.id ?? null,
    taskTemplateSlug: template?.slug ?? null,
    slug,
    title,
    aliases: taskAliases(title)
  };
}

function taskAliases(title: string) {
  const normalized = normalizeTaskTitle(title);
  const aliases = [normalized];
  if (normalized.includes("подгуз")) aliases.push("памперс", "подгузник");
  if (normalized.includes("прост") && normalized.includes("ед")) aliases.push("готовка", "приготовить еду");
  if (normalized.includes("аптек")) aliases.push("лекарства по списку", "аптека");
  return aliases;
}

export function normalizeTaskTitle(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^а-яa-z0-9]+/gi, " ").trim();
}

export function searchCatalogTasks(catalog: ReturnType<typeof flattenRequestCatalog>, query: string) {
  const normalized = normalizeTaskTitle(query);
  if (prohibitedTerms.some((term) => normalized.includes(term))) return { tasks: [], warning: MEDICAL_PROCEDURE_WARNING };
  if (!normalized) return { tasks: catalog.directions.flatMap((direction: any) => direction.tasks), warning: null };
  return {
    tasks: catalog.directions.flatMap((direction: any) => direction.tasks).filter((task: any) =>
      normalizeTaskTitle(task.title).includes(normalized) || task.aliases.some((alias: string) => normalizeTaskTitle(alias).includes(normalized))
    ),
    warning: null
  };
}

export function expandRequestSchedule(schedule: RequestScheduleInput, timezone: string, now = new Date()): ExpandedVisit[] {
  const errors: Array<{ path: string; message: string }> = [];
  if (schedule.visitCount && schedule.visitCount > env.maxScheduleVisits) {
    errors.push({ path: "schedule.visitCount", message: `Количество визитов не должно превышать ${env.maxScheduleVisits}.` });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(schedule.startDate)) errors.push({ path: "schedule.startDate", message: "Укажите дату начала." });
  const repeating = !["once", "urgent_today"].includes(schedule.frequency);
  if (repeating && !schedule.endDate && !schedule.weeksCount && !schedule.visitCount) {
    errors.push({ path: "schedule.endDate", message: "Укажите конечную дату, число недель или точное количество визитов." });
  }
  const normalizedDaySchedules = buildDaySchedules(schedule);
  if (normalizedDaySchedules.length === 0 || normalizedDaySchedules.every((day) => day.slots.length === 0)) {
    errors.push({ path: "schedule.visitSlots", message: "Добавьте хотя бы один визит." });
  }
  for (const day of normalizedDaySchedules) validateSlots(day.slots, `schedule.days[${day.dayOfWeek}].visitSlots`, errors);
  if (errors.length) throw validationError(errors);

  const start = parseDateOnly(schedule.startDate);
  const derivedEnd = schedule.endDate
    ? parseDateOnly(schedule.endDate)
    : schedule.weeksCount
      ? addDays(start, schedule.weeksCount * 7 - 1)
      : repeating ? addDays(start, env.maxScheduleVisits * 7) : start;
  if (derivedEnd < start) throw validationError([{ path: "schedule.endDate", message: "Дата окончания должна быть не раньше даты начала." }]);

  const visits: ExpandedVisit[] = [];
  for (let date = start; date <= derivedEnd; date = addDays(date, 1)) {
    const dateString = formatDateOnly(date);
    const dayOfWeek = date.getUTCDay();
    const daySchedule = normalizedDaySchedules.find((item) => item.dayOfWeek === dayOfWeek);
    if (!daySchedule) continue;
    for (const slot of daySchedule.slots) {
      const scheduledStart = zonedLocalToUtc(dateString, slot.startTime, timezone);
      if (["once", "urgent_today"].includes(schedule.frequency) && scheduledStart.getTime() < now.getTime()) {
        throw validationError([{ path: `schedule.visitSlots.${slot.id}.startTime`, message: "Время начала визита уже прошло." }]);
      }
      const scheduledEnd = new Date(scheduledStart.getTime() + slot.durationMinutes * 60_000);
      visits.push({
        id: `${dateString}:${slot.id}`,
        sequence: visits.length + 1,
        date: dateString,
        startTime: slot.startTime,
        endTime: minutesToTime(timeToMinutes(slot.startTime) + slot.durationMinutes),
        durationMinutes: slot.durationMinutes,
        scheduledStart: scheduledStart.toISOString(),
        scheduledEnd: scheduledEnd.toISOString(),
        timezone
      });
      if (schedule.visitCount && visits.length >= schedule.visitCount) break;
      if (visits.length > env.maxScheduleVisits) throw new HttpError(400, `График превышает допустимый лимит ${env.maxScheduleVisits} визитов.`, "schedule_limit_exceeded", { validationErrors: [{ path: "schedule", message: "Сократите период или количество визитов." }] });
    }
    if (schedule.visitCount && visits.length >= schedule.visitCount) break;
    if (["once", "urgent_today"].includes(schedule.frequency)) break;
  }
  if (visits.length === 0) throw validationError([{ path: "schedule", message: "По выбранному графику не найдено ни одного визита." }]);
  if (schedule.visitCount && visits.length < schedule.visitCount) {
    throw validationError([{ path: "schedule.visitCount", message: "Не удалось построить указанное количество визитов по выбранному графику." }]);
  }
  return visits.map((visit, index) => ({ ...visit, sequence: index + 1 }));
}

function buildDaySchedules(schedule: RequestScheduleInput): DayScheduleInput[] {
  if (["once", "urgent_today", "daily"].includes(schedule.frequency)) {
    const slots = schedule.slots ?? [];
    if (schedule.frequency === "daily") return [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, slots: sortSlots(slots) }));
    return [{ dayOfWeek: parseDateOnly(schedule.startDate).getUTCDay(), slots: sortSlots(slots) }];
  }
  if (schedule.daySchedules?.length) return schedule.daySchedules.map((day) => ({ ...day, slots: sortSlots(day.slots) }));
  const days = schedule.daysOfWeek?.length ? schedule.daysOfWeek : [parseDateOnly(schedule.startDate).getUTCDay()];
  return days.map((dayOfWeek) => ({ dayOfWeek, slots: sortSlots(schedule.slots ?? []) }));
}

function sortSlots(slots: VisitSlotInput[]) {
  return [...slots].sort((left, right) => timeToMinutes(left.startTime) - timeToMinutes(right.startTime));
}

function validateSlots(slots: VisitSlotInput[], path: string, errors: Array<{ path: string; message: string }>) {
  const sorted = [...slots].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  for (let index = 0; index < sorted.length; index += 1) {
    const slot = sorted[index];
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.startTime)) errors.push({ path: `${path}[${index}].startTime`, message: "Укажите время начала визита." });
    if (!Number.isInteger(slot.durationMinutes) || slot.durationMinutes <= 0 || slot.durationMinutes % 30 !== 0) errors.push({ path: `${path}[${index}].durationMinutes`, message: "Длительность должна быть положительной и кратной 30 минутам." });
    const end = timeToMinutes(slot.startTime) + slot.durationMinutes;
    if (end > 24 * 60) errors.push({ path: `${path}[${index}].durationMinutes`, message: "Визит должен завершиться в пределах суток." });
    if (index > 0) {
      const previous = sorted[index - 1];
      if (timeToMinutes(previous.startTime) + previous.durationMinutes > timeToMinutes(slot.startTime)) errors.push({ path: `${path}[${index}].startTime`, message: "Визиты не должны пересекаться." });
    }
  }
}

export async function calculateMultiTaskRequest(input: {
  cityId: string;
  selectedTasks: SelectedRequestTask[];
  frequency: RequestFrequency;
  schedule: RequestScheduleInput;
  queryText?: string;
}, client: DbClient = prisma) {
  if (input.selectedTasks.length === 0) throw validationError([{ path: "selectedTasks", message: "Выберите хотя бы одну задачу." }]);
  const identities = input.selectedTasks.map(taskIdentityKey);
  if (new Set(identities).size !== identities.length) throw validationError([{ path: "selectedTasks", message: "Одна и та же задача выбрана несколько раз." }]);
  const effective = await getEffectiveCategoryStructure(input.cityId, client);
  if (!effective.structure) throw validationError([{ path: "cityId", message: "Для выбранного города структура направлений пока не настроена." }]);
  const city = effective.city;
  const visits = expandRequestSchedule(input.schedule, city.timezone);
  const resolvedTasks = [] as any[];
  const pricingGroups = new Map<string, { pricing: any; coveredTaskKeys: string[] }>();
  for (const task of input.selectedTasks) {
    const resolved = await resolveTask(client, effective.structure.id, task);
    resolvedTasks.push(resolved.publicTask);
    if (resolved.pricing) {
      const current = pricingGroups.get(resolved.pricing.id) ?? { pricing: resolved.pricing, coveredTaskKeys: [] };
      current.coveredTaskKeys.push(taskIdentityKey(task));
      pricingGroups.set(resolved.pricing.id, current);
    }
  }
  const frequencyCode: RequestFrequencyCode = input.frequency === "urgent_today" ? "urgent_today" : input.frequency === "several_weekly" ? "several_weekly" : input.frequency === "daily" ? "daily" : input.frequency === "regular_schedule" || input.frequency === "weekly" ? "regular_schedule" : "once";
  const settings = await import("./balanceService").then(({ getServiceFeeSettings }) => getServiceFeeSettings(client as any));
  const calculatedVisits: CalculatedExpandedVisit[] = visits.map((visit) => {
    const pricingBreakdown = [...pricingGroups.values()].map(({ pricing, coveredTaskKeys }) => ({
      pricingRuleId: pricing.id,
      min: pricing.recommendedMinPrice,
      max: pricing.recommendedMaxPrice,
      amount: calculateRecommendedAmount(pricing.recommendedMinPrice, pricing.recommendedMaxPrice, frequencyCode, visit.durationMinutes, pricing.defaultDurationMinutes ?? 120),
      coveredTaskKeys,
      comment: pricing.priceComment
    }));
    const pricedRuleIds = new Set(pricingBreakdown.filter((item) => item.amount !== null).map((item) => item.pricingRuleId));
    const unpricedTasks = resolvedTasks.filter((task) => !task.pricingRuleId || !pricedRuleIds.has(task.pricingRuleId));
    const calculatedSubtotal = pricingBreakdown.reduce((sum, item) => sum + (item.amount ?? 0), 0);
    const calculatedHelpPrice = unpricedTasks.length > 0 ? null : calculatedSubtotal;
    return {
      ...visit,
      calculatedEndTime: visit.endTime,
      calculatedHelpPrice,
      calculatedSubtotal,
      helpAmount: calculatedHelpPrice,
      pricingBreakdown,
      customerServiceFee: settings.clientServiceFeeAmount,
      helperServiceFee: settings.performerCommissionAmount,
      unpricedTasks
    };
  });
  const unpricedTasks = deduplicateTasks(calculatedVisits.flatMap((visit) => visit.unpricedTasks));
  const exactAmounts = calculatedVisits.map((visit) => visit.calculatedHelpPrice);
  const hasUnpricedTasks = exactAmounts.some((amount) => amount === null);
  const totalHelpAmount = hasUnpricedTasks ? null : exactAmounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
  const distinctAmounts = new Set(exactAmounts.filter((amount): amount is number => amount !== null));
  const perVisitHelpAmount = !hasUnpricedTasks && distinctAmounts.size === 1 ? exactAmounts[0] : null;
  const customerServiceFeeTotal = visits.length * settings.clientServiceFeeAmount;
  const helperServiceFeeTotal = visits.length * settings.performerCommissionAmount;
  const pricedRules = [...pricingGroups.values()].map(({ pricing, coveredTaskKeys }) => ({
    pricingRuleId: pricing.id,
    min: pricing.recommendedMinPrice,
    max: pricing.recommendedMaxPrice,
    coveredTaskKeys,
    comment: pricing.priceComment
  }));
  const dailyBreakdown = Object.values(calculatedVisits.reduce<Record<string, any>>((days, visit) => {
    const current = days[visit.date] ?? { date: visit.date, visitCount: 0, totalDurationMinutes: 0, totalHelpPrice: 0, hasUnpricedTasks: false, customerServiceFee: 0, helperServiceFee: 0 };
    current.visitCount += 1;
    current.totalDurationMinutes += visit.durationMinutes;
    current.totalHelpPrice += visit.calculatedHelpPrice ?? 0;
    current.hasUnpricedTasks ||= visit.calculatedHelpPrice === null;
    current.customerServiceFee += visit.customerServiceFee;
    current.helperServiceFee += visit.helperServiceFee;
    days[visit.date] = current;
    return days;
  }, {}));
  const warning = prohibitedTerms.some((term) => normalizeTaskTitle(input.queryText ?? "").includes(term)) ? MEDICAL_PROCEDURE_WARNING : null;
  const warnings = [warning, hasUnpricedTasks ? "Часть выбранных задач не имеет активного ценового правила. Рассчитанная часть показана отдельно, итог согласуется в чате." : null].filter((item): item is string => Boolean(item));
  return {
    missingFields: [],
    selectedTasks: resolvedTasks,
    expandedVisits: calculatedVisits,
    visitCount: visits.length,
    totalDurationMinutes: visits.reduce((sum, visit) => sum + visit.durationMinutes, 0),
    perVisitHelpAmount: hasUnpricedTasks ? null : perVisitHelpAmount,
    totalHelpAmount,
    customerServiceFeeAmountPerVisit: settings.clientServiceFeeAmount,
    helperServiceFeeAmountPerVisit: settings.performerCommissionAmount,
    customerServiceFeeTotal,
    helperServiceFeeTotal,
    totalCustomerEstimate: totalHelpAmount === null ? null : totalHelpAmount + customerServiceFeeTotal,
    customerEstimatedTotal: totalHelpAmount === null ? null : totalHelpAmount + customerServiceFeeTotal,
    pricedRules,
    unpricedTasks,
    dailyBreakdown,
    sourceStructure: { id: effective.structure.id, title: effective.structure.title, versionNumber: effective.structure.versionNumber, scopeType: effective.structure.scopeType },
    effectiveStructure: { id: effective.structure.id, title: effective.structure.title, versionNumber: effective.structure.versionNumber, scopeType: effective.structure.scopeType },
    pricingSource: "effective_category_structure",
    fallbackStatus: effective.status,
    sourceMessage: effective.status === "local_ready"
      ? `База расчёта: ${city.name} v${effective.structure.versionNumber}.`
      : effective.status === "uses_region_fallback"
        ? `База расчёта: ${city.region} v${effective.structure.versionNumber}. Для ${city.name} локальная структура пока не опубликована.`
        : `База расчёта: базовая структура РФ v${effective.structure.versionNumber}. Локальные ориентиры для города пока не заданы.`,
    warnings,
    calculatedAt: new Date().toISOString()
  };
}

function deduplicateTasks(tasks: any[]) {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    const key = `${task.categoryId}:${task.subcategoryId ?? "root"}:${task.taskTemplateId ?? "none"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function resolveTask(client: DbClient, structureId: string, task: SelectedRequestTask) {
  const category = await client.category.findFirst({ where: { id: task.categoryId, structureId, parentId: null, status: "active", isVisibleForCustomer: true }, include: { pricingRules: { where: { isActive: true } } } });
  if (!category || !(PUBLIC_CATEGORY_SLUGS as readonly string[]).includes(category.slug)) throw validationError([{ path: "selectedTasks", message: "Выбрана недоступная задача." }]);
  const subcategory = task.subcategoryId ? await client.category.findFirst({ where: { id: task.subcategoryId, structureId, parentId: category.id, status: "active" }, include: { pricingRules: { where: { isActive: true } } } }) : null;
  if (task.subcategoryId && !subcategory) throw validationError([{ path: "selectedTasks", message: "Задача не относится к выбранному направлению." }]);
  const template = task.taskTemplateId ? await client.categoryTaskTemplate.findFirst({ where: { id: task.taskTemplateId, categoryId: subcategory?.id ?? category.id, isActive: true } }) : null;
  if (task.taskTemplateId && !template) throw validationError([{ path: "selectedTasks", message: "Типовая задача недоступна." }]);
  const pricing = subcategory?.pricingRules[0] ?? category.pricingRules[0] ?? null;
  return {
    pricing,
    publicTask: {
      categoryId: category.id,
      categorySlug: category.slug,
      categoryTitle: publicTitles[category.slug] ?? category.title,
      subcategoryId: subcategory?.id ?? null,
      subcategorySlug: subcategory?.slug ?? null,
      subcategoryTitle: subcategory?.title ?? null,
      taskTemplateId: template?.id ?? null,
      taskTemplateSlug: template?.slug ?? null,
      taskTemplateTitle: template?.title ?? subcategory?.title ?? (category.slug === "accompaniment" ? "Сопроводить" : category.title),
      pricingRuleId: pricing?.id ?? null
    }
  };
}

export function requestTermsHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function createMultiTaskRequestSnapshotTx(
  tx: Prisma.TransactionClient,
  input: {
    requestId: string;
    cityId: string;
    recipientType: string;
    dependentName?: string | null;
    dependentAge?: number | null;
    dependentState: { mainState: string; features: string[] };
    selectedTasks: SelectedRequestTask[];
    frequency: RequestFrequency;
    schedule: RequestScheduleInput;
    accompanimentWaitingMinutes?: number | null;
  },
  calculation: Awaited<ReturnType<typeof calculateMultiTaskRequest>>
) {
  const first = calculation.selectedTasks[0];
  return tx.requestCategorySnapshot.create({
    data: {
      requestId: input.requestId,
      structureId: calculation.sourceStructure.id,
      categoryId: first?.categoryId ?? null,
      subcategoryId: first?.subcategoryId ?? null,
      taskTemplateId: first?.taskTemplateId ?? null,
      snapshotJson: JSON.stringify({
        schemaVersion: 2,
        cityId: input.cityId,
        structureId: calculation.sourceStructure.id,
        structureTitle: calculation.sourceStructure.title,
        structureVersion: calculation.sourceStructure.versionNumber,
        structureScopeType: calculation.sourceStructure.scopeType,
        fallbackStatus: calculation.fallbackStatus,
        recipientType: input.recipientType,
        dependent: { name: input.dependentName ?? null, age: input.dependentAge ?? null, ...input.dependentState },
        selectedTasks: calculation.selectedTasks,
        frequencyCode: input.frequency,
        scheduleRules: input.schedule,
        visitSlots: input.schedule.slots ?? input.schedule.daySchedules?.flatMap((day) => day.slots) ?? [],
        preliminaryExpandedVisits: calculation.expandedVisits,
        visitCount: calculation.visitCount,
        totalDurationMinutes: calculation.totalDurationMinutes,
        calculatedRecommendedPrice: calculation.perVisitHelpAmount,
        finalCalculatedRecommendedPrice: calculation.totalHelpAmount,
        customerServiceFeeTotal: calculation.customerServiceFeeTotal,
        helperServiceFeeTotal: calculation.helperServiceFeeTotal,
        pricingBreakdown: calculation.pricedRules,
        unpricedTasks: calculation.unpricedTasks,
        accompanimentWaitingMinutes: input.accompanimentWaitingMinutes ?? null,
        safetyRulesShown: calculation.warnings,
        calculatedAt: calculation.calculatedAt
      })
    }
  });
}

export function taskIdentityKey(task: SelectedRequestTask) {
  return `${task.categoryId}:${task.subcategoryId ?? "root"}:${task.taskTemplateId ?? "none"}`;
}

function validationError(validationErrors: Array<{ path: string; message: string }>) {
  return new HttpError(400, "Проверьте заполнение формы", "validation_error", { validationErrors });
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function zonedLocalToUtc(date: string, time: string, timezone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
  const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess - (represented - guess));
}
