import type { CategoryStructure, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { HttpError } from "../utils/http";
import { compareSemanticVersions } from "../utils/semanticVersion";
import { writeAudit } from "./auditService";
import { categoriesForCity, getEffectiveCategoryStructure } from "./categoryStructureService";
import { calculateMultiTaskRequest, taskIdentityKey, type SelectedRequestTask } from "./requestScheduleService";
import { sendServiceMessage } from "./serviceCommunicationService";

type DbClient = Prisma.TransactionClient | typeof prisma;
type Actor = { id: string; realRole: string };

export async function getCategoryStructureDependencies(structureId: string, client: DbClient = prisma) {
  const structure = await client.categoryStructure.findUnique({ where: { id: structureId } });
  if (!structure) throw new HttpError(404, "Структура услуг не найдена", "category_structure_not_found");
  const snapshots = await client.requestCategorySnapshot.findMany({
    where: { structureId },
    select: { requestId: true, request: { select: { id: true, publicNumber: true, status: true, clientId: true, createdAt: true, client: { select: { displayName: true } }, city: { select: { name: true } }, _count: { select: { responses: true, chats: true, agreementVersions: true, visits: true, serviceFeeBatches: true } } } } }
  });
  const requestRows = [...new Map(snapshots.map((row) => [row.requestId, row.request])).values()];
  const categoryIds = (await client.category.findMany({ where: { structureId }, select: { id: true } })).map((row) => row.id);
  const [childStructures, helperPreferences, requestUpdateRevisions, publicationAudits] = await Promise.all([
    client.categoryStructure.count({ where: { parentStructureId: structureId } }),
    categoryIds.length ? client.helperCategoryPreference.count({ where: { categoryId: { in: categoryIds } } }) : 0,
    client.requestStructureUpdateRevision.count({ where: { targetStructureId: structureId } }),
    client.auditLog.count({ where: { entityType: "category_structure", entityId: structureId, action: "admin.category_structure.publish" } })
  ]);
  const draftStatuses = new Set(["draft"]);
  const publishedStatuses = new Set(["published", "waiting_for_responses", "has_responses"]);
  const counts = {
    draftRequests: requestRows.filter((row) => draftStatuses.has(row.status)).length,
    publishedRequests: requestRows.filter((row) => publishedStatuses.has(row.status)).length,
    requestsWithResponses: requestRows.filter((row) => row._count.responses > 0).length,
    requestsWithChats: requestRows.filter((row) => row._count.chats > 0).length,
    requestsWithAgreedTerms: requestRows.filter((row) => row._count.agreementVersions > 0).length,
    agreementVersions: requestRows.reduce((sum, row) => sum + row._count.agreementVersions, 0),
    requestSnapshots: snapshots.length,
    requestVisits: requestRows.reduce((sum, row) => sum + row._count.visits, 0),
    financialBatches: requestRows.reduce((sum, row) => sum + row._count.serviceFeeBatches, 0),
    childStructures,
    helperPreferences,
    requestUpdateRevisions,
    publicationAudits
  };
  const blockers = Object.entries(counts)
    .filter(([key, count]) => count > 0 && !["publicationAudits"].includes(key))
    .map(([key, count]) => ({ code: key, count }));
  if (structure.status === "active") blockers.unshift({ code: "activeStructure", count: 1 });
  return {
    structure: { id: structure.id, scopeType: structure.scopeType, scopeKey: structure.scopeKey, versionNumber: structure.versionNumber, title: structure.title, status: structure.status, activatedAt: structure.activatedAt, publishedAt: structure.publishedAt },
    canDelete: blockers.length === 0,
    requiresHistoricalConfirmation: structure.status === "archived" && Boolean(structure.activatedAt || structure.publishedAt || publicationAudits),
    blockers,
    counts,
    requests: requestRows.map((row) => ({ id: row.id, publicNumber: row.publicNumber, status: row.status, clientId: row.clientId, clientDisplayName: row.client.displayName, city: row.city.name, createdAt: row.createdAt, canMigrate: row._count.agreementVersions === 0 && row._count.visits === 0 && row._count.serviceFeeBatches === 0 }))
  };
}

export async function deleteCategoryStructure(structureId: string, actor: Actor, input: { comment: string; confirmationPhrase?: string }) {
  return prisma.$transaction(async (tx) => {
    const dependencies = await getCategoryStructureDependencies(structureId, tx);
    const structure = await tx.categoryStructure.findUniqueOrThrow({ where: { id: structureId } });
    if (structure.status === "active") throw new HttpError(409, "Опубликованную структуру удалить нельзя", "category_structure_active_delete_forbidden");
    if (structure.status === "draft" && (structure.activatedAt || structure.publishedAt)) throw new HttpError(409, "Ранее опубликованную версию необходимо хранить в истории", "category_structure_history_required");
    if (!dependencies.canDelete) throw new HttpError(409, "Структура используется и не может быть удалена", "structure_has_dependencies", dependencies);
    if (structure.status === "archived") {
      const phrase = `УДАЛИТЬ ${scopeTitle(structure.scopeType)} v${structure.versionNumber}`;
      if (input.confirmationPhrase !== phrase) throw new HttpError(422, `Введите подтверждение: ${phrase}`, "category_structure_delete_confirmation_invalid", { confirmationPhrase: phrase });
    }
    await writeAudit(actor.id, "admin.category_structure.delete", "category_structure", structure.id, { scope: structure.scopeKey, version: structure.versionNumber, title: structure.title, status: structure.status, reason: input.comment, dependencyCheck: dependencies.counts }, tx);
    await tx.categoryStructure.delete({ where: { id: structure.id } });
    return { deleted: true, structureId, versionNumber: structure.versionNumber };
  });
}

export async function emergencyDisableCategoryStructure(structureId: string, actor: Actor, reason: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.categoryStructure.findUnique({ where: { id: structureId } });
    if (!current) throw new HttpError(404, "Структура услуг не найдена", "category_structure_not_found");
    if (current.status !== "active") throw new HttpError(409, "Экстренно отключить можно только активную структуру", "category_structure_not_active");
    const candidates = await tx.categoryStructure.findMany({ where: { scopeKey: current.scopeKey, id: { not: current.id }, status: "archived", OR: [{ activatedAt: { not: null } }, { publishedAt: { not: null } }] } });
    const fallback = candidates.sort((a, b) => compareSemanticVersions(b.versionNumber, a.versionNumber))[0] ?? null;
    if (current.scopeType === "federal" && !fallback) throw new HttpError(409, "Нельзя отключить единственную структуру РФ: безопасный fallback отсутствует", "category_structure_fallback_missing");
    const now = new Date();
    await tx.categoryStructure.update({ where: { id: current.id }, data: { status: "archived", archivedAt: now, emergencyDisabledAt: now, emergencyDisabledByAdminId: actor.id, emergencyDisableReason: reason } });
    if (fallback) await tx.categoryStructure.update({ where: { id: fallback.id }, data: { status: "active", archivedAt: null, activatedAt: now } });
    const snapshots = await tx.requestCategorySnapshot.findMany({ where: { structureId }, select: { requestId: true } });
    const requestIds = [...new Set(snapshots.map((row) => row.requestId))];
    const affected = requestIds.length ? await tx.clientRequest.findMany({ where: { id: { in: requestIds }, status: { in: ["draft", "published", "waiting_for_responses", "has_responses"] } }, select: { id: true, status: true } }) : [];
    const publishedIds = affected.filter((row) => row.status !== "draft").map((row) => row.id);
    if (publishedIds.length) await tx.clientRequest.updateMany({ where: { id: { in: publishedIds } }, data: { isHiddenFromPerformers: true, hiddenReason: "structure_update_pending", structureUpdatePendingAt: now } });
    await writeAudit(actor.id, "admin.category_structure.emergency_disable", "category_structure", current.id, { reason, fallbackStructureId: fallback?.id ?? null, affectedRequests: affected.length, hiddenPublishedRequests: publishedIds.length }, tx);
    return { disabled: true, fallbackStructure: fallback, affectedRequests: affected.length, hiddenPublishedRequests: publishedIds.length, usesParentFallback: !fallback };
  });
}

