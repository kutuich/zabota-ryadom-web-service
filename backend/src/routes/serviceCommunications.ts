import fs from "node:fs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { authenticate, requireAdmin, requireAdminManagerOrSuperadmin } from "../middleware/auth";
import {
  ATTACHMENT_TYPES,
  BROADCAST_TYPES,
  SERVICE_MESSAGE_TYPES,
  cancelBroadcast,
  assertServiceAttachmentDownloadAccess,
  createBroadcast,
  getBroadcast,
  getMyServiceMessage,
  getServiceConversation,
  listBroadcasts,
  listMyServiceMessages,
  listServiceConversations,
  markServiceMessageRead,
  previewBroadcast,
  sendBroadcast,
  sendServiceMessage
} from "../services/serviceCommunicationService";
import { resolveServiceAttachmentPath } from "../services/serviceMessageStorage";
import { writeAudit } from "../services/auditService";
import { asyncHandler, HttpError } from "../utils/http";

export const adminServiceConversationsRouter = Router();
export const adminBroadcastsRouter = Router();
export const meServiceMessagesRouter = Router();
export const serviceMessageAttachmentsRouter = Router();
export const paymentServiceMessagesRouter = Router();

const fileSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(160),
  fileData: z.string().min(1),
  attachmentType: z.enum(ATTACHMENT_TYPES).optional()
});

const messageSchema = z.object({
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(1).max(5000),
  messageType: z.enum(SERVICE_MESSAGE_TYPES).default("service_message"),
  clientRequestId: z.string().min(8).max(160).optional(),
  relatedPaymentTransactionId: z.string().optional(),
  relatedRefundTransactionId: z.string().optional(),
  relatedRequestId: z.string().optional(),
  relatedLegalDocumentId: z.string().optional(),
  files: z.array(fileSchema).max(5).optional()
});

const broadcastSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
  campaignType: z.enum(BROADCAST_TYPES),
  targetRole: z.enum(["all", "customer", "performer", "manager"]).default("all"),
  targetCityId: z.string().optional(),
  targetRegionId: z.string().optional()
});

adminServiceConversationsRouter.use(authenticate, requireAdminManagerOrSuperadmin);
adminServiceConversationsRouter.get("/", asyncHandler(async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.slice(0, 120) : "";
  res.json(await listServiceConversations(actor(req), search));
}));
adminServiceConversationsRouter.get("/:userId", asyncHandler(async (req, res) => {
  res.json(await getServiceConversation(actor(req), req.params.userId));
}));
adminServiceConversationsRouter.post("/:userId/messages", asyncHandler(async (req, res) => {
  const input = messageSchema.parse(req.body);
  res.status(201).json(await sendServiceMessage(actor(req), req.params.userId, input));
}));

adminBroadcastsRouter.use(authenticate, requireAdmin);
adminBroadcastsRouter.get("/", asyncHandler(async (req, res) => res.json(await listBroadcasts(actor(req)))));
adminBroadcastsRouter.post("/preview", asyncHandler(async (req, res) => {
  const input = broadcastSchema.parse(req.body);
  res.json(await previewBroadcast(actor(req), input));
}));
adminBroadcastsRouter.post("/", asyncHandler(async (req, res) => {
  const input = broadcastSchema.extend({ clientRequestId: z.string().min(8).max(160) }).parse(req.body);
  res.status(201).json(await createBroadcast(actor(req), input));
}));
adminBroadcastsRouter.post("/:id/send", asyncHandler(async (req, res) => {
  const { confirmed } = z.object({ confirmed: z.literal(true) }).parse(req.body);
  res.json(await sendBroadcast(actor(req), req.params.id, confirmed));
}));
adminBroadcastsRouter.post("/:id/cancel", asyncHandler(async (req, res) => res.json(await cancelBroadcast(actor(req), req.params.id))));
adminBroadcastsRouter.get("/:id/recipients", asyncHandler(async (req, res) => res.json(await getBroadcast(actor(req), req.params.id, true))));
adminBroadcastsRouter.get("/:id", asyncHandler(async (req, res) => res.json(await getBroadcast(actor(req), req.params.id))));

meServiceMessagesRouter.use(authenticate);
meServiceMessagesRouter.get("/", asyncHandler(async (req, res) => res.json(await listMyServiceMessages(req.user!.id))));
meServiceMessagesRouter.get("/:id", asyncHandler(async (req, res) => res.json(await getMyServiceMessage(req.user!.id, req.params.id))));
meServiceMessagesRouter.post("/:id/read", asyncHandler(async (req, res) => res.json(await markServiceMessageRead(req.user!.id, req.params.id))));

serviceMessageAttachmentsRouter.use(authenticate);
serviceMessageAttachmentsRouter.get("/:id/download", asyncHandler(async (req, res) => {
  const attachment = await prisma.serviceMessageAttachment.findUnique({ where: { id: req.params.id }, include: { user: { select: { role: true } } } });
  if (!attachment) throw new HttpError(404, "Вложение не найдено", "service_attachment_not_found");
  const ownsAttachment = attachment.userId === req.user!.id;
  assertServiceAttachmentDownloadAccess({ id: req.user!.id, realRole: req.user!.realRole }, { id: attachment.userId, role: attachment.user.role });
  const filePath = resolveServiceAttachmentPath(attachment.storagePath);
  if (!fs.existsSync(filePath)) throw new HttpError(404, "Файл вложения не найден", "service_attachment_file_missing");
  await writeAudit(req.user!.id, ownsAttachment ? "user.service_message.attachment_download" : "admin.service_message.attachment_download", "service_message_attachment", attachment.id, { ownerUserId: attachment.userId });
  res.download(filePath, attachment.originalFileName);
}));

paymentServiceMessagesRouter.use(authenticate, requireAdmin);
paymentServiceMessagesRouter.post("/:id/message-user", asyncHandler(async (req, res) => {
  const payment = await prisma.paymentTransaction.findUnique({ where: { id: req.params.id } });
  if (!payment) throw new HttpError(404, "Платёж не найден", "payment_not_found");
  const input = messageSchema.parse({ ...req.body, relatedPaymentTransactionId: payment.id });
  res.status(201).json(await sendServiceMessage(actor(req), payment.userId, input));
}));

function actor(req: Parameters<typeof authenticate>[0]) {
  return { id: req.user!.id, realRole: req.user!.realRole };
}
