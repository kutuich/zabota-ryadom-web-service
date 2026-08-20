import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { HttpError } from "../utils/http";
import {
  calculateRecommendedAmount,
  categoriesForCity,
  getEffectiveCategoryStructure,
  MEDICAL_PROCEDURE_WARNING,
  type RequestFrequencyCode,
  type SafetyRuleApplicability,
  type SafetyRuleCondition
} from "./categoryStructureService";

type DbClient = Prisma.TransactionClient | typeof prisma;

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

const hiddenPublicSlugs = new Set(["regular-help", "regular_help", "urgent-help", "urgent_help", "documents-household", "documents_and_household_organization", "other"]);
const prohibitedTerms = ["укол", "инъекц", "капельниц", "перевяз", "обработка ран", "назначить лекар", "выдач", "диагност", "лечение", "медицинск", "экстренн"];

export function flattenRequestCatalog(categoriesResult: any) {
  const directions = (categoriesResult.categories ?? [])
    .filter((category: any) => !hiddenPublicSlugs.has(category.slug))
    .map((category: any) => {
      const tasks: any[] = [];
      for (const child of category.children ?? []) {
        const templates = child.taskTemplates ?? [];
        if (templates.length === 0) {
          tasks.push(flatTask(category, child, null));
        } else {
          for (const template of templates) tasks.push(flatTask(category, child, template));
        }
      }
      for (const template of category.taskTemplates ?? []) tasks.push(flatTask(category, null, template));
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
        title: category.title,
        sortOrder: category.sortOrder,
        subtitle: null,
        safetyRules: category.safetyRules ?? [],
        tasks: deduplicated
      };
    })
    .sort((left: any, right: any) => left.sortOrder - right.sortOrder);
  return { ...categoriesResult, directions };
}

