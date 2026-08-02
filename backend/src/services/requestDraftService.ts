import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { HttpError } from "../utils/http";
import { writeAudit } from "./auditService";
import { getEffectiveServiceTree, calculateServiceTreeQuote } from "./serviceTreeService";
import { nextRequestPublicNumber } from "./requestNumberService";
import { detectMedicalTerms } from "./requestPolicy";

type DraftInput = {
  cityId?: string | null;
  title?: string | null;
  formData?: Record<string, unknown>;
  selectedNodeSlugs?: string[];
  expandedNodeSlugs?: string[];
  dynamicFieldValues?: Record<string, Record<string, unknown>>;
  scheduleDraft?: Record<string, unknown>;
  addressDraft?: Record<string, unknown>;
  beneficiaryDraft?: Record<string, unknown>;
  latestQuote?: Record<string, unknown> | null;
  validationState?: Record<string, unknown>;
  revision?: number;
  autosave?: boolean;
};

export async function listRequestDrafts(userId: string, input: { query?: string; take?: number } = {}) {
  const rows = await prisma.requestDraft.findMany({
    where: { userId, status: "active", deletedAt: null, ...(input.query ? { title: { contains: input.query.trim() } } : {}) },
    include: { city: { select: { id: true, name: true } }, supportCases: { where: { status: { notIn: ["closed"] } }, select: { id: true, publicNumber: true, status: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" }, take: Math.min(input.take ?? 50, 100)
  });
  return rows.map((row) => draftDto(row));
}

export async function getRequestDraft(userId: string, draftId: string) {
  const row = await prisma.requestDraft.findFirst({ where: { id: draftId, userId, deletedAt: null }, include: { city: { select: { id: true, name: true } }, supportCases: { orderBy: { updatedAt: "desc" }, include: { serviceMessages: { orderBy: { createdAt: "asc" } } } } } });
  if (!row) throw new HttpError(404, "Черновик не найден", "request_draft_not_found");
  return draftDto(row, true);
}

export async function createRequestDraft(userId: string, input: DraftInput) {
  const normalized = await normalizeDraftInput(userId, input);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.requestDraft.create({ data: { userId, ...normalized, revision: 1, lastAutosavedAt: input.autosave ? new Date() : null } });
    await tx.requestDraftRevision.create({ data: { draftId: created.id, revision: 1, snapshotJson: draftSnapshot(created), changeSource: input.autosave ? "autosave" : "manual" } });
    await writeAudit(userId, "request_draft.create", "request_draft", created.id, { cityId: created.cityId, revision: 1 }, tx);
    return created;
  });
  return draftDto(row);
}

export async function updateRequestDraft(userId: string, draftId: string, input: DraftInput) {
  const current = await prisma.requestDraft.findFirst({ where: { id: draftId, userId, status: "active", deletedAt: null } });
  if (!current) throw new HttpError(404, "Черновик не найден", "request_draft_not_found");
  if (input.revision !== current.revision) throw new HttpError(409, "Черновик был изменён в другом окне", "request_draft_revision_conflict", { current: draftDto(current), expectedRevision: current.revision });
  const normalized = await normalizeDraftInput(userId, input, current);
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.requestDraft.updateMany({ where: { id: current.id, userId, revision: current.revision, status: "active", deletedAt: null }, data: { ...normalized, revision: { increment: 1 }, lastAutosavedAt: input.autosave ? new Date() : current.lastAutosavedAt } });
    if (claimed.count !== 1) throw new HttpError(409, "Черновик был изменён в другом окне", "request_draft_revision_conflict");
    const updated = await tx.requestDraft.findUniqueOrThrow({ where: { id: current.id } });
    await tx.requestDraftRevision.create({ data: { draftId: updated.id, revision: updated.revision, snapshotJson: draftSnapshot(updated), changeSource: input.autosave ? "autosave" : "manual" } });
    await writeAudit(userId, input.autosave ? "request_draft.autosave" : "request_draft.update", "request_draft", updated.id, { revision: updated.revision }, tx);
    return draftDto(updated);
  });
}

