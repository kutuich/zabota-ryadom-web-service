import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { HttpError } from "../utils/http";
import { writeAudit } from "./auditService";
import {
  prepareServiceAttachments,
  removeSavedServiceAttachments,
  savePreparedServiceAttachments,
  type ServiceAttachmentUpload
} from "./serviceMessageStorage";

export const SERVICE_MESSAGE_TYPES = ["service_message", "system_notice", "announcement", "marketing_announcement"] as const;
export const BROADCAST_TYPES = ["service_announcement", "marketing_announcement", "system_notice"] as const;
export const ATTACHMENT_TYPES = ["payment_receipt", "npd_receipt", "refund_statement", "refund_receipt", "bank_confirmation", "legal_document", "request_document", "other"] as const;
export const BROADCAST_RECIPIENT_LIMIT = 5000;

type Actor = { id: string; realRole: string };
type MessageInput = {
  title?: string;
  body: string;
  messageType: typeof SERVICE_MESSAGE_TYPES[number];
  clientRequestId?: string;
  relatedPaymentTransactionId?: string;
  relatedRefundTransactionId?: string;
  relatedRequestId?: string;
  relatedLegalDocumentId?: string;
  files?: ServiceAttachmentUpload[];
};

type BroadcastInput = {
  title: string;
  body: string;
  campaignType: typeof BROADCAST_TYPES[number];
  targetRole: "all" | "customer" | "performer" | "manager";
  targetCityId?: string;
  targetRegionId?: string;
  clientRequestId: string;
};

const messageInclude = {
  attachments: { orderBy: { createdAt: "asc" as const } },
  relatedPayment: { select: { id: true, orderId: true, amount: true, status: true, provider: true, terminalMode: true } },
  relatedRefund: { select: { id: true, amount: true, status: true, paymentTransactionId: true } },
  relatedRequest: { select: { id: true, publicNumber: true, title: true } }
} satisfies Prisma.ServiceMessageInclude;

export async function sendServiceMessage(actor: Actor, targetUserId: string, input: MessageInput) {
  const existing = input.clientRequestId
    ? await prisma.serviceMessage.findUnique({ where: { clientRequestId: input.clientRequestId }, include: messageInclude })
    : null;
  if (existing) return { message: existing, idempotent: true };

  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, role: true, status: true } });
  if (!target) throw new HttpError(404, "Пользователь не найден", "service_message_user_not_found");
  await assertCanMessageTarget(actor, target, input);
  await validateRelatedEntities(target.id, input);
  if (input.messageType === "marketing_announcement" && !(await hasCurrentMarketingConsent(target.id))) {
    throw new HttpError(409, "Пользователь не давал согласие на маркетинговые уведомления", "marketing_consent_required");
  }

  const prepared = prepareServiceAttachments(input.files ?? []);
  const messageId = crypto.randomUUID();
  const saved = await savePreparedServiceAttachments({ userId: target.id, messageId, files: prepared });
  try {
    const message = await prisma.$transaction(async (tx) => {
      const conversation = await tx.serviceConversation.upsert({
        where: { userId: target.id },
        create: { userId: target.id, lastMessageAt: new Date(), unreadForUserCount: 1 },
        update: { lastMessageAt: new Date(), unreadForUserCount: { increment: 1 }, status: "active" }
      });
      const created = await tx.serviceMessage.create({
        data: {
          id: messageId,
          clientRequestId: input.clientRequestId,
          conversationId: conversation.id,
          userId: target.id,
          senderUserId: actor.id,
          senderRole: actor.realRole,
          messageType: input.messageType,
          title: input.title,
          body: input.body,
          relatedPaymentTransactionId: input.relatedPaymentTransactionId,
          relatedRefundTransactionId: input.relatedRefundTransactionId,
          relatedRequestId: input.relatedRequestId,
          relatedLegalDocumentId: input.relatedLegalDocumentId,
          metadataJson: JSON.stringify({ channel: "in_app" }),
          attachments: {
            create: saved.map((file) => ({
              userId: target.id,
              uploadedByUserId: actor.id,
              fileName: file.fileName,
              originalFileName: file.originalFileName,
              mimeType: file.mimeType,
              fileSize: file.fileSize,
              storagePath: file.storagePath,
              attachmentType: file.attachmentType,
              checksum: file.checksum,
              relatedPaymentTransactionId: input.relatedPaymentTransactionId,
              relatedRefundTransactionId: input.relatedRefundTransactionId,
              relatedRequestId: input.relatedRequestId,
              relatedLegalDocumentId: input.relatedLegalDocumentId
            }))
          }
        },
        include: messageInclude
      });
      await writeAudit(actor.id, "admin.service_message.send", "service_message", created.id, {
        targetUserId: target.id,
        messageType: input.messageType,
        attachmentCount: saved.length,
        relatedPaymentTransactionId: input.relatedPaymentTransactionId,
        relatedRefundTransactionId: input.relatedRefundTransactionId,
        relatedRequestId: input.relatedRequestId
      }, tx);
      for (const attachment of created.attachments) {
        await writeAudit(actor.id, "admin.service_message.attachment_upload", "service_message_attachment", attachment.id, {
          targetUserId: target.id,
          attachmentType: attachment.attachmentType,
          fileSize: attachment.fileSize
        }, tx);
      }
      return created;
    });
    return { message, idempotent: false };
  } catch (error) {
    await removeSavedServiceAttachments(saved.map((file) => file.storagePath));
    throw error;
  }
}

