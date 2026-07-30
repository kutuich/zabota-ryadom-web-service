import { Prisma } from "@prisma/client";
import { chargeAvailableBalanceTx, getServiceFeeSettings, hasAvailableBalance } from "./balanceService";
import { calculateMultiTaskRequest, expandRequestSchedule, requestTermsHash, zonedLocalToUtc, type RequestScheduleInput, type SelectedRequestTask } from "./requestScheduleService";
import { HttpError } from "../utils/http";

type Tx = Prisma.TransactionClient;

type AgreementInput = {
  agreedHelperAmount: number;
  termsComment?: string | null;
  schedule?: RequestScheduleInput | null;
  selectedTasks?: unknown[] | null;
  agreedVisits?: Array<{ visitId: string; amount: number }> | null;
};

export async function createAgreementVersionTx(tx: Tx, chat: any, actorUserId: string, input: AgreementInput) {
  const snapshotRow = await tx.requestCategorySnapshot.findFirst({
    where: { requestId: chat.requestId },
    orderBy: { createdAt: "desc" }
  });
  const snapshot = parseObject(snapshotRow?.snapshotJson);
  const schedule = input.schedule ?? (snapshot?.scheduleRules as RequestScheduleInput | undefined) ?? legacySchedule(chat);
  const selectedTasks = input.selectedTasks ?? arrayValue(snapshot?.selectedTasks);
  const timezone = chat.request.city?.timezone ?? "Asia/Yekaterinburg";
  const baseVisits = expandRequestSchedule(schedule, timezone);
  const settings = await getServiceFeeSettings(tx);
  const serverQuote = snapshot?.schemaVersion === 2 && chat.request.cityId && selectedTasks.length > 0
    ? await calculateMultiTaskRequest({
        cityId: chat.request.cityId,
        selectedTasks: selectedTasks as SelectedRequestTask[],
        frequency: schedule.frequency,
        schedule
      }, tx)
    : null;
  const quotedById = new Map((serverQuote?.expandedVisits ?? []).map((visit) => [visit.id, visit]));
  const agreedById = new Map((input.agreedVisits ?? []).map((visit) => [visit.visitId, visit.amount]));
  if (input.agreedVisits?.length && (agreedById.size !== baseVisits.length || baseVisits.some((visit) => !agreedById.has(visit.id)))) {
    throw new HttpError(400, "Укажите согласованную стоимость для каждого визита", "agreement_visit_amounts_incomplete");
  }
  const expandedVisits = baseVisits.map((visit) => {
    const quoted = quotedById.get(visit.id);
    const agreedHelpAmount = agreedById.get(visit.id) ?? input.agreedHelperAmount;
    if (!Number.isInteger(agreedHelpAmount) || agreedHelpAmount <= 0 || agreedHelpAmount > 100_000) {
      throw new HttpError(400, "Стоимость каждого визита должна быть от 1 до 100 000 ₽", "agreement_visit_amount_invalid");
    }
    return {
      ...visit,
      agreedHelpAmount,
      calculatedHelpPrice: quoted?.calculatedHelpPrice ?? null,
      pricingBreakdown: quoted?.pricingBreakdown ?? [],
      unpricedTasks: quoted?.unpricedTasks ?? [],
      customerServiceFee: settings.clientServiceFeeAmount,
      helperServiceFee: settings.performerCommissionAmount
    };
  });
  const latest = await tx.agreementVersion.findFirst({ where: { chatId: chat.id }, orderBy: { version: "desc" } });
  const version = (latest?.version ?? 0) + 1;
  const totalHelpAmount = expandedVisits.reduce((sum, visit) => sum + visit.agreedHelpAmount, 0);
  const distinctAmounts = new Set(expandedVisits.map((visit) => visit.agreedHelpAmount));
  const pricingSnapshot = {
    agreedHelpAmountPerVisit: distinctAmounts.size === 1 ? expandedVisits[0]?.agreedHelpAmount ?? input.agreedHelperAmount : null,
    totalHelpAmount,
    visits: expandedVisits.map((visit) => ({
      id: visit.id,
      sequence: visit.sequence,
      agreedHelpAmount: visit.agreedHelpAmount,
      calculatedHelpPrice: visit.calculatedHelpPrice,
      pricingBreakdown: visit.pricingBreakdown,
      unpricedTasks: visit.unpricedTasks
    })),
    customerServiceFeeAmountPerVisit: settings.clientServiceFeeAmount,
    helperServiceFeeAmountPerVisit: settings.performerCommissionAmount,
    customerServiceFeeTotal: settings.clientServiceFeeAmount * expandedVisits.length,
    helperServiceFeeTotal: settings.performerCommissionAmount * expandedVisits.length
  };
  const hashPayload = { selectedTasks, schedule, expandedVisits, pricingSnapshot, termsComment: input.termsComment ?? null };
  if (latest && latest.status !== "finalized") {
    await tx.agreementVersion.update({ where: { id: latest.id }, data: { status: "superseded", supersededAt: new Date() } });
  }
  return tx.agreementVersion.create({
    data: {
      requestId: chat.requestId,
      chatId: chat.id,
      version,
      recipientType: stringValue(snapshot?.recipientType),
      dependentSnapshotJson: JSON.stringify(snapshot?.dependent ?? null),
      selectedTasksJson: JSON.stringify(selectedTasks),
      scheduleRulesJson: JSON.stringify(schedule),
      expandedVisitsJson: JSON.stringify(expandedVisits),
      pricingSnapshotJson: JSON.stringify(pricingSnapshot),
      termsComment: input.termsComment?.trim() || null,
      visitCount: expandedVisits.length,
      totalDurationMinutes: expandedVisits.reduce((sum, visit) => sum + visit.durationMinutes, 0),
      totalHelpAmount,
      customerServiceFeeTotal: pricingSnapshot.customerServiceFeeTotal,
      helperServiceFeeTotal: pricingSnapshot.helperServiceFeeTotal,
      termsHash: requestTermsHash(hashPayload),
      createdByUserId: actorUserId
    }
  });
}