export async function duplicateRequestDraft(userId: string, draftId: string) {
  const source = await prisma.requestDraft.findFirst({ where: { id: draftId, userId, deletedAt: null } });
  if (!source) throw new HttpError(404, "Черновик не найден", "request_draft_not_found");
  return createRequestDraft(userId, { cityId: source.cityId, title: `${source.title ?? "Черновик"} — копия`, formData: parseObject(source.formDataJson), selectedNodeSlugs: parseArray(source.selectedNodeSlugsJson), expandedNodeSlugs: parseArray(source.expandedNodeSlugsJson), dynamicFieldValues: parseObject(source.dynamicFieldValuesJson) as any, scheduleDraft: parseObject(source.scheduleDraftJson), addressDraft: parseObject(source.addressDraftJson), beneficiaryDraft: parseObject(source.beneficiaryDraftJson), latestQuote: source.latestQuoteJson ? parseObject(source.latestQuoteJson) : null, validationState: parseObject(source.validationStateJson) });
}

export async function deleteRequestDraft(userId: string, draftId: string) {
  const row = await prisma.requestDraft.findFirst({ where: { id: draftId, userId, status: "active", deletedAt: null }, include: { supportCases: { where: { status: { notIn: ["resolved", "closed"] } } } } });
  if (!row) throw new HttpError(404, "Черновик не найден", "request_draft_not_found");
  await prisma.$transaction(async (tx) => {
    await tx.requestDraft.update({ where: { id: row.id }, data: { status: "deleted", deletedAt: new Date() } });
    if (row.supportCases.length) await tx.requestDraftSupportCase.updateMany({ where: { draftId: row.id, status: { notIn: ["resolved", "closed"] } }, data: { status: "closed", closedAt: new Date() } });
    await writeAudit(userId, "request_draft.delete", "request_draft", row.id, { closedSupportCases: row.supportCases.length }, tx);
  });
}

