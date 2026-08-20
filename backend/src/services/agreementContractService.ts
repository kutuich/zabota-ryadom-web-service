import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { uploadsRoot, resolveStoragePath } from "./uploadStorage";

type Tx = Prisma.TransactionClient;

export const AGREEMENT_CONTRACT_TEMPLATE_VERSION = "1.0";

export async function createAgreementContractTx(tx: Tx, input: {
  chat: any;
  agreementVersion: any;
  createdByUserId: string;
}) {
  const existing = await tx.agreementContract.findUnique({ where: { agreementVersionId: input.agreementVersion.id } });
  if (existing) return existing;

  const [customer, helper] = await Promise.all([
    tx.user.findUniqueOrThrow({ where: { id: input.chat.clientId }, select: { displayName: true } }),
    tx.user.findUniqueOrThrow({ where: { id: input.chat.performerId }, select: { displayName: true } })
  ]);
  const id = randomUUID();
  const contentText = buildAgreementContractText(input.chat, input.agreementVersion, customer.displayName, helper.displayName);
  const bytes = Buffer.from(contentText, "utf8");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const fileName = `agreement-project-${input.chat.request.publicNumber ?? input.chat.requestId}-v${input.agreementVersion.version}.txt`;
  const storagePath = path.join("agreement-contracts", input.chat.requestId, input.agreementVersion.id, `${id}.txt`);
  const absolutePath = resolveStoragePath(uploadsRoot, storagePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, bytes, { flag: "wx" });

  return tx.agreementContract.create({
    data: {
      id,
      requestId: input.chat.requestId,
      chatId: input.chat.id,
      agreementVersionId: input.agreementVersion.id,
      templateVersion: AGREEMENT_CONTRACT_TEMPLATE_VERSION,
      documentVersion: input.agreementVersion.version,
      title: "Проект договора между Заказчиком и Помощником",
      contentText,
      checksum,
      fileName,
      storagePath,
      fileSize: bytes.length,
      createdByUserId: input.createdByUserId
    }
  });
}

export function resolveAgreementContractPath(storagePath: string) {
  return resolveStoragePath(uploadsRoot, storagePath);
}

function buildAgreementContractText(chat: any, version: any, customerName: string, helperName: string) {
  const tasks = parseArray(version.selectedTasksJson).map((task: any) =>
    task.taskTemplateTitle ?? task.subcategoryTitle ?? task.categoryTitle ?? task.title ?? task.slug
  ).filter(Boolean);
  const visits = parseArray(version.expandedVisitsJson);
  const visitLines = visits.map((visit: any) =>
    `${visit.sequence}. ${visit.date}, ${visit.startTime}-${visit.endTime}, ${visit.durationMinutes} мин., стоимость помощи ${visit.agreedHelpAmount} руб.`
  );
  return [
    "ПРОЕКТ ДОГОВОРА ОКАЗАНИЯ БЫТОВОЙ ПОМОЩИ",
    `Версия шаблона: ${AGREEMENT_CONTRACT_TEMPLATE_VERSION}`,
    `Заявка: ${chat.request.publicNumber ?? chat.requestId}`,
    `Версия согласованных условий: ${version.version}`,
    `Checksum условий: ${version.termsHash}`,
    "",
    `Заказчик: ${customerName}`,
    `Помощник: ${helperName}`,
    "",
    "1. Согласованные задачи",
    ...(tasks.length ? tasks.map((task: string, index: number) => `${index + 1}. ${task}`) : ["Задачи указаны в согласованных условиях заявки."]),
    "",
    "2. Согласованный график и стоимость помощи",
    ...visitLines,
    `Общая стоимость помощи: ${version.totalHelpAmount ?? 0} руб.`,
    "Оплата работы Помощника производится Заказчиком напрямую по согласованным условиям.",
    "",
    "3. Сервисные сборы",
    `Сервисный сбор Заказчика: ${version.customerServiceFeeTotal} руб.`,
    `Сервисный сбор Помощника: ${version.helperServiceFeeTotal} руб.`,
    "Сервисные сборы относятся к использованию сервиса и не являются оплатой работы Помощника.",
    "",
    "4. Дополнительные условия",
    version.termsComment?.trim() || "Дополнительные условия не указаны.",
    "",
    "Сервис «Забота Рядом» предоставляет информационную площадку и не является стороной договора между Заказчиком и Помощником.",
    "Этот неизменяемый экземпляр сформирован из структурированных согласованных условий. Изменение условий создаёт новую версию и новый экземпляр проекта договора."
  ].join("\n");
}

function parseArray(value?: string | null): any[] {
  try { const parsed = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