export async function confirmAgreementVersionTx(tx: Tx, chatId: string, side: "customer" | "helper", confirmedAt: Date) {
  const version = await tx.agreementVersion.findFirst({ where: { chatId, status: "draft" }, orderBy: { version: "desc" } });
  if (!version) throw new HttpError(400, "Сначала сохраните согласованные условия и график", "agreement_version_required");
  return tx.agreementVersion.update({
    where: { id: version.id },
    data: side === "customer" ? { customerConfirmedAt: confirmedAt } : { helperConfirmedAt: confirmedAt }
  });
}

export async function finalizeAgreementBatchTx(tx: Tx, chat: any, actorUserId: string) {
  const version = await tx.agreementVersion.findFirst({ where: { chatId: chat.id, status: "draft" }, orderBy: { version: "desc" } });
  if (!version) throw new HttpError(400, "Сначала сохраните согласованные условия и график", "agreement_version_required");
  if (!version.customerConfirmedAt || !version.helperConfirmedAt) return null;

  const visits = parseArray<any>(version.expandedVisitsJson);
  const pricingSnapshot = parseObject(version.pricingSnapshotJson);
  const hashPayload = {
    selectedTasks: parseArray(version.selectedTasksJson),
    schedule: parseObject(version.scheduleRulesJson),
    expandedVisits: visits,
    pricingSnapshot,
    termsComment: version.termsComment ?? null
  };
  const visitTotal = visits.reduce((sum, visit) => sum + (Number.isInteger(visit.agreedHelpAmount) ? visit.agreedHelpAmount : 0), 0);
  if (
    visits.length !== version.visitCount ||
    visits.some((visit) => !Number.isInteger(visit.agreedHelpAmount) || visit.agreedHelpAmount <= 0) ||
    visitTotal !== version.totalHelpAmount ||
    requestTermsHash(hashPayload) !== version.termsHash
  ) {
    throw new HttpError(409, "Сохранённые условия изменились. Создайте новую версию и подтвердите её повторно", "agreement_version_integrity_failed");
  }

  const existing = await tx.serviceFeeAgreementBatch.findUnique({ where: { agreementVersionId: version.id } });
  if (existing) return existing;
  const settings = await getServiceFeeSettings(tx);
  const customerTotal = version.visitCount * settings.clientServiceFeeAmount;
  const helperTotal = version.visitCount * settings.performerCommissionAmount;
  const [customer, helper] = await Promise.all([
    tx.user.findUnique({ where: { id: chat.clientId }, select: { balance: true, bonusBalance: true } }),
    tx.user.findUnique({ where: { id: chat.performerId }, select: { balance: true, bonusBalance: true } })
  ]);
  if (!customer || !helper) throw new HttpError(404, "Участник заявки не найден", "participant_not_found");
  if (!hasAvailableBalance(customer, customerTotal, true)) throw balanceError("customer", customerTotal, customer.balance + customer.bonusBalance);
  if (!hasAvailableBalance(helper, helperTotal, true)) throw balanceError("helper", helperTotal, helper.balance + helper.bonusBalance);

  const batch = await tx.serviceFeeAgreementBatch.create({
    data: {
      requestId: chat.requestId,
      chatId: chat.id,
      agreementVersionId: version.id,
      clientId: chat.clientId,
      helperId: chat.performerId,
      visitCount: version.visitCount,
      customerServiceFeeTotal: customerTotal,
      helperServiceFeeTotal: helperTotal,
      idempotencyKey: `agreement_fee_batch:${version.id}`,
      confirmedAt: new Date()
    }
  });
  const tasks = version.selectedTasksJson;
  for (const visit of visits) {
    await tx.requestVisit.create({
      data: {
        requestId: chat.requestId,
        agreementVersionId: version.id,
        sequence: visit.sequence,
        scheduledStart: new Date(visit.scheduledStart),
        scheduledEnd: new Date(visit.scheduledEnd),
        startTime: visit.startTime,
        durationMinutes: visit.durationMinutes,
        timezone: visit.timezone,
        tasksSnapshotJson: tasks,
        pricingBreakdownJson: JSON.stringify({
          sourceVisitId: visit.id,
          calculatedHelpPrice: visit.calculatedHelpPrice ?? null,
          agreedHelpAmount: visit.agreedHelpAmount,
          rules: visit.pricingBreakdown ?? [],
          unpricedTasks: visit.unpricedTasks ?? []
        }),
        helpAmount: visit.agreedHelpAmount,
        customerServiceFeeAmount: settings.clientServiceFeeAmount,
        helperServiceFeeAmount: settings.performerCommissionAmount,
        autoCloseAt: zonedLocalToUtc(nextDate(visit.date), "00:00", visit.timezone)
      }
    });
  }
  const createdVisits = await tx.requestVisit.findMany({ where: { agreementVersionId: version.id }, orderBy: { sequence: "asc" } });
  const customerCharge = await chargeAvailableBalanceTx(tx, chat.clientId, chat.requestId, customerTotal, actorUserId, "Сервисный сбор Заказчика за согласованный график", {
    type: "client_service_fee", useBonus: true, chargeBonusFirst: true, idempotencyKeyPrefix: `agreement_fee_batch:${batch.id}:customer`
  });
  const helperCharge = await chargeAvailableBalanceTx(tx, chat.performerId, chat.requestId, helperTotal, actorUserId, "Сервисный сбор Помощника за согласованный график", {
    type: "performer_service_fee", useBonus: true, chargeBonusFirst: true, idempotencyKeyPrefix: `agreement_fee_batch:${batch.id}:helper`
  });
  await createAllocations(tx, batch.id, createdVisits, "customer", chat.clientId, settings.clientServiceFeeAmount, customerCharge);
  await createAllocations(tx, batch.id, createdVisits, "helper", chat.performerId, settings.performerCommissionAmount, helperCharge);
  await tx.agreementVersion.update({ where: { id: version.id }, data: { status: "finalized", finalizedAt: new Date() } });
  return batch;
}