export async function listServiceConversations(actor: Actor, search = "") {
  const where = actor.realRole === "manager"
    ? { user: { role: { in: ["client", "performer"] }, status: { notIn: ["archived", "pending_archive", "oauth_pending"] } } }
    : {};
  const rows = await prisma.serviceConversation.findMany({
    where: {
      ...where,
      ...(search ? { user: { ...(where as any).user, OR: [{ displayName: { contains: search } }, { email: { contains: search } }, { phone: { contains: search } }] } } : {})
    },
    include: { user: { select: { id: true, displayName: true, role: true, phone: true, email: true, status: true } }, messages: { take: 1, orderBy: { createdAt: "desc" }, select: { title: true, body: true, createdAt: true, messageType: true } } },
    orderBy: { lastMessageAt: "desc" }
  });
  return rows;
}

export async function searchServiceMessageUsers(actor: Actor, rawQuery: string) {
  if (!["admin", "superadmin", "manager"].includes(actor.realRole)) throw new HttpError(403, "Недостаточно прав", "admin_or_manager_required");
  const query = rawQuery.trim();
  if (query.length < 2) throw new HttpError(400, "Введите минимум 2 символа", "service_user_search_too_short");
  const normalizedQuery = query.toLocaleLowerCase("ru-RU");
  const queryDigits = query.replace(/\D/g, "");
  const phoneNeedle = queryDigits.length >= 10 ? queryDigits.slice(-10) : queryDigits;
  const users = await prisma.user.findMany({
    where: {
      role: actor.realRole === "manager" ? { in: ["client", "performer"] } : { not: "oauth_pending" },
      status: actor.realRole === "manager" ? "active" : { not: "oauth_pending" }
    },
    select: {
      id: true,
      displayName: true,
      role: true,
      phone: true,
      normalizedPhone: true,
      email: true,
      status: true,
      city: { select: { id: true, name: true, region: true } }
    },
    orderBy: { displayName: "asc" },
    take: 5000
  });
  return users.filter((user) => {
    const textMatches = user.displayName.toLocaleLowerCase("ru-RU").includes(normalizedQuery)
      || user.email?.toLocaleLowerCase("ru-RU").includes(normalizedQuery);
    if (textMatches) return true;
    if (!phoneNeedle) return false;
    return [user.phone, user.normalizedPhone].some((value) => value?.replace(/\D/g, "").slice(-10).includes(phoneNeedle));
  }).slice(0, 50).map((user) => ({
    ...user,
    canMessage: !["archived", "pending_archive", "oauth_pending"].includes(user.status)
  }));
}

export async function getServiceConversation(actor: Actor, targetUserId: string) {
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, role: true, status: true, displayName: true, phone: true, normalizedPhone: true, email: true, city: { select: { id: true, name: true, region: true } } } });
  if (!target) throw new HttpError(404, "Пользователь не найден", "service_message_user_not_found");
  if (actor.realRole === "manager" && !["client", "performer"].includes(target.role)) throw new HttpError(403, "Менеджер не может просматривать сообщения служебной роли", "manager_permission_denied");
  const conversation = await prisma.serviceConversation.findUnique({ where: { userId: target.id }, include: { messages: { include: messageInclude, orderBy: { createdAt: "desc" } } } });
  const attachments = await prisma.serviceMessageAttachment.findMany({ where: { userId: target.id }, include: { uploadedBy: { select: { id: true, displayName: true, role: true } }, message: { select: { id: true, title: true, createdAt: true } } }, orderBy: { createdAt: "desc" } });
  return { user: target, conversation, attachments };
}