export async function getEmergencyDisablePreview(structureId: string) {
  const current = await prisma.categoryStructure.findUnique({ where: { id: structureId } });
  if (!current) throw new HttpError(404, "Структура услуг не найдена", "category_structure_not_found");
  if (current.status !== "active") throw new HttpError(409, "Экстренно отключить можно только активную структуру", "category_structure_not_active");
  const previous = (await prisma.categoryStructure.findMany({ where: { scopeKey: current.scopeKey, id: { not: current.id }, status: "archived", OR: [{ activatedAt: { not: null } }, { publishedAt: { not: null } }] } })).sort((a, b) => compareSemanticVersions(b.versionNumber, a.versionNumber))[0] ?? null;
  let fallback: CategoryStructure | null = previous;
  if (!fallback && current.scopeType === "city") fallback = await prisma.categoryStructure.findFirst({ where: { status: "active", OR: [{ scopeType: "region", scopeRegionId: current.scopeRegionId }, { scopeKey: "federal" }] }, orderBy: [{ scopeType: "desc" }, { publishedAt: "desc" }] });
  if (!fallback && current.scopeType === "region") fallback = await prisma.categoryStructure.findFirst({ where: { scopeKey: "federal", status: "active" }, orderBy: { publishedAt: "desc" } });
  const dependencies = await getCategoryStructureDependencies(structureId);
  return { current: dependencies.structure, fallbackStructure: fallback ? { id: fallback.id, title: fallback.title, scopeType: fallback.scopeType, versionNumber: fallback.versionNumber } : null, affectedRequests: dependencies.requests.length, publishedRequestsToHide: dependencies.counts.publishedRequests, agreedRequestsBlocked: dependencies.requests.filter((request) => !request.canMigrate).length, canDisable: Boolean(fallback) };
}