async function createAllocations(tx: Tx, batchId: string, visits: any[], side: string, userId: string, fee: number, charge: { bonusCharge: number; realCharge: number; sourceLedgerEntryIds: string[] }) {
  let bonusRemaining = charge.bonusCharge;
  for (const visit of visits) {
    const bonusBalanceAmount = Math.min(bonusRemaining, fee);
    bonusRemaining -= bonusBalanceAmount;
    await tx.serviceFeeVisitAllocation.create({
      data: {
        batchId,
        visitId: visit.id,
        side,
        userId,
        feeAmount: fee,
        bonusBalanceAmount,
        mainBalanceAmount: fee - bonusBalanceAmount,
        sourceLedgerEntriesJson: JSON.stringify(charge.sourceLedgerEntryIds)
      }
    });
  }
}

function legacySchedule(chat: any): RequestScheduleInput {
  const at = chat.agreedScheduledAt ?? chat.request.date ?? new Date(Date.now() + 86_400_000);
  const date = new Date(at);
  const startTime = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return { frequency: "once", startDate: date.toISOString().slice(0, 10), slots: [{ id: "legacy", startTime, durationMinutes: chat.agreedDurationMinutes ?? Math.round((chat.request.expectedDurationHours ?? 2) * 60) }] };
}

function balanceError(side: string, requiredAmount: number, availableAmount: number) {
  return new HttpError(402, side === "customer" ? "Заказчику нужно пополнить баланс для всего согласованного графика" : "Помощнику нужно пополнить баланс для всего согласованного графика", side === "customer" ? "client_balance_required" : "performer_balance_required", { requiredAmount, availableAmount });
}

function parseObject(value?: string | null): Record<string, any> | null { try { return value ? JSON.parse(value) : null; } catch { return null; } }
function parseArray<T>(value?: string | null): T[] { try { const result = value ? JSON.parse(value) : []; return Array.isArray(result) ? result : []; } catch { return []; } }
function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringValue(value: unknown): string | null { return typeof value === "string" ? value : null; }
function nextDate(value: string) { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); }
