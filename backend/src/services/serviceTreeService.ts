import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { HttpError } from "../utils/http";
import { categoriesForCity, getEffectiveCategoryStructure } from "./categoryStructureService";
import { getServiceFeeSettings } from "./balanceService";
import { expandRequestSchedule, flattenRequestCatalog, type RequestScheduleInput } from "./requestScheduleService";

type DbClient = Prisma.TransactionClient | typeof prisma;

export type EffectiveServiceNode = {
  id: string;
  slug: string;
  stableKey: string;
  parentSlug: string | null;
  nodeType: string;
  title: string;
  description: string | null;
  helperDescription: string | null;
  sortOrder: number;
  isSelectable: boolean;
  isVisible: boolean;
  selectionMode: string;
  aliases: string[];
  formFields: Array<Record<string, unknown>>;
  constraints: Record<string, unknown>;
  durationEffect: Record<string, unknown>;
  metadata: Record<string, unknown>;
  sourceLayer: { id: string; scopeType: string; versionNumber: string };
  path: string[];
  children: EffectiveServiceNode[];
};

export type EffectiveServiceRelation = {
  sourceSlug: string;
  targetSlug: string;
  relationType: string;
  conditions: Record<string, unknown>;
  pricingBehavior: string | null;
  uiBehavior: string | null;
  sortOrder: number;
  sourceLayerId: string;
};