export async function startRequestStructureUpdate(targetStructureId: string, requestId: string, actor: Actor) {
  const target = await prisma.categoryStructure.findUnique({ where: { id: targetStructureId } });
  if (!target) throw new HttpError(404, "Структура услуг не найдена", "category_structure_not_found");
  if (target.status !== "active") throw new HttpError(409, "Актуализация возможна только по активной структуре", "category_structure_not_active");
  const request = await prisma.clientRequest.findUnique({ where: { id: requestId }, include: { categorySnapshots: { orderBy: { createdAt: "desc" }, take: 1 }, responses: { select: { performerId: true } }, chats: { select: { performerId: true, agreementFinalizedAt: true } }, agreementVersions: true, visits: true, serviceFeeBatches: true } });
  if (!request) throw new HttpError(404, "Заявка не найдена", "request_not_found");
  if (request.agreementVersions.length || request.visits.length || request.serviceFeeBatches.length || request.chats.some((chat) => chat.agreementFinalizedAt)) throw new HttpError(409, "Согласованную заявку нельзя актуализировать без новой версии условий и финансовой delta", "request_structure_update_financial_delta_required");
  const currentSnapshot = request.categorySnapshots[0];
  if (!currentSnapshot) throw new HttpError(409, "У заявки отсутствует snapshot структуры", "request_structure_snapshot_missing");
  const oldSnapshot = JSON.parse(currentSnapshot.snapshotJson);
  const effective = await getEffectiveCategoryStructure(request.cityId);
  if (!effective.layers.some((layer) => layer.id === target.id)) throw new HttpError(409, "Выбранная структура не входит в effective structure города заявки", "request_structure_target_not_effective");
  const catalog = await categoriesForCity(request.cityId, "customer");
  const available = catalog.categories.flatMap((category) => (category.children ?? [category]).flatMap((subcategory: any) => (subcategory.taskTemplates ?? []).map((task: any) => ({ category, subcategory: subcategory === category ? null : subcategory, task }))));
  const oldTasks = Array.isArray(oldSnapshot.selectedTasks) ? oldSnapshot.selectedTasks : [];
  const matches = oldTasks.map((oldTask: any) => ({ oldTask, found: available.find((row: any) => row.category.slug === oldTask.categorySlug && (row.subcategory?.slug ?? null) === (oldTask.subcategorySlug ?? null) && row.task.slug === oldTask.taskTemplateSlug) }));
  const removed = matches.filter((row: any) => !row.found).map((row: any) => row.oldTask.taskTemplateSlug);
  if (removed.length) throw new HttpError(409, "В новой структуре отсутствуют выбранные задачи. Требуется ручная проверка", "request_structure_tasks_removed", { removedTasks: removed });
  const selectedTasks: SelectedRequestTask[] = matches.map((row: any) => ({ categoryId: row.found.category.id, subcategoryId: row.found.subcategory?.id ?? null, taskTemplateId: row.found.task.id }));
  const oldValues = oldSnapshot.taskFieldValues ?? {};
  const taskFieldValues = Object.fromEntries(selectedTasks.map((task, index) => [taskIdentityKey(task), oldValues[taskIdentityKey(oldTasks[index])] ?? {}]));
  const calculation = await calculateMultiTaskRequest({ cityId: request.cityId, selectedTasks, taskFieldValues, frequency: oldSnapshot.frequencyCode, schedule: oldSnapshot.scheduleRules });
  const proposed = { ...oldSnapshot, structureId: calculation.sourceStructure.id, structureTitle: calculation.sourceStructure.title, structureVersion: calculation.sourceStructure.versionNumber, structureScopeType: calculation.sourceStructure.scopeType, selectedTasks: calculation.selectedTasks, taskFieldValues, structureLayers: calculation.structureLayers, preliminaryExpandedVisits: calculation.expandedVisits, visitCount: calculation.visitCount, totalDurationMinutes: calculation.totalDurationMinutes, calculatedRecommendedPrice: calculation.perVisitHelpAmount, finalCalculatedRecommendedPrice: calculation.totalHelpAmount, pricingBreakdown: calculation.pricedRules, unpricedTasks: calculation.unpricedTasks, appliedSafetyRules: calculation.appliedSafetyRules, safetyRulesShown: calculation.warnings, calculatedAt: calculation.calculatedAt };
  const comparison = { preservedTasks: matches.map((row: any) => row.oldTask.taskTemplateSlug), removedTasks: removed, oldStructureVersion: oldSnapshot.structureVersion, newStructureVersion: proposed.structureVersion, oldTotal: oldSnapshot.finalCalculatedRecommendedPrice, newTotal: proposed.finalCalculatedRecommendedPrice };
  const now = new Date();
  const revision = await prisma.$transaction(async (tx) => {
    const existing = await tx.requestStructureUpdateRevision.findFirst({ where: { requestId, status: "pending_customer_confirmation" } });
    if (existing) return existing;
    const created = await tx.requestStructureUpdateRevision.create({ data: { requestId, targetStructureId, previousSnapshotId: currentSnapshot.id, previousSnapshotJson: currentSnapshot.snapshotJson, proposedSnapshotJson: JSON.stringify(proposed), comparisonJson: JSON.stringify(comparison), initiatedByAdminId: actor.id } });
    if (request.status !== "draft") await tx.clientRequest.update({ where: { id: requestId }, data: { isHiddenFromPerformers: true, hiddenReason: "structure_update_pending", structureUpdatePendingAt: now } });
    await tx.chat.updateMany({ where: { requestId, agreementFinalizedAt: null }, data: { clientConfirmedAt: null, performerConfirmedAt: null, agreedByCustomerAt: null, agreedByHelperAt: null, structureTermsStaleAt: now } });
    await writeAudit(actor.id, "admin.request.structure_update.start", "request", requestId, { revisionId: created.id, targetStructureId, comparison }, tx);
    return created;
  });
  await sendServiceMessage(actor, request.clientId, { messageType: "service_message", title: "Проверьте обновление заявки", body: "Структура услуг обновилась. Заявка временно скрыта от Помощников. Проверьте обновлённые данные и подтвердите их.", relatedRequestId: request.id, clientRequestId: `structure-update:${revision.id}:customer` });
  const helperIds = [...new Set([...request.responses.map((row) => row.performerId), ...request.chats.map((row) => row.performerId)])];
  await Promise.all(helperIds.map((userId) => sendServiceMessage(actor, userId, { messageType: "service_message", title: "Условия заявки обновляются", body: `Заявка ${request.publicNumber ?? request.id} временно скрыта: Заказчик проверяет обновлённые данные.`, clientRequestId: `structure-update:${revision.id}:helper:${userId}` })));
  return { ...revision, comparison, proposedSnapshot: proposed };
}