export async function listMyServiceMessages(userId: string) {
  const conversation = await prisma.serviceConversation.findUnique({ where: { userId } });
  const messages = await prisma.serviceMessage.findMany({ where: { userId }, include: messageInclude, orderBy: { createdAt: "desc" } });
  return { unreadCount: conversation?.unreadForUserCount ?? 0, messages };
}

export async function getMyServiceMessage(userId: string, messageId: string) {
  const message = await prisma.serviceMessage.findFirst({ where: { id: messageId, userId }, include: messageInclude });
  if (!message) throw new HttpError(404, "Сообщение не найдено", "service_message_not_found");
  return message;
}

export async function markServiceMessageRead(userId: string, messageId: string) {
  return prisma.$transaction(async (tx) => {
    const message = await tx.serviceMessage.findFirst({ where: { id: messageId, userId }, include: messageInclude });
    if (!message) throw new HttpError(404, "Сообщение не найдено", "service_message_not_found");
    if (message.isReadByUser) return message;
    const updated = await tx.serviceMessage.update({ where: { id: message.id }, data: { isReadByUser: true, readByUserAt: new Date() }, include: messageInclude });
    if (message.conversationId) {
      const conversation = await tx.serviceConversation.findUnique({ where: { id: message.conversationId } });
      if (conversation) await tx.serviceConversation.update({ where: { id: conversation.id }, data: { unreadForUserCount: Math.max(0, conversation.unreadForUserCount - 1) } });
    }
    await writeAudit(userId, "user.service_message.read", "service_message", message.id, undefined, tx);
    return updated;
  });
}

export async function previewBroadcast(actor: Actor, input: Omit<BroadcastInput, "clientRequestId">) {
  assertAdmin(actor);
  const resolved = await resolveBroadcastRecipients(input);
  await writeAudit(actor.id, "admin.broadcast.preview", "broadcast", null, { campaignType: input.campaignType, targetRole: input.targetRole, ...resolved.summary });
  return resolved.summary;
}

export async function createBroadcast(actor: Actor, input: BroadcastInput) {
  assertAdmin(actor);
  const existing = await prisma.broadcastCampaign.findUnique({ where: { clientRequestId: input.clientRequestId }, include: { recipients: true } });
  if (existing) return { campaign: existing, idempotent: true };
  const resolved = await resolveBroadcastRecipients(input);
  const campaign = await prisma.$transaction(async (tx) => {
    const created = await tx.broadcastCampaign.create({
      data: {
        title: input.title,
        body: input.body,
        campaignType: input.campaignType,
        targetRole: input.targetRole,
        targetCityId: input.targetCityId,
        targetRegionId: input.targetRegionId,
        createdByAdminId: actor.id,
        clientRequestId: input.clientRequestId,
        requireMarketingConsent: input.campaignType === "marketing_announcement",
        recipientsCount: resolved.rows.length,
        skippedCount: resolved.rows.filter((row) => row.status.startsWith("skipped_")).length,
        recipients: { create: resolved.rows.map((row) => ({ userId: row.userId, status: row.status })) }
      },
      include: { recipients: true }
    });
    await writeAudit(actor.id, "admin.broadcast.create", "broadcast", created.id, { ...resolved.summary, campaignType: input.campaignType }, tx);
    return created;
  });
  return { campaign, idempotent: false };
}