export async function publishRequestDraft(userId: string, draftId: string, expectedRevision: number) {
  const draft = await prisma.requestDraft.findFirst({ where: { id: draftId, userId, deletedAt: null } });
  if (!draft) throw new HttpError(404, "Черновик не найден", "request_draft_not_found");
  if (draft.convertedRequestId) return { requestId: draft.convertedRequestId, idempotent: true };
  if (draft.status !== "active" || draft.revision !== expectedRevision) throw new HttpError(409, "Черновик изменился перед публикацией", "request_draft_revision_conflict", { expectedRevision: draft.revision });
  const form = parseObject(draft.formDataJson) as any;
  const cityId = draft.cityId ?? stringValue(form.cityId);
  const selectedNodeSlugs = parseArray(draft.selectedNodeSlugsJson);
  const errors = validatePublishForm(form, cityId, selectedNodeSlugs);
  if (errors.length) throw new HttpError(422, "Черновик ещё не готов к публикации", "request_draft_publish_validation_failed", { validationErrors: errors });
  const medical = detectMedicalTerms(`${form.comment ?? ""} ${form.description ?? ""}`);
  if (medical.length) throw new HttpError(400, "Уберите медицинские процедуры из заявки", "medical_terms_forbidden", { matches: medical });
  const tree = await getEffectiveServiceTree(cityId!);
  const schedule = parseObject(draft.scheduleDraftJson) as any;
  const quote = await calculateServiceTreeQuote({ cityId: cityId!, selectedNodeSlugs, dynamicFieldValues: parseObject(draft.dynamicFieldValuesJson) as any, schedule });
  const visits = quote.perVisit;
  const blocking = quote.safetyResults.filter((rule: any) => rule.isBlocking && safetyApplies(rule.applicability, parseObject(draft.dynamicFieldValuesJson)));
  if (blocking.length) throw new HttpError(422, "Заявка содержит запрещённые условия", "request_safety_blocked", { blockingRules: blocking });
  const rootSlug = tree.flatNodes.find((node: any) => selectedNodeSlugs.includes(node.slug))?.path?.[0];
  const category = await prisma.serviceCategory.findFirst({ where: { isActive: true, ...(rootSlug ? { slug: rootSlug } : {}) }, orderBy: { sortOrder: "asc" } }) ?? await prisma.serviceCategory.findFirstOrThrow({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  const city = await prisma.city.findFirstOrThrow({ where: { id: cityId!, isActive: true } });
  const selectedTitles = quote.selectedNodes.map((node: any) => node.title);
  const address = parseObject(draft.addressDraftJson) as any;
  const request = await prisma.$transaction(async (tx) => {
    const fresh = await tx.requestDraft.findFirst({ where: { id: draft.id, userId, revision: expectedRevision, status: "active", convertedRequestId: null } });
    if (!fresh) {
      const latest = await tx.requestDraft.findUniqueOrThrow({ where: { id: draft.id } });
      if (latest.convertedRequestId) return tx.clientRequest.findUniqueOrThrow({ where: { id: latest.convertedRequestId } });
      throw new HttpError(409, "Черновик изменился перед публикацией", "request_draft_revision_conflict");
    }
    const publicNumber = await nextRequestPublicNumber(tx);
    const firstVisit = visits[0];
    const created = await tx.clientRequest.create({ data: {
      publicNumber, clientId: userId, cityId: city.id, categoryId: category.id,
      contactName: stringValue(form.contactName), contactPhone: stringValue(form.contactPhone), helpFor: stringValue(form.recipientType),
      dependentStateJson: JSON.stringify([form.dependentMainState, ...(Array.isArray(form.dependentStateFeatures) ? form.dependentStateFeatures : [])].filter(Boolean)),
      dependentAge: numberValue(form.dependentAge), scheduleType: stringValue(form.frequency) ?? "once",
      title: stringValue(form.title) ?? selectedTitles.slice(0, 3).join(", "), description: stringValue(form.description) ?? `Выбранные задачи: ${selectedTitles.join(", ")}.`,
      addressText: formatAddress(city.name, address), approximateAddressText: `${city.name}, ${stringValue(address.street) ?? "адрес уточняется"}`,
      addressCity: city.name, addressStreet: stringValue(address.street), addressHouse: stringValue(address.house), addressApartment: stringValue(address.apartment), addressEntrance: stringValue(address.entrance), addressFloor: stringValue(address.floor), addressIntercom: stringValue(address.intercom), addressComment: stringValue(address.comment),
      fullAddress: formatAddress(city.name, address), publicAddress: `${city.name}, ${stringValue(address.street) ?? "адрес уточняется"}`,
      date: firstVisit?.date ? new Date(`${firstVisit.date}T00:00:00.000Z`) : null, timeFrom: firstVisit?.startTime, expectedDurationHours: firstVisit ? firstVisit.durationMinutes / 60 : null,
      budgetAmount: quote.totals.helpAmount, priceEstimateAmount: quote.totals.helpAmount, pricingBreakdownJson: JSON.stringify(quote), comment: stringValue(form.comment),
      status: "waiting_for_responses", visibilityStatus: "city_visible"
    } });
    await tx.requestCategorySnapshot.create({ data: { requestId: created.id, structureId: tree.structure.id, snapshotJson: JSON.stringify({ schemaVersion: tree.schemaVersion, structure: tree.structure, structureLayers: tree.layers, selectedNodes: quote.selectedNodes, includedNodes: quote.includedNodes, relationsApplied: quote.relationsApplied, dynamicFieldValues: parseObject(draft.dynamicFieldValuesJson), pricing: quote, safetyResults: quote.safetyResults, unpricedNodes: quote.unpricedNodes, warnings: quote.warnings }) } });
    await tx.requestDraft.update({ where: { id: draft.id }, data: { status: "converted", convertedRequestId: created.id } });
    await writeAudit(userId, "request_draft.publish", "request_draft", draft.id, { requestId: created.id, publicNumber, revision: expectedRevision }, tx);
    return created;
  });
  return { requestId: request.id, publicNumber: request.publicNumber, idempotent: request.id !== draft.convertedRequestId && Boolean(draft.convertedRequestId) };
}

export async function createDraftSupportCase(userId: string, draftId: string, input: { subject: string; message: string; revision: number }) {
  const draft = await prisma.requestDraft.findFirst({ where: { id: draftId, userId, status: "active", deletedAt: null } });
  if (!draft) throw new HttpError(404, "Черновик не найден", "request_draft_not_found");
  if (draft.revision !== input.revision) throw new HttpError(409, "Сначала сохраните актуальную версию черновика", "request_draft_revision_conflict", { expectedRevision: draft.revision });
  return prisma.$transaction(async (tx) => {
    const conversation = await tx.serviceConversation.upsert({ where: { userId }, create: { userId, lastMessageAt: new Date(), unreadForAdminCount: 1 }, update: { lastMessageAt: new Date(), unreadForAdminCount: { increment: 1 }, status: "active" } });
    const publicNumber = `HELP-${new Date().getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const supportCase = await tx.requestDraftSupportCase.create({ data: { publicNumber, draftId: draft.id, clientId: userId, relatedServiceConversationId: conversation.id, subject: input.subject.trim(), initialMessage: input.message.trim(), snapshotAtCreationJson: draftSnapshot(draft), draftRevisionAtCreation: draft.revision } });
    await tx.serviceMessage.create({ data: { conversationId: conversation.id, userId, senderUserId: userId, senderRole: "client", messageType: "service_message", title: input.subject.trim(), body: input.message.trim(), relatedRequestDraftSupportCaseId: supportCase.id, metadataJson: JSON.stringify({ source: "request_draft_support", draftId: draft.id, draftRevision: draft.revision }) } });
    await writeAudit(userId, "request_draft.support_case.create", "request_draft_support_case", supportCase.id, { draftId: draft.id, revision: draft.revision }, tx);
    return supportCaseDto(supportCase);
  });
}

export async function listDraftSupportCases(actor: { id: string; realRole: string }, input: { status?: string; take?: number } = {}) {
  if (!['manager', 'superadmin'].includes(actor.realRole)) throw new HttpError(403, "Недостаточно прав", "admin_or_manager_required");
  const rows = await prisma.requestDraftSupportCase.findMany({ where: input.status ? { status: input.status } : undefined, include: { client: { select: { id: true, displayName: true, role: true } }, assignedManager: { select: { id: true, displayName: true } }, draft: { select: { id: true, title: true, cityId: true, revision: true, formDataJson: true, selectedNodeSlugsJson: true, updatedAt: true } }, serviceMessages: { orderBy: { createdAt: "asc" } } }, orderBy: { updatedAt: "desc" }, take: Math.min(input.take ?? 100, 200) });
  return rows.map((row) => ({ ...supportCaseDto(row), client: row.client, assignedManager: row.assignedManager, draft: { ...row.draft, formData: parseObject(row.draft.formDataJson), selectedNodeSlugs: parseArray(row.draft.selectedNodeSlugsJson) }, messages: row.serviceMessages.map(messageDto) }));
}

export async function replyToDraftSupportCase(actor: { id: string; realRole: string }, caseId: string, body: string) {
  if (!['manager', 'superadmin'].includes(actor.realRole)) throw new HttpError(403, "Недостаточно прав", "admin_or_manager_required");
  const supportCase = await prisma.requestDraftSupportCase.findUnique({ where: { id: caseId } });
  if (!supportCase) throw new HttpError(404, "Обращение не найдено", "request_draft_support_not_found");
  return prisma.$transaction(async (tx) => {
    const conversation = await tx.serviceConversation.upsert({ where: { userId: supportCase.clientId }, create: { userId: supportCase.clientId, lastMessageAt: new Date(), unreadForUserCount: 1 }, update: { lastMessageAt: new Date(), unreadForUserCount: { increment: 1 }, status: "active" } });
    const message = await tx.serviceMessage.create({ data: { conversationId: conversation.id, userId: supportCase.clientId, senderUserId: actor.id, senderRole: actor.realRole, messageType: "service_message", title: `Ответ по обращению ${supportCase.publicNumber}`, body: body.trim(), relatedRequestDraftSupportCaseId: supportCase.id, metadataJson: JSON.stringify({ source: "request_draft_support_reply", draftId: supportCase.draftId }) } });
    await tx.requestDraftSupportCase.update({ where: { id: caseId }, data: { status: "waiting_for_client", lastMessageAt: new Date() } });
    await writeAudit(actor.id, "request_draft.support_case.reply", "request_draft_support_case", caseId, { targetUserId: supportCase.clientId }, tx);
    return messageDto(message);
  });
}

export async function updateDraftSupportCase(actor: { id: string; realRole: string }, caseId: string, input: { status?: string; assignToMe?: boolean }) {
  if (!['manager', 'superadmin'].includes(actor.realRole)) throw new HttpError(403, "Недостаточно прав", "admin_or_manager_required");
  const status = input.status;
  const updated = await prisma.requestDraftSupportCase.update({ where: { id: caseId }, data: { ...(status ? { status, resolvedAt: status === "resolved" ? new Date() : undefined, closedAt: status === "closed" ? new Date() : undefined } : {}), ...(input.assignToMe ? { assignedManagerId: actor.id, status: status ?? "in_progress" } : {}) } });
  await writeAudit(actor.id, input.assignToMe ? "request_draft.support_case.assign" : "request_draft.support_case.status", "request_draft_support_case", caseId, { status: updated.status });
  return supportCaseDto(updated);
}

async function normalizeDraftInput(userId: string, input: DraftInput, current?: any) {
  const formData = sanitizeJson(input.formData ?? (current ? parseObject(current.formDataJson) : {}));
  const jsonSize = Buffer.byteLength(JSON.stringify(formData));
  if (jsonSize > 512 * 1024) throw new HttpError(413, "Черновик слишком большой", "request_draft_too_large");
  const cityId = input.cityId === undefined ? current?.cityId ?? null : input.cityId;
  let structureId: string | null = current?.structureId ?? null;
  let structureVersions: unknown[] = current ? parseArray(current.structureVersionsJson) : [];
  if (cityId) {
    const access = await prisma.userCity.findFirst({ where: { userId, cityId, isActive: true, roleScope: { in: ["customer", "both"] } } });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { cityId: true } });
    if (!access && user?.cityId !== cityId) throw new HttpError(403, "Город недоступен для Заказчика", "request_draft_city_forbidden");
    const tree = await getEffectiveServiceTree(cityId);
    structureId = tree.structure.id;
    structureVersions = tree.layers;
  }
  return {
    cityId, structureId, title: input.title === undefined ? current?.title ?? null : input.title?.trim() || null,
    formDataJson: JSON.stringify(formData),
    selectedNodeSlugsJson: JSON.stringify(uniqueStrings(input.selectedNodeSlugs ?? (current ? parseArray(current.selectedNodeSlugsJson) : []), 500)),
    expandedNodeSlugsJson: JSON.stringify(uniqueStrings(input.expandedNodeSlugs ?? (current ? parseArray(current.expandedNodeSlugsJson) : []), 1000)),
    dynamicFieldValuesJson: JSON.stringify(sanitizeJson(input.dynamicFieldValues ?? (current ? parseObject(current.dynamicFieldValuesJson) : {}))),
    scheduleDraftJson: JSON.stringify(sanitizeJson(input.scheduleDraft ?? (current ? parseObject(current.scheduleDraftJson) : {}))),
    addressDraftJson: JSON.stringify(sanitizeJson(input.addressDraft ?? (current ? parseObject(current.addressDraftJson) : {}))),
    beneficiaryDraftJson: JSON.stringify(sanitizeJson(input.beneficiaryDraft ?? (current ? parseObject(current.beneficiaryDraftJson) : {}))),
    structureVersionsJson: JSON.stringify(structureVersions),
    latestQuoteJson: input.latestQuote === undefined ? current?.latestQuoteJson ?? null : input.latestQuote ? JSON.stringify(sanitizeJson(input.latestQuote)) : null,
    validationStateJson: JSON.stringify(sanitizeJson(input.validationState ?? (current ? parseObject(current.validationStateJson) : {})))
  };
}

function draftDto(row: any, detailed = false) { return { id: row.id, cityId: row.cityId, city: row.city, structureId: row.structureId, status: row.status, title: row.title, revision: row.revision, lastAutosavedAt: row.lastAutosavedAt, createdAt: row.createdAt, updatedAt: row.updatedAt, convertedRequestId: row.convertedRequestId, selectedNodeSlugs: parseArray(row.selectedNodeSlugsJson), expandedNodeSlugs: detailed ? parseArray(row.expandedNodeSlugsJson) : undefined, formData: detailed ? parseObject(row.formDataJson) : undefined, dynamicFieldValues: detailed ? parseObject(row.dynamicFieldValuesJson) : undefined, scheduleDraft: detailed ? parseObject(row.scheduleDraftJson) : undefined, addressDraft: detailed ? parseObject(row.addressDraftJson) : undefined, beneficiaryDraft: detailed ? parseObject(row.beneficiaryDraftJson) : undefined, latestQuote: row.latestQuoteJson ? parseObject(row.latestQuoteJson) : null, validationState: detailed ? parseObject(row.validationStateJson) : undefined, supportCase: row.supportCases?.[0] ? supportCaseDto(row.supportCases[0]) : null, supportCases: detailed ? row.supportCases?.map((item: any) => ({ ...supportCaseDto(item), messages: item.serviceMessages?.map(messageDto) ?? [] })) : undefined }; }
function supportCaseDto(row: any) { return { id: row.id, publicNumber: row.publicNumber, draftId: row.draftId, status: row.status, subject: row.subject, priority: row.priority, assignedManagerId: row.assignedManagerId, draftRevisionAtCreation: row.draftRevisionAtCreation, lastMessageAt: row.lastMessageAt, createdAt: row.createdAt, updatedAt: row.updatedAt }; }
function messageDto(row: any) { return { id: row.id, title: row.title, body: row.body, senderRole: row.senderRole, createdAt: row.createdAt, isReadByUser: row.isReadByUser }; }
function draftSnapshot(row: any) { return JSON.stringify({ cityId: row.cityId, structureId: row.structureId, title: row.title, formData: parseObject(row.formDataJson), selectedNodeSlugs: parseArray(row.selectedNodeSlugsJson), dynamicFieldValues: parseObject(row.dynamicFieldValuesJson), scheduleDraft: parseObject(row.scheduleDraftJson), addressDraft: parseObject(row.addressDraftJson), beneficiaryDraft: parseObject(row.beneficiaryDraftJson), structureVersions: parseArray(row.structureVersionsJson), revision: row.revision }); }
function validatePublishForm(form: any, cityId: string | null | undefined, nodes: string[]) { const required: Array<[boolean, string, string]> = [[!cityId, "cityId", "Выберите город."], [nodes.length === 0, "selectedNodeSlugs", "Выберите хотя бы одну задачу."], [!stringValue(form.contactName), "contactName", "Укажите контактное лицо."], [!stringValue(form.contactPhone), "contactPhone", "Укажите телефон."], [!stringValue(form.recipientType), "recipientType", "Укажите, кому нужна помощь."], [!stringValue(form.dependentMainState), "dependentMainState", "Укажите состояние."], [!stringValue((form.address ?? {}).street) && !stringValue(form.addressStreet), "address.street", "Укажите улицу."], [!stringValue((form.address ?? {}).house) && !stringValue(form.addressHouse), "address.house", "Укажите дом."]]; return required.filter(([invalid]) => invalid).map(([, path, message]) => ({ path, message })); }
function formatAddress(city: string, address: any) { return [city, stringValue(address.street), stringValue(address.house), stringValue(address.apartment) ? `кв. ${address.apartment}` : null].filter(Boolean).join(", "); }
function safetyApplies(applicability: any, values: any) { if (!applicability || Object.keys(applicability).length === 0) return false; const conditions = Array.isArray(applicability.conditions) ? applicability.conditions : []; return conditions.length === 0 || conditions.every((condition: any) => Object.values(values).some((nodeValues: any) => nodeValues?.[condition.fieldId] === condition.value)); }
function sanitizeJson(value: unknown, depth = 0): any { if (depth > 20) throw new HttpError(400, "Черновик содержит слишком глубокие данные", "request_draft_invalid"); if (Array.isArray(value)) return value.slice(0, 5000).map((item) => sanitizeJson(item, depth + 1)); if (value && typeof value === "object") { const result: Record<string, unknown> = {}; for (const [key, child] of Object.entries(value as Record<string, unknown>)) { if (/password|token|cookie|authorization|secret/i.test(key)) continue; result[key] = sanitizeJson(child, depth + 1); } return result; } if (["string", "number", "boolean"].includes(typeof value) || value == null) return value; return String(value); }
function uniqueStrings(values: unknown[], max: number) { return [...new Set(values.filter((value): value is string => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)))].slice(0, max); }
function parseArray(value: string): any[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function parseObject(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }
function stringValue(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function numberValue(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : null; }