export async function confirmRequestStructureUpdate(revisionId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const revision = await tx.requestStructureUpdateRevision.findUnique({ where: { id: revisionId }, include: { request: true } });
    if (!revision) throw new HttpError(404, "Обновление заявки не найдено", "request_structure_update_not_found");
    if (revision.request.clientId !== userId) throw new HttpError(403, "Подтвердить обновление может только Заказчик", "forbidden");
    if (revision.status !== "pending_customer_confirmation") return { revision, idempotent: true };
    const proposed = JSON.parse(revision.proposedSnapshotJson);
    const snapshot = await tx.requestCategorySnapshot.create({ data: { requestId: revision.requestId, structureId: proposed.structureId, categoryId: proposed.selectedTasks?.[0]?.categoryId ?? null, subcategoryId: proposed.selectedTasks?.[0]?.subcategoryId ?? null, taskTemplateId: proposed.selectedTasks?.[0]?.taskTemplateId ?? null, snapshotJson: revision.proposedSnapshotJson } });
    const updated = await tx.requestStructureUpdateRevision.update({ where: { id: revision.id }, data: { status: "applied", customerConfirmedAt: new Date(), appliedSnapshotId: snapshot.id } });
    await tx.clientRequest.update({ where: { id: revision.requestId }, data: { isHiddenFromPerformers: false, hiddenReason: null, structureUpdatePendingAt: null, pricingBreakdownJson: JSON.stringify(proposed), priceEstimateAmount: proposed.finalCalculatedRecommendedPrice ?? null, budgetAmount: proposed.finalCalculatedRecommendedPrice ?? null } });
    await writeAudit(userId, "user.request.structure_update.confirm", "request", revision.requestId, { revisionId: revision.id, snapshotId: snapshot.id }, tx);
    return { revision: updated, snapshot, idempotent: false };
  });
}

export async function cancelRequestStructureUpdate(revisionId: string, actor: Actor, reason: string) {
  return prisma.$transaction(async (tx) => {
    const revision = await tx.requestStructureUpdateRevision.findUnique({ where: { id: revisionId } });
    if (!revision) throw new HttpError(404, "Обновление заявки не найдено", "request_structure_update_not_found");
    if (revision.status !== "pending_customer_confirmation") throw new HttpError(409, "Обновление уже завершено", "request_structure_update_not_pending");
    const updated = await tx.requestStructureUpdateRevision.update({ where: { id: revision.id }, data: { status: "cancelled", cancelledAt: new Date(), cancelledByAdminId: actor.id, cancellationReason: reason } });
    await tx.clientRequest.update({ where: { id: revision.requestId }, data: { isHiddenFromPerformers: false, hiddenReason: null, structureUpdatePendingAt: null } });
    await writeAudit(actor.id, "admin.request.structure_update.cancel", "request", revision.requestId, { revisionId, reason }, tx);
    return updated;
  });
}

function scopeTitle(scopeType: string) {
  return scopeType === "federal" ? "РФ" : scopeType === "region" ? "РЕГИОН" : "ГОРОД";
}