export async function sendBroadcast(actor: Actor, campaignId: string, confirmed: boolean) {
  assertAdmin(actor);
  if (!confirmed) throw new HttpError(400, "Подтвердите массовую отправку", "broadcast_confirmation_required");
  const campaign = await prisma.broadcastCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new HttpError(404, "Рассылка не найдена", "broadcast_not_found");
  if (campaign.status === "sent") return { campaign, idempotent: true };
  if (!["draft", "scheduled", "sending", "failed"].includes(campaign.status)) throw new HttpError(409, "Рассылку нельзя отправить", "broadcast_send_forbidden");
  await prisma.broadcastCampaign.update({ where: { id: campaign.id }, data: { status: "sending" } });
  while (true) {
    const batch = await prisma.broadcastRecipient.findMany({ where: { campaignId, status: "pending" }, take: 100, orderBy: { createdAt: "asc" } });
    if (!batch.length) break;
    await prisma.$transaction(async (tx) => {
      for (const recipient of batch) {
        const clientRequestId = `broadcast:${campaign.id}:${recipient.userId}`;
        let message = await tx.serviceMessage.findUnique({ where: { clientRequestId } });
        if (!message) {
          const conversation = await tx.serviceConversation.upsert({
            where: { userId: recipient.userId },
            create: { userId: recipient.userId, lastMessageAt: new Date(), unreadForUserCount: 1 },
            update: { lastMessageAt: new Date(), unreadForUserCount: { increment: 1 }, status: "active" }
          });
          message = await tx.serviceMessage.create({ data: {
            clientRequestId,
            conversationId: conversation.id,
            userId: recipient.userId,
            senderUserId: actor.id,
            senderRole: actor.realRole,
            messageType: campaign.campaignType === "marketing_announcement" ? "marketing_announcement" : campaign.campaignType === "system_notice" ? "system_notice" : "announcement",
            title: campaign.title,
            body: campaign.body,
            broadcastId: campaign.id
          } });
        }
        await tx.broadcastRecipient.update({ where: { id: recipient.id }, data: { status: "delivered", deliveredAt: new Date(), serviceMessageId: message.id } });
      }
    });
  }
  const counts = await prisma.broadcastRecipient.groupBy({ by: ["status"], where: { campaignId }, _count: { _all: true } });
  const count = (status: string) => counts.find((row) => row.status === status)?._count._all ?? 0;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.broadcastCampaign.update({ where: { id: campaignId }, data: { status: "sent", sentAt: new Date(), deliveredCount: count("delivered"), skippedCount: counts.filter((item) => item.status.startsWith("skipped_")).reduce((sum, item) => sum + item._count._all, 0), failedCount: count("failed") } });
    await writeAudit(actor.id, "admin.broadcast.send", "broadcast", row.id, { deliveredCount: row.deliveredCount, skippedCount: row.skippedCount, failedCount: row.failedCount }, tx);
    return row;
  });
  return { campaign: updated, idempotent: false };
}

export async function cancelBroadcast(actor: Actor, campaignId: string) {
  assertAdmin(actor);
  const current = await prisma.broadcastCampaign.findUnique({ where: { id: campaignId } });
  if (!current) throw new HttpError(404, "Рассылка не найдена", "broadcast_not_found");
  if (!["draft", "scheduled"].includes(current.status)) throw new HttpError(409, "Эту рассылку уже нельзя отменить", "broadcast_cancel_forbidden");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.broadcastCampaign.update({ where: { id: campaignId }, data: { status: "cancelled" } });
    await writeAudit(actor.id, "admin.broadcast.cancel", "broadcast", campaignId, undefined, tx);
    return updated;
  });
}

export async function listBroadcasts(actor: Actor) {
  assertAdmin(actor);
  return prisma.broadcastCampaign.findMany({ include: { createdByAdmin: { select: { id: true, displayName: true } } }, orderBy: { createdAt: "desc" } });
}

export async function getBroadcast(actor: Actor, campaignId: string, includeRecipients = false) {
  assertAdmin(actor);
  const campaign = await prisma.broadcastCampaign.findUnique({ where: { id: campaignId }, include: includeRecipients ? { recipients: { include: { user: { select: { id: true, displayName: true, role: true, status: true } } }, orderBy: { createdAt: "asc" } } } : undefined });
  if (!campaign) throw new HttpError(404, "Рассылка не найдена", "broadcast_not_found");
  return campaign;
}

export async function hasCurrentMarketingConsent(userId: string) {
  const document = await prisma.legalDocument.findFirst({ where: { type: "marketing_notifications_consent", isActive: true, isPublished: true }, orderBy: { publishedAt: "desc" } });
  if (!document) return false;
  return Boolean(await prisma.userConsent.findFirst({ where: { userId, documentId: document.id, isActive: true, revokedAt: null } }));
}

export function assertServiceAttachmentDownloadAccess(viewer: { id: string; realRole: string }, owner: { id: string; role: string }) {
  if (viewer.id === owner.id || ["admin", "superadmin"].includes(viewer.realRole)) return;
  if (viewer.realRole === "manager" && ["client", "performer"].includes(owner.role)) return;
  throw new HttpError(403, "Нет доступа к вложению", viewer.realRole === "manager" ? "manager_permission_denied" : "forbidden");
}