export async function getEffectiveServiceTree(cityId: string, client: DbClient = prisma) {
  const effective = await getEffectiveCategoryStructure(cityId, client);
  if (!effective.structure) throw new HttpError(409, "Для города не настроена структура услуг", "category_structure_missing");
  const layerIds = effective.layers.map((layer) => layer.id);
  const [nodes, relations, pricingRules, safetyRules] = await Promise.all([
    client.serviceNode.findMany({ where: { structureId: { in: layerIds } }, include: { parent: { select: { slug: true, stableKey: true } } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    client.serviceNodeRelation.findMany({ where: { structureId: { in: layerIds } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    client.serviceNodePricingRule.findMany({ where: { structureId: { in: layerIds } }, orderBy: { createdAt: "asc" } }),
    client.serviceNodeSafetyRule.findMany({ where: { structureId: { in: layerIds } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })
  ]);
  if (nodes.length === 0) return legacyTree(cityId, effective, client);

  const layerOrder = new Map(effective.layers.map((layer, index) => [layer.id, index]));
  const layerById = new Map(effective.layers.map((layer) => [layer.id, layer]));
  const effectiveNodes = new Map<string, any>();
  for (const row of [...nodes].sort((a, b) => (layerOrder.get(a.structureId) ?? 0) - (layerOrder.get(b.structureId) ?? 0))) {
    const layer = layerById.get(row.structureId)!;
    effectiveNodes.set(row.stableKey, {
      id: row.id, slug: row.slug, stableKey: row.stableKey,
      parentSlug: row.parent?.stableKey ?? null, nodeType: row.nodeType, title: row.title,
      description: row.descriptionForCustomer, helperDescription: row.descriptionForHelper,
      sortOrder: row.sortOrder, isSelectable: row.isSelectable, isVisible: row.isVisible && row.isActive,
      selectionMode: row.selectionMode, aliases: parseArray(row.aliasesJson), formFields: parseArray(row.formFieldsJson),
      constraints: parseObject(row.constraintsJson), durationEffect: parseObject(row.durationEffectJson), metadata: parseObject(row.metadataJson),
      sourceLayer: { id: layer.id, scopeType: layer.scopeType, versionNumber: layer.versionNumber }, children: [], path: []
    });
  }
  const activeNodes = [...effectiveNodes.values()].filter((node) => node.isVisible);
  const bySlug = new Map(activeNodes.flatMap((node) => [[node.slug, node], [node.stableKey, node]]));
  const roots: EffectiveServiceNode[] = [];
  for (const node of activeNodes) {
    const parent = node.parentSlug ? bySlug.get(node.parentSlug) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const assignPaths = (items: EffectiveServiceNode[], path: string[], depth: number) => {
    if (depth > 64) throw new HttpError(409, "Структура услуг повреждена: превышена допустимая глубина", "service_tree_depth_guard");
    for (const node of items.sort(sortNodes)) {
      node.path = [...path, node.slug];
      assignPaths(node.children, node.path, depth + 1);
    }
  };
  assignPaths(roots, [], 1);

  const relationMap = new Map<string, EffectiveServiceRelation & { active: boolean }>();
  for (const row of [...relations].sort((a, b) => (layerOrder.get(a.structureId) ?? 0) - (layerOrder.get(b.structureId) ?? 0))) {
    relationMap.set(`${row.sourceSlug}:${row.targetSlug}:${row.relationType}`, {
      sourceSlug: bySlug.get(row.sourceSlug)?.slug ?? row.sourceSlug,
      targetSlug: bySlug.get(row.targetSlug)?.slug ?? row.targetSlug,
      relationType: row.relationType, conditions: parseObject(row.conditionsJson), pricingBehavior: row.pricingBehavior,
      uiBehavior: row.uiBehavior, sortOrder: row.sortOrder, sourceLayerId: row.structureId, active: row.isActive
    });
  }
  const effectivePricing = mergeByLayer(pricingRules, layerOrder, (row) => row.nodeSlug);
  const effectiveSafety = mergeByLayer(safetyRules, layerOrder, (row) => row.ruleKey);
  return {
    schemaVersion: "3",
    status: effective.status,
    structure: { id: effective.structure.id, title: effective.structure.title, versionNumber: effective.structure.versionNumber, scopeType: effective.structure.scopeType },
    layers: effective.layers.map((layer) => ({ id: layer.id, title: layer.title, versionNumber: layer.versionNumber, scopeType: layer.scopeType })),
    roots,
    flatNodes: activeNodes.sort(sortNodes),
    relations: [...relationMap.values()].filter((row) => row.active).map(({ active: _active, ...row }) => row),
    pricingRules: [...effectivePricing.values()].filter((row) => row.isActive).map((row) => ({ id: row.id, nodeSlug: row.nodeSlug, packageCode: row.packageCode, coveredNodeSlugs: parseArray(row.coveredNodeSlugsJson), recommendedMinPrice: row.recommendedMinPrice, recommendedMaxPrice: row.recommendedMaxPrice, defaultDurationMinutes: row.defaultDurationMinutes, priceComment: row.priceComment, sourceLayerId: row.structureId })),
    safetyRules: [...effectiveSafety.values()].filter((row) => row.isActive).map((row) => ({ id: row.id, nodeSlug: row.nodeSlug, ruleKey: row.ruleKey, title: row.title, description: row.description, severity: row.severity, isBlocking: row.isBlocking, applicability: parseObject(row.applicabilityJson), sourceLayerId: row.structureId }))
  };
}

export async function calculateServiceTreeQuote(input: {
  cityId: string;
  selectedNodeSlugs: string[];
  dynamicFieldValues?: Record<string, Record<string, unknown>>;
  visits?: Array<{ id: string; date: string; startTime: string; durationMinutes: number }>;
  schedule?: RequestScheduleInput;
}, client: DbClient = prisma) {
  const tree = await getEffectiveServiceTree(input.cityId, client);
  const bySlug = new Map(tree.flatNodes.flatMap((node: EffectiveServiceNode) => [[node.slug, node], [node.stableKey, node]]));
  const selected = [...new Set(input.selectedNodeSlugs)].sort();
  const invalid = selected.filter((slug) => !bySlug.get(slug)?.isSelectable);
  if (invalid.length) throw new HttpError(400, "Выбраны недоступные узлы", "service_node_selection_invalid", { slugs: invalid });
  const relations = tree.relations.filter((relation: EffectiveServiceRelation) => relationApplies(relation, input.dynamicFieldValues ?? {}));
  const selectedSet = new Set(selected.map((slug) => bySlug.get(slug)!.slug));
  const includedBy = new Map<string, string>();
  const includeQueue = [...selectedSet];
  while (includeQueue.length) {
    const source = includeQueue.shift()!;
    for (const relation of relations.filter((row: EffectiveServiceRelation) => row.sourceSlug === source && ["includes", "included_when_selected"].includes(row.relationType))) {
      if (!includedBy.has(relation.targetSlug)) {
        includedBy.set(relation.targetSlug, source);
        includeQueue.push(relation.targetSlug);
      }
    }
  }
  validateDynamicFields([...selectedSet].map((slug) => bySlug.get(slug)!), input.dynamicFieldValues ?? {});
  for (const relation of tree.relations.filter((row: EffectiveServiceRelation) => row.relationType === "conditional")) {
    if (selectedSet.has(relation.targetSlug) && !relationApplies(relation, input.dynamicFieldValues ?? {})) {
      throw new HttpError(400, `Задача «${bySlug.get(relation.targetSlug)?.title}» недоступна при выбранных условиях`, "service_node_condition_not_met");
    }
  }
  for (const relation of relations) {
    if (relation.relationType === "requires" && selectedSet.has(relation.sourceSlug) && !selectedSet.has(relation.targetSlug) && !includedBy.has(relation.targetSlug)) throw new HttpError(400, `Для «${bySlug.get(relation.sourceSlug)?.title}» требуется «${bySlug.get(relation.targetSlug)?.title}»`, "service_node_required");
    if (relation.relationType === "excludes" && selectedSet.has(relation.sourceSlug) && selectedSet.has(relation.targetSlug)) throw new HttpError(400, "Выбранные задачи несовместимы", "service_node_excluded", { sourceSlug: relation.sourceSlug, targetSlug: relation.targetSlug });
    if (relation.relationType === "alternative_to" && selectedSet.has(relation.sourceSlug) && selectedSet.has(relation.targetSlug)) throw new HttpError(400, "Выберите только один из альтернативных вариантов", "service_node_alternative_conflict");
  }

  const priceBySlug = new Map(tree.pricingRules.map((rule: any) => [rule.nodeSlug, rule]));
  const covered = new Set(includedBy.keys());
  const lines: any[] = [];
  const resolved = [...selectedSet].sort().filter((slug) => !covered.has(slug)).map((slug) => ({ slug, node: bySlug.get(slug)!, ...resolvePricing(bySlug.get(slug)!, bySlug, priceBySlug) }));
  const packageOwner = new Map<string, string>();
  for (const item of resolved) {
    if (!item.rule?.packageCode) continue;
    const key = `${item.rule.packageCode}:${item.rule.sourceLayerId}`;
    if (!packageOwner.has(key)) packageOwner.set(key, item.slug);
    for (const coveredSlug of item.rule.coveredNodeSlugs ?? []) if (selectedSet.has(coveredSlug) && coveredSlug !== packageOwner.get(key)) covered.add(coveredSlug);
  }
  for (const item of resolved) {
    const { slug, node, rule, source } = item;
    if (covered.has(slug)) continue;
    if (!rule) {
      lines.push({ nodeSlug: slug, path: node.path, title: node.title, amount: null, pricingSource: "unpriced", includedChildren: includedFor(slug, includedBy, bySlug) });
      continue;
    }
    const packageKey = rule.packageCode ? `${rule.packageCode}:${rule.sourceLayerId}` : null;
    if (packageKey && packageOwner.get(packageKey) !== slug) continue;
    lines.push({ nodeSlug: slug, path: node.path, title: node.title, amount: recommendedAmount(rule), minAmount: rule.recommendedMinPrice, maxAmount: rule.recommendedMaxPrice, pricingSource: source, packageTitle: rule.priceComment, includedChildren: includedFor(slug, includedBy, bySlug) });
  }
  const unpricedNodes = lines.filter((line) => line.amount == null).map((line) => ({ nodeSlug: line.nodeSlug, title: line.title, path: line.path }));
  const perVisitAmount = lines.reduce((sum, line) => sum + (line.amount ?? 0), 0);
  const expandedVisits = input.schedule
    ? expandRequestSchedule(input.schedule, (await client.city.findUniqueOrThrow({ where: { id: input.cityId }, select: { timezone: true } })).timezone)
    : input.visits?.length ? input.visits : [{ id: "visit-1", date: "", startTime: "", durationMinutes: 0 }];
  const visits = expandedVisits.map((visit, index) => ({ ...visit, sequence: index + 1, lineItems: lines, helpAmount: unpricedNodes.length ? null : perVisitAmount, calculatedSubtotal: perVisitAmount }));
  const fees = await getServiceFeeSettings(client as any);
  const totalDurationMinutes = visits.reduce((sum, visit) => sum + visit.durationMinutes, 0);
  return {
    schemaVersion: "3",
    selectedNodes: [...selectedSet].map((slug) => nodeSummary(bySlug.get(slug)!)),
    includedNodes: [...includedBy].map(([slug, sourceSlug]) => ({ ...nodeSummary(bySlug.get(slug)!), includedBy: sourceSlug })),
    separatelyPricedNodes: lines,
    relationsApplied: relations.filter((relation: EffectiveServiceRelation) => selectedSet.has(relation.sourceSlug)),
    perVisit: visits,
    totals: {
      visitCount: visits.length,
      totalDurationMinutes,
      helpAmount: unpricedNodes.length ? null : perVisitAmount * visits.length,
      calculatedSubtotal: perVisitAmount * visits.length,
      customerServiceFeeTotal: fees.clientServiceFeeAmount * visits.length,
      helperServiceFeeTotal: fees.performerCommissionAmount * visits.length
    },
    unpricedNodes,
    warnings: unpricedNodes.length ? ["Часть выбранных задач требует согласования стоимости."] : [],
    safetyResults: tree.safetyRules.filter((rule: any) => !rule.nodeSlug || selectedSet.has(rule.nodeSlug)),
    structure: tree.structure,
    structureLayers: tree.layers
  };
}

async function legacyTree(cityId: string, effective: any, client: DbClient) {
  const catalog = await categoriesForCity(cityId, "customer", client);
  const { directions } = flattenRequestCatalog(catalog);
  const roots: EffectiveServiceNode[] = directions.map((direction: any) => ({
    id: direction.id, slug: direction.slug, stableKey: direction.slug, parentSlug: null, nodeType: "category", title: direction.title,
    description: direction.subtitle ?? null, helperDescription: null, sortOrder: 100, isSelectable: false, isVisible: true,
    selectionMode: "multiple", aliases: [], formFields: [], constraints: {}, durationEffect: {}, metadata: { compatibility: "category_task_template_v2" },
    sourceLayer: { id: direction.structureId ?? effective.structure.id, scopeType: effective.structure.scopeType, versionNumber: effective.structure.versionNumber }, path: [direction.slug],
    children: direction.tasks.map((task: any, index: number) => ({ id: task.id, slug: task.taskTemplateSlug ?? task.slug, stableKey: task.taskTemplateSlug ?? task.slug, parentSlug: direction.slug, nodeType: "task", title: task.title, description: task.description ?? null, helperDescription: task.helperHint ?? null, sortOrder: index * 10, isSelectable: true, isVisible: true, selectionMode: "multiple", aliases: task.aliases ?? [], formFields: task.formFields ?? [], constraints: task.constraints ?? {}, durationEffect: task.durationEffect ?? {}, metadata: { compatibilitySelection: { categoryId: task.categoryId, subcategoryId: task.subcategoryId, taskTemplateId: task.taskTemplateId } }, sourceLayer: { id: task.structureId ?? effective.structure.id, scopeType: effective.structure.scopeType, versionNumber: effective.structure.versionNumber }, path: [direction.slug, task.taskTemplateSlug ?? task.slug], children: [] }))
  }));
  return { schemaVersion: "2-compat", status: effective.status, structure: { id: effective.structure.id, title: effective.structure.title, versionNumber: effective.structure.versionNumber, scopeType: effective.structure.scopeType }, layers: effective.layers.map((layer: any) => ({ id: layer.id, title: layer.title, versionNumber: layer.versionNumber, scopeType: layer.scopeType })), roots, flatNodes: roots.flatMap((root) => [root, ...root.children]), relations: directions.flatMap((direction: any) => direction.tasks.flatMap((task: any) => (task.recommendations ?? []).map((item: any) => ({ sourceSlug: task.taskTemplateSlug ?? task.slug, targetSlug: item.taskSlug, relationType: "suggests", conditions: {}, pricingBehavior: null, uiBehavior: null, sortOrder: 100, sourceLayerId: effective.structure.id })))), pricingRules: [], safetyRules: directions.flatMap((direction: any) => direction.safetyRules ?? []) };
}

function resolvePricing(node: EffectiveServiceNode, bySlug: Map<string, EffectiveServiceNode>, priceBySlug: Map<string, any>) {
  let current: EffectiveServiceNode | undefined = node;
  let distance = 0;
  while (current) {
    const rule = priceBySlug.get(current.slug) ?? priceBySlug.get(current.stableKey);
    if (rule) return { rule, source: distance === 0 ? "node" : distance === 1 ? "parent" : "root" };
    current = current.parentSlug ? bySlug.get(current.parentSlug) : undefined;
    distance += 1;
  }
  return { rule: null, source: "unpriced" };
}

function recommendedAmount(rule: any) {
  if (rule.recommendedMinPrice == null && rule.recommendedMaxPrice == null) return null;
  if (rule.recommendedMinPrice == null) return rule.recommendedMaxPrice;
  if (rule.recommendedMaxPrice == null) return rule.recommendedMinPrice;
  return Math.round(((rule.recommendedMinPrice + rule.recommendedMaxPrice) / 2) / 50) * 50;
}
function includedFor(source: string, includedBy: Map<string, string>, bySlug: Map<string, EffectiveServiceNode>) { return [...includedBy].filter(([, parent]) => parent === source).map(([slug]) => nodeSummary(bySlug.get(slug)!)); }
function nodeSummary(node: EffectiveServiceNode) { return { nodeSlug: node.slug, title: node.title, path: node.path }; }
function relationApplies(relation: EffectiveServiceRelation, values: Record<string, Record<string, unknown>>) { const condition = relation.conditions as any; if (!condition?.fieldId) return true; const nodeValues = values[relation.sourceSlug] ?? {}; return nodeValues[condition.fieldId] === condition.equals; }
function validateDynamicFields(nodes: EffectiveServiceNode[], values: Record<string, Record<string, unknown>>) {
  const errors: Array<{ path: string; message: string }> = [];
  for (const node of nodes) {
    const nodeValues = values[node.slug] ?? {};
    for (const field of node.formFields as any[]) {
      const required = field.required || (field.requiredWhen && nodeValues[field.requiredWhen.fieldId] === field.requiredWhen.equals);
      const value = nodeValues[field.id];
      if (required && (value == null || value === "" || value === false)) errors.push({ path: `taskFieldValues.${node.slug}.${field.id}`, message: `Заполните поле «${field.label}».` });
      if (value != null && value !== "" && field.type === "number" && (!Number.isFinite(Number(value)) || (field.min != null && Number(value) < field.min) || (field.max != null && Number(value) > field.max))) errors.push({ path: `taskFieldValues.${node.slug}.${field.id}`, message: `Проверьте значение поля «${field.label}».` });
      if (value != null && value !== "" && field.type === "select" && Array.isArray(field.options) && !field.options.some((option: any) => option.value === value)) errors.push({ path: `taskFieldValues.${node.slug}.${field.id}`, message: `Выберите допустимое значение поля «${field.label}».` });
    }
  }
  if (errors.length) throw new HttpError(422, "Заполните обязательные поля выбранных задач", "service_node_fields_invalid", { validationErrors: errors });
}
function sortNodes(a: EffectiveServiceNode, b: EffectiveServiceNode) { return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "ru"); }
function parseArray(value: string) { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function parseObject(value: string) { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }
function mergeByLayer<T>(rows: T[], order: Map<string, number>, key: (row: T) => string) { const result = new Map<string, T>(); for (const row of [...rows].sort((a: any, b: any) => (order.get(a.structureId) ?? 0) - (order.get(b.structureId) ?? 0))) result.set(key(row), row); return result; }