function flatTask(category: any, subcategory: any, template: any) {
  const title = template?.title ?? subcategory?.title;
  const slug = template?.slug ?? subcategory?.slug;
  return {
    id: `${category.id}:${subcategory?.id ?? "root"}:${template?.id ?? "none"}`,
    categoryId: category.id,
    categorySlug: category.slug,
    categoryTitle: category.title,
    subcategoryId: subcategory?.id ?? null,
    subcategorySlug: subcategory?.slug ?? null,
    taskTemplateId: template?.id ?? null,
    taskTemplateSlug: template?.slug ?? null,
    slug,
    title,
    aliases: [...new Set([...(template?.aliases ?? []), ...taskAliases(title)])],
    description: template?.description ?? subcategory?.descriptionForCustomer ?? null,
    customerHint: template?.customerHint ?? null,
    safetyNote: template?.safetyNote ?? null,
    taskKind: template?.taskKind ?? "standard",
    durationEffect: template?.durationEffect ?? {},
    priceEffect: template?.priceEffect ?? {},
    requiresComment: template?.requiresComment ?? false,
    formFields: template?.formFields ?? [],
    recommendations: template?.recommendations ?? [],
    constraints: template?.constraints ?? {},
    sourceStructure: template?.sourceStructure ?? subcategory?.sourceStructure ?? category.sourceStructure
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
  taskFieldValues?: Record<string, Record<string, unknown>>;
}, client: DbClient = prisma) {
  if (input.selectedTasks.length === 0) throw validationError([{ path: "selectedTasks", message: "Выберите хотя бы одну задачу." }]);
  const identities = input.selectedTasks.map(taskIdentityKey);
  if (new Set(identities).size !== identities.length) throw validationError([{ path: "selectedTasks", message: "Одна и та же задача выбрана несколько раз." }]);
  const unknownValueKey = Object.keys(input.taskFieldValues ?? {}).find((key) => !identities.includes(key));
  if (unknownValueKey) throw validationError([{ path: `taskFieldValues.${unknownValueKey}`, message: "Поля относятся к невыбранной задаче." }]);
  const effective = await getEffectiveCategoryStructure(input.cityId, client);
  if (!effective.structure) throw validationError([{ path: "cityId", message: "Для выбранного города структура направлений пока не настроена." }]);
  const city = effective.city;
  const visits = expandRequestSchedule(input.schedule, city.timezone);
  const effectiveCatalog = await categoriesForCity(input.cityId, "customer", client);
  const resolvedTasks = [] as any[];
  const pricingCandidates: Array<{ pricing: any | null; specificity: number; taskKey: string; taskSlug: string }> = [];
  for (const task of input.selectedTasks) {
    const resolved = resolveTaskFromCatalog(effectiveCatalog.categories, task);
    validateDynamicTaskFields(resolved.publicTask, input.taskFieldValues?.[taskIdentityKey(task)] ?? {});
    resolvedTasks.push(resolved.publicTask);
    pricingCandidates.push({ pricing: resolved.pricing, specificity: resolved.pricingSpecificity, taskKey: taskIdentityKey(task), taskSlug: resolved.publicTask.taskTemplateSlug ?? resolved.publicTask.subcategorySlug ?? resolved.publicTask.categorySlug });
  }
  const pricingGroups = buildDeterministicPricingGroups(pricingCandidates);
  const appliedSafetyRules = evaluateApplicableSafetyRules(effectiveCatalog.categories, resolvedTasks, input.taskFieldValues ?? {});
  assertNoBlockingSafetyRules(appliedSafetyRules);
  const frequencyCode: RequestFrequencyCode = input.frequency === "urgent_today" ? "urgent_today" : input.frequency === "several_weekly" ? "several_weekly" : input.frequency === "daily" ? "daily" : input.frequency === "regular_schedule" || input.frequency === "weekly" ? "regular_schedule" : "once";
  const settings = await import("./balanceService").then(({ getServiceFeeSettings }) => getServiceFeeSettings(client as any));
  const calculatedVisits: CalculatedExpandedVisit[] = visits.map((visit) => {
    const effectiveDurationMinutes = calculateEffectiveVisitDuration(visit.durationMinutes, resolvedTasks, input.taskFieldValues ?? {});
    if (timeToMinutes(visit.startTime) + effectiveDurationMinutes > 24 * 60) {
      throw validationError([{ path: "schedule", message: "С учётом сопровождения визит должен завершиться в пределах суток." }]);
    }
    const pricingBreakdown = [...pricingGroups.values()].map(({ pricing, coveredTaskKeys }) => ({
      pricingRuleId: pricing.id,
      min: pricing.recommendedMinPrice,
      max: pricing.recommendedMaxPrice,
      amount: calculateRecommendedAmount(
        pricing.recommendedMinPrice,
        pricing.recommendedMaxPrice,
        frequencyCode,
        pricingDurationMinutes(visit.durationMinutes, coveredTaskKeys, resolvedTasks, input.taskFieldValues ?? {}),
        pricing.defaultDurationMinutes ?? pricingDurationMinutes(visit.durationMinutes, coveredTaskKeys, resolvedTasks, input.taskFieldValues ?? {})
      ),
      packageCode: pricing.recommendedPackageCode,
      coveredTaskKeys,
      comment: pricing.priceComment
    }));
    const coveredTaskKeys = new Set(pricingBreakdown.filter((item) => item.amount !== null).flatMap((item) => item.coveredTaskKeys));
    const unpricedTasks = resolvedTasks.filter((task) => !coveredTaskKeys.has(taskIdentityKey(task)));
    const calculatedSubtotal = pricingBreakdown.reduce((sum, item) => sum + (item.amount ?? 0), 0);
    const calculatedHelpPrice = unpricedTasks.length > 0 ? null : calculatedSubtotal;
    return {
      ...visit,
      endTime: minutesToTime(timeToMinutes(visit.startTime) + effectiveDurationMinutes),
      durationMinutes: effectiveDurationMinutes,
      scheduledEnd: new Date(new Date(visit.scheduledStart).getTime() + effectiveDurationMinutes * 60_000).toISOString(),
      calculatedEndTime: minutesToTime(timeToMinutes(visit.startTime) + effectiveDurationMinutes),
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
  const distinctVisitPricing = new Set(calculatedVisits.map((visit) => JSON.stringify({
    durationMinutes: visit.durationMinutes,
    calculatedHelpPrice: visit.calculatedHelpPrice,
    pricing: visit.pricingBreakdown.map((row) => ({ pricingRuleId: row.pricingRuleId, amount: row.amount }))
  })));
  const perVisitHelpAmount = !hasUnpricedTasks && distinctAmounts.size === 1 && distinctVisitPricing.size === 1 ? exactAmounts[0] : null;
  const customerServiceFeeTotal = visits.length * settings.clientServiceFeeAmount;
  const helperServiceFeeTotal = visits.length * settings.performerCommissionAmount;
  const pricedRules = [...pricingGroups.values()].map(({ pricing, coveredTaskKeys }) => ({
    pricingRuleId: pricing.id,
    min: pricing.recommendedMinPrice,
    max: pricing.recommendedMaxPrice,
    packageCode: pricing.recommendedPackageCode,
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
  const warnings = [
    warning,
    ...appliedSafetyRules.filter((rule) => rule.result === "warning").map((rule) => rule.description),
    hasUnpricedTasks ? "Часть выбранных задач не имеет активного ценового правила. Рассчитанная часть показана отдельно, итог согласуется в чате." : null
  ].filter((item): item is string => Boolean(item));
  return {
    missingFields: [],
    selectedTasks: resolvedTasks,
    taskFieldValues: input.taskFieldValues ?? {},
    expandedVisits: calculatedVisits,
    visitCount: visits.length,
    totalDurationMinutes: calculatedVisits.reduce((sum, visit) => sum + visit.durationMinutes, 0),
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
    structureLayers: effective.layers.map((layer: any) => ({ id: layer.id, title: layer.title, versionNumber: layer.versionNumber, scopeType: layer.scopeType })),
    effectiveStructure: { id: effective.structure.id, title: effective.structure.title, versionNumber: effective.structure.versionNumber, scopeType: effective.structure.scopeType },
    pricingSource: "effective_category_structure",
    fallbackStatus: effective.status,
    sourceMessage: effective.status === "local_ready"
      ? `База расчёта: ${city.name} v${effective.structure.versionNumber}.`
      : effective.status === "uses_region_fallback"
        ? `База расчёта: ${city.region} v${effective.structure.versionNumber}. Для ${city.name} локальная структура пока не опубликована.`
        : `База расчёта: базовая структура РФ v${effective.structure.versionNumber}. Локальные ориентиры для города пока не заданы.`,
    warnings,
    appliedSafetyRules,
    calculatedAt: new Date().toISOString()
  };
}

export async function validateMultiTaskSafety(input: { cityId: string; selectedTasks: SelectedRequestTask[]; taskFieldValues?: Record<string, Record<string, unknown>> }, client: DbClient = prisma) {
  const catalog = await categoriesForCity(input.cityId, "customer", client);
  const resolvedTasks = input.selectedTasks.map((task) => resolveTaskFromCatalog(catalog.categories, task).publicTask);
  const appliedSafetyRules = evaluateApplicableSafetyRules(catalog.categories, resolvedTasks, input.taskFieldValues ?? {});
  assertNoBlockingSafetyRules(appliedSafetyRules);
  return appliedSafetyRules;
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

function resolveTaskFromCatalog(categories: any[], task: SelectedRequestTask) {
  const category = categories.find((item) => item.id === task.categoryId);
  if (!category) throw validationError([{ path: "selectedTasks", message: "Выбрана недоступная задача." }]);
  const subcategory = task.subcategoryId ? category.children?.find((item: any) => item.id === task.subcategoryId) : null;
  if (task.subcategoryId && !subcategory) throw validationError([{ path: "selectedTasks", message: "Задача не относится к выбранному направлению." }]);
  const taskContainer = subcategory ?? category;
  const template = task.taskTemplateId ? taskContainer.taskTemplates?.find((item: any) => item.id === task.taskTemplateId) : null;
  if (task.taskTemplateId && !template) throw validationError([{ path: "selectedTasks", message: "Типовая задача недоступна." }]);
  const candidates = [
    ...(taskContainer.pricingRules ?? []).map((rule: any) => ({ pricing: rule, specificity: pricingRuleMatchesTask(rule, template) ? 3 : 2 })),
    ...(subcategory ? category.pricingRules ?? [] : []).map((rule: any) => ({ pricing: rule, specificity: pricingRuleMatchesTask(rule, template) ? 3 : 1 }))
  ].filter((candidate) => pricingRuleMatchesTask(candidate.pricing, template) || isCategoryFallbackRule(candidate.pricing));
  candidates.sort(comparePricingCandidates);
  const selected = candidates[0] ?? null;
  const pricing = selected?.pricing ?? null;
  return {
    pricing,
    pricingSpecificity: selected?.specificity ?? 0,
    publicTask: {
      categoryId: category.id,
      categorySlug: category.slug,
      categoryTitle: category.title,
      subcategoryId: subcategory?.id ?? null,
      subcategorySlug: subcategory?.slug ?? null,
      subcategoryTitle: subcategory?.title ?? null,
      taskTemplateId: template?.id ?? null,
      taskTemplateSlug: template?.slug ?? null,
      taskTemplateTitle: template?.title ?? subcategory?.title ?? category.title,
      description: template?.description ?? subcategory?.descriptionForCustomer ?? category.descriptionForCustomer ?? null,
      requiresComment: template?.requiresComment ?? false,
      formFields: template?.formFields ?? [],
      recommendations: template?.recommendations ?? [],
      constraints: template?.constraints ?? {},
      durationEffect: template?.durationEffect ?? {},
      priceEffect: template?.priceEffect ?? {},
      sourceStructure: template?.sourceStructure ?? subcategory?.sourceStructure ?? category.sourceStructure,
      pricingRuleId: pricing?.id ?? null,
      pricingPackageCode: pricing?.recommendedPackageCode ?? null
    }
  };
}

function pricingRuleMatchesTask(rule: any, template: any) {
  return Boolean(template && (rule.taskTemplateId === template.id || rule.taskSlug === template.slug));
}

function isCategoryFallbackRule(rule: any) {
  return !rule.taskTemplateId && !rule.taskSlug;
}

function comparePricingCandidates(left: { pricing: any; specificity: number }, right: { pricing: any; specificity: number }) {
  if (left.specificity !== right.specificity) return right.specificity - left.specificity;
  const leftPackage = left.pricing.recommendedPackageCode ? 1 : 0;
  const rightPackage = right.pricing.recommendedPackageCode ? 1 : 0;
  if (leftPackage !== rightPackage) return rightPackage - leftPackage;
  const leftMax = left.pricing.recommendedMaxPrice ?? left.pricing.recommendedMinPrice ?? -1;
  const rightMax = right.pricing.recommendedMaxPrice ?? right.pricing.recommendedMinPrice ?? -1;
  if (leftMax !== rightMax) return rightMax - leftMax;
  const leftMin = left.pricing.recommendedMinPrice ?? -1;
  const rightMin = right.pricing.recommendedMinPrice ?? -1;
  if (leftMin !== rightMin) return rightMin - leftMin;
  return `${left.pricing.taskSlug ?? ""}:${left.pricing.id}`.localeCompare(`${right.pricing.taskSlug ?? ""}:${right.pricing.id}`);
}

function buildDeterministicPricingGroups(candidates: Array<{ pricing: any | null; specificity: number; taskKey: string; taskSlug: string }>) {
  const ownerByTask = new Map<string, typeof candidates[number]>();
  for (const task of candidates) {
    const explicitCoverers = candidates.filter((candidate) => candidate.pricing && (candidate.pricing.coveredTaskSlugs ?? []).includes(task.taskSlug)) as Array<typeof candidates[number] & { pricing: any }>;
    const owner = [...(explicitCoverers.length ? explicitCoverers : [task])].sort(comparePricingCandidates)[0];
    ownerByTask.set(task.taskKey, owner);
  }
  const grouped = new Map<string, { pricing: any; specificity: number; coveredTaskKeys: string[] }>();
  for (const [taskKey, owner] of [...ownerByTask.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!owner.pricing) continue;
    const groupKey = owner.pricing.recommendedPackageCode ? `package:${owner.pricing.recommendedPackageCode}` : `rule:${owner.pricing.id}`;
    const current = grouped.get(groupKey);
    if (!current) grouped.set(groupKey, { pricing: owner.pricing, specificity: owner.specificity, coveredTaskKeys: [taskKey] });
    else {
      const preferred = [current, owner].sort(comparePricingCandidates)[0];
      current.pricing = preferred.pricing;
      current.specificity = preferred.specificity;
      current.coveredTaskKeys.push(taskKey);
    }
  }
  return new Map([...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, { pricing: value.pricing, coveredTaskKeys: value.coveredTaskKeys.sort() }]));
}

type AppliedSafetyRule = {
  id: string;
  ruleKey: string;
  title: string;
  description: string;
  severity: string;
  isBlocking: boolean;
  categorySlug: string;
  taskSlug: string;
  applicability: SafetyRuleApplicability;
  sourceStructure: { id: string; scopeType: string; versionNumber: string; title: string } | null;
  result: "warning" | "passed" | "blocked";
  matchedConditions: string[];
};

function evaluateApplicableSafetyRules(categories: any[], tasks: any[], taskFieldValues: Record<string, Record<string, unknown>>): AppliedSafetyRule[] {
  const evaluated = new Map<string, AppliedSafetyRule>();
  for (const task of tasks) {
    const category = categories.find((item) => item.id === task.categoryId);
    const subcategory = task.subcategoryId ? category?.children?.find((item: any) => item.id === task.subcategoryId) : null;
    const rules = [...(category?.safetyRules ?? []), ...(subcategory?.safetyRules ?? [])];
    const taskSlug = task.taskTemplateSlug ?? task.subcategorySlug ?? task.categorySlug;
    const categorySlugs = [task.categorySlug, task.subcategorySlug].filter(Boolean);
    const values = taskFieldValues[taskIdentityKey(task)] ?? {};
    for (const rule of rules) {
      const applicability = (rule.applicability ?? {}) as SafetyRuleApplicability;
      if (applicability.appliesToTaskSlugs?.length && !applicability.appliesToTaskSlugs.includes(taskSlug)) continue;
      if (applicability.appliesToCategorySlugs?.length && !categorySlugs.some((slug) => applicability.appliesToCategorySlugs!.includes(slug))) continue;
      const conditionMatches = (applicability.conditions ?? []).every((condition) => safetyConditionMatches(condition, values[condition.fieldId]));
      if ((applicability.conditions?.length ?? 0) > 0 && !conditionMatches) continue;
      const matchedConditions: string[] = [];
      for (const forbidden of applicability.forbiddenValues ?? []) {
        if (forbidden.values.some((value) => values[forbidden.fieldId] === value)) matchedConditions.push(`forbiddenValues:${forbidden.fieldId}`);
      }
      for (const limit of applicability.numericLimits ?? []) {
        const numericValue = Number(values[limit.fieldId]);
        if (values[limit.fieldId] !== undefined && Number.isFinite(numericValue) && ((limit.minValue != null && numericValue < limit.minValue) || (limit.maxValue != null && numericValue > limit.maxValue))) matchedConditions.push(`numericLimits:${limit.fieldId}`);
      }
      for (const confirmation of applicability.requiredConfirmation ?? []) {
        if (values[confirmation.fieldId] !== (confirmation.value ?? true)) matchedConditions.push(`requiredConfirmation:${confirmation.fieldId}`);
      }
      if (applicability.conditions?.length && !(applicability.forbiddenValues?.length || applicability.numericLimits?.length || applicability.requiredConfirmation?.length)) matchedConditions.push("conditions");
      const hasConditionalApplicability = Boolean(
        applicability.conditions?.length
        || applicability.forbiddenValues?.length
        || applicability.numericLimits?.length
        || applicability.requiredConfirmation?.length
      );
      const result: AppliedSafetyRule["result"] = rule.isBlocking
        ? (!hasConditionalApplicability || matchedConditions.length > 0 ? "blocked" : "passed")
        : "warning";
      const evaluation: AppliedSafetyRule = {
        id: rule.id,
        ruleKey: rule.ruleKey,
        title: rule.title,
        description: rule.description,
        severity: rule.severity,
        isBlocking: rule.isBlocking,
        categorySlug: rule.categorySlug ?? task.categorySlug,
        taskSlug,
        applicability,
        sourceStructure: rule.sourceStructure ?? null,
        result,
        matchedConditions
      };
      const key = `${rule.id}:${taskSlug}`;
      evaluated.set(key, evaluation);
    }
  }
  return [...evaluated.values()].sort((left, right) => `${left.ruleKey}:${left.taskSlug}`.localeCompare(`${right.ruleKey}:${right.taskSlug}`));
}

function safetyConditionMatches(condition: SafetyRuleCondition, actual: unknown) {
  switch (condition.operator) {
    case "equals": return actual === condition.value;
    case "not_equals": return actual !== condition.value;
    case "in": return Array.isArray(condition.value) && condition.value.includes(actual);
    case "not_in": return Array.isArray(condition.value) && !condition.value.includes(actual);
    case "gt": return Number(actual) > Number(condition.value);
    case "gte": return Number(actual) >= Number(condition.value);
    case "lt": return Number(actual) < Number(condition.value);
    case "lte": return Number(actual) <= Number(condition.value);
    case "truthy": return Boolean(actual);
    case "falsy": return !actual;
  }
}

function assertNoBlockingSafetyRules(rules: AppliedSafetyRule[]) {
  const blocked = rules.filter((rule) => rule.result === "blocked");
  if (blocked.length) throw new HttpError(422, "Заявка нарушает ограничения сервиса", "safety_rule_blocked", { safetyRules: blocked });
}

function validateDynamicTaskFields(task: any, values: Record<string, unknown>) {
  const fields = task.formFields ?? [];
  const allowedIds = new Set(fields.map((field: any) => field.id));
  const errors: Array<{ path: string; message: string }> = Object.keys(values)
    .filter((id) => !allowedIds.has(id))
    .map((id) => ({ path: `taskFieldValues.${taskIdentityKey(task)}.${id}`, message: "Неизвестное поле задачи." }));
  errors.push(...fields.flatMap((field: any) => {
    const value = values[field.id];
    const conditionMet = !field.requiredWhen || values[field.requiredWhen.fieldId] === field.requiredWhen.equals;
    if ((field.required || (field.requiredWhen && conditionMet)) && (value === undefined || value === null || value === "" || value === false)) {
      return [{ path: `taskFieldValues.${taskIdentityKey(task)}.${field.id}`, message: `Заполните поле «${field.label}».` }];
    }
    if (field.type === "number" && value !== undefined && value !== "") {
      const number = Number(value);
      if (!Number.isFinite(number) || (field.min != null && number < field.min) || (field.max != null && number > field.max)) {
        return [{ path: `taskFieldValues.${taskIdentityKey(task)}.${field.id}`, message: `Проверьте значение поля «${field.label}».` }];
      }
    }
    if (["text", "textarea", "time", "select"].includes(field.type) && value !== undefined && value !== "" && typeof value !== "string") {
      return [{ path: `taskFieldValues.${taskIdentityKey(task)}.${field.id}`, message: `Проверьте значение поля «${field.label}».` }];
    }
    if (typeof value === "string" && value.length > (field.type === "textarea" ? 4000 : 500)) {
      return [{ path: `taskFieldValues.${taskIdentityKey(task)}.${field.id}`, message: `Поле «${field.label}» слишком длинное.` }];
    }
    if (field.type === "select" && value !== undefined && value !== "" && !(field.options ?? []).some((option: any) => option.value === value)) {
      return [{ path: `taskFieldValues.${taskIdentityKey(task)}.${field.id}`, message: `Выберите допустимое значение поля «${field.label}».` }];
    }
    if (field.type === "checkbox" && value !== undefined && typeof value !== "boolean") {
      return [{ path: `taskFieldValues.${taskIdentityKey(task)}.${field.id}`, message: `Проверьте значение поля «${field.label}».` }];
    }
    return [];
  }));
  if (errors.length) throw validationError(errors);
}

function durationEffectMinutes(task: any, taskFieldValues: Record<string, Record<string, unknown>>) {
  const fieldId = task.durationEffect?.fieldId;
  if (!fieldId) return null;
  const value = Number(taskFieldValues[taskIdentityKey(task)]?.[fieldId]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function calculateEffectiveVisitDuration(baseDurationMinutes: number, tasks: any[], taskFieldValues: Record<string, Record<string, unknown>>) {
  return tasks.reduce((duration, task) => {
    const effectMinutes = durationEffectMinutes(task, taskFieldValues);
    if (effectMinutes === null) return duration;
    if (tasks.length === 1 && task.durationEffect?.modeWhenOnlyTask === "replace_visit_duration") return effectMinutes;
    if (tasks.length > 1 && task.durationEffect?.modeWithOtherTasks === "add_to_visit_duration") return duration + effectMinutes;
    return duration;
  }, baseDurationMinutes);
}

function pricingDurationMinutes(baseDurationMinutes: number, coveredTaskKeys: string[], tasks: any[], taskFieldValues: Record<string, Record<string, unknown>>) {
  const coveredTasks = tasks.filter((task) => coveredTaskKeys.includes(taskIdentityKey(task)));
  const fieldDuration = coveredTasks.map((task) => durationEffectMinutes(task, taskFieldValues)).find((value) => value !== null);
  return fieldDuration ?? baseDurationMinutes;
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
    taskFieldValues?: Record<string, Record<string, unknown>>;
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
        taskFieldValues: input.taskFieldValues ?? calculation.taskFieldValues ?? {},
        structureLayers: calculation.structureLayers,
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
        appliedSafetyRules: calculation.appliedSafetyRules,
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