async function resolveBroadcastRecipients(input: Omit<BroadcastInput, "clientRequestId">) {
  const roles = input.targetRole === "customer" ? ["client"] : input.targetRole === "performer" ? ["performer"] : input.targetRole === "manager" ? ["manager"] : ["client", "performer"];
  const users = await prisma.user.findMany({
    where: {
      role: { in: roles },
      ...(input.targetCityId ? { cityId: input.targetCityId } : {}),
      ...(input.targetRegionId ? { city: { regionId: input.targetRegionId } } : {})
    },
    select: { id: true, role: true, status: true, cityId: true },
    take: BROADCAST_RECIPIENT_LIMIT + 1
  });
  if (users.length > BROADCAST_RECIPIENT_LIMIT) throw new HttpError(400, "Получателей больше допустимого лимита 5000", "broadcast_recipient_limit_exceeded");
  const currentMarketingDocument = input.campaignType === "marketing_announcement"
    ? await prisma.legalDocument.findFirst({ where: { type: "marketing_notifications_consent", isActive: true, isPublished: true }, orderBy: { publishedAt: "desc" } })
    : null;
  const consentRows = currentMarketingDocument
    ? await prisma.userConsent.findMany({ where: { documentId: currentMarketingDocument.id, userId: { in: users.map((user) => user.id) }, isActive: true, revokedAt: null }, select: { userId: true } })
    : [];
  const consentIds = new Set(consentRows.map((row) => row.userId));
  const rows = users.map((user) => ({
    userId: user.id,
    role: user.role,
    cityId: user.cityId,
    status: ["archived", "pending_archive", "oauth_pending"].includes(user.status)
      ? "skipped_inactive"
      : input.campaignType === "marketing_announcement" && !consentIds.has(user.id)
        ? "skipped_no_consent"
        : "pending"
  }));
  return {
    rows,
    summary: {
      totalFound: rows.length,
      willReceive: rows.filter((row) => row.status === "pending").length,
      skippedNoConsent: rows.filter((row) => row.status === "skipped_no_consent").length,
      skippedInactive: rows.filter((row) => row.status === "skipped_inactive").length,
      roles: Object.fromEntries(roles.map((role) => [role, rows.filter((row) => row.role === role).length])),
      cities: Object.fromEntries(Array.from(new Set(rows.map((row) => row.cityId).filter(Boolean))).map((cityId) => [cityId!, rows.filter((row) => row.cityId === cityId).length]))
    }
  };
}

async function assertCanMessageTarget(actor: Actor, target: { role: string; status: string }, input: MessageInput) {
  if (!["admin", "superadmin", "manager"].includes(actor.realRole)) throw new HttpError(403, "Недостаточно прав", "admin_or_manager_required");
  if (actor.realRole === "manager" && (!(["client", "performer"].includes(target.role)) || target.status !== "active")) {
    throw new HttpError(403, "Менеджер не может писать этому пользователю", "manager_permission_denied");
  }
  if (["archived", "pending_archive", "oauth_pending"].includes(target.status)) {
    const hasOperationalContext = Boolean(input.relatedPaymentTransactionId || input.relatedRefundTransactionId || input.relatedLegalDocumentId);
    if (!(["admin", "superadmin"].includes(actor.realRole) && hasOperationalContext && ["service_message", "system_notice"].includes(input.messageType))) {
      throw new HttpError(409, "Нельзя отправить сообщение пользователю с неактивным профилем", "service_message_user_inactive");
    }
  }
  if (target.status === "blocked" && input.messageType === "marketing_announcement") throw new HttpError(409, "Заблокированному пользователю нельзя отправить маркетинговое сообщение", "service_message_blocked_marketing_forbidden");
}

async function validateRelatedEntities(userId: string, input: MessageInput) {
  if (input.relatedPaymentTransactionId) {
    const payment = await prisma.paymentTransaction.findUnique({ where: { id: input.relatedPaymentTransactionId } });
    if (!payment || payment.userId !== userId) throw new HttpError(400, "Платёж не относится к выбранному пользователю", "service_message_payment_mismatch");
  }
  if (input.relatedRefundTransactionId) {
    const refund = await prisma.refundTransaction.findUnique({ where: { id: input.relatedRefundTransactionId } });
    if (!refund || refund.userId !== userId) throw new HttpError(400, "Возврат не относится к выбранному пользователю", "service_message_refund_mismatch");
  }
  if (input.relatedRequestId) {
    const request = await prisma.clientRequest.findUnique({ where: { id: input.relatedRequestId } });
    if (!request || request.clientId !== userId) throw new HttpError(400, "Заявка не относится к выбранному пользователю", "service_message_request_mismatch");
  }
  if (input.relatedLegalDocumentId && !(await prisma.legalDocument.findUnique({ where: { id: input.relatedLegalDocumentId } }))) {
    throw new HttpError(400, "Юридический документ не найден", "service_message_legal_document_invalid");
  }
}

function assertAdmin(actor: Actor) {
  if (!["admin", "superadmin"].includes(actor.realRole)) throw new HttpError(403, "Менеджер не может управлять рассылками", actor.realRole === "manager" ? "manager_permission_denied" : "admin_required");
}
