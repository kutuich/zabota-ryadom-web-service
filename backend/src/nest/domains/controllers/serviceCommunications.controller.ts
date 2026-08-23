import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { ApiProduces, ApiResponse } from "@nestjs/swagger";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../../db/prisma";
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
  searchServiceMessageUsers,
  sendBroadcast,
  sendServiceMessage
} from "../../../services/serviceCommunicationService";
import { ObjectStorageNotFoundError } from "../../../storage/objectStorage";
import { objectStorage } from "../../../storage/storageProvider";
import { writeAudit } from "../../../services/auditService";
import { HttpError } from "../../../utils/http";

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

function actor(req: Request) {
  return { id: req.user!.id, realRole: req.user!.realRole };
}
@Controller("api/admin/service-conversations")
export class AdminServiceConversationsController {
  @Get("/")
  @UseGuards(NestJwtAuthGuard, NestAdminManagerGuard)
  async getroot0(@Req() req: Request, @Res() res: Response) {
  const search = typeof req.query.search === "string" ? req.query.search.slice(0, 120) : "";
  res.json(await listServiceConversations(actor(req), search));
}

  @Get("/users/search")
  @UseGuards(NestJwtAuthGuard, NestAdminManagerGuard)
  async getusersSearch1(@Req() req: Request, @Res() res: Response) {
  const { q } = z.object({ q: z.string().trim().min(2).max(120) }).parse(req.query);
  res.json(await searchServiceMessageUsers(actor(req), q));
}

  @Get("/:userId")
  @UseGuards(NestJwtAuthGuard, NestAdminManagerGuard)
  async getuserId2(@Req() req: Request, @Res() res: Response) {
  res.json(await getServiceConversation(actor(req), req.params.userId));
}

  @Post("/:userId/messages")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminManagerGuard)
  async postuserIdMessages3(@Req() req: Request, @Res() res: Response) {
  const input = messageSchema.parse(req.body);
  res.status(201).json(await sendServiceMessage(actor(req), req.params.userId, input));
}
}

@Controller("api/admin/broadcasts")
export class AdminBroadcastsController {
  @Get("/")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getroot0(@Req() req: Request, @Res() res: Response) {
    return res.json(await listBroadcasts(actor(req)));
  }

  @Post("/preview")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postpreview1(@Req() req: Request, @Res() res: Response) {
  const input = broadcastSchema.parse(req.body);
  res.json(await previewBroadcast(actor(req), input));
}

  @Post("/")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postroot2(@Req() req: Request, @Res() res: Response) {
  const input = broadcastSchema.extend({ clientRequestId: z.string().min(8).max(160) }).parse(req.body);
  res.status(201).json(await createBroadcast(actor(req), input));
}

  @Post("/:id/send")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postidSend3(@Req() req: Request, @Res() res: Response) {
  const { confirmed } = z.object({ confirmed: z.literal(true) }).parse(req.body);
  res.json(await sendBroadcast(actor(req), req.params.id, confirmed));
}

  @Post("/:id/cancel")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postidCancel4(@Req() req: Request, @Res() res: Response) {
    return res.json(await cancelBroadcast(actor(req), req.params.id));
  }

  @Get("/:id/recipients")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getidRecipients5(@Req() req: Request, @Res() res: Response) {
    return res.json(await getBroadcast(actor(req), req.params.id, true));
  }

  @Get("/:id")
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async getid6(@Req() req: Request, @Res() res: Response) {
    return res.json(await getBroadcast(actor(req), req.params.id));
  }
}

@Controller("api/me/service-messages")
export class MeServiceMessagesController {
  @Get("/")
  @UseGuards(NestJwtAuthGuard)
  async getroot0(@Req() req: Request, @Res() res: Response) {
    return res.json(await listMyServiceMessages(req.user!.id));
  }

  @Get("/:id")
  @UseGuards(NestJwtAuthGuard)
  async getid1(@Req() req: Request, @Res() res: Response) {
    return res.json(await getMyServiceMessage(req.user!.id, req.params.id));
  }

  @Post("/:id/read")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard)
  async postidRead2(@Req() req: Request, @Res() res: Response) {
    return res.json(await markServiceMessageRead(req.user!.id, req.params.id));
  }
}

@Controller("api/service-message-attachments")
export class ServiceMessageAttachmentsController {
  @Get("/:id/download")
  @ApiProduces("application/octet-stream")
  @ApiResponse({ status: 200, description: "Protected service-message attachment", schema: { type: "string", format: "binary" } })
  @UseGuards(NestJwtAuthGuard)
  async getidDownload0(@Req() req: Request, @Res() res: Response) {
  const attachment = await prisma.serviceMessageAttachment.findUnique({ where: { id: req.params.id }, include: { user: { select: { role: true } } } });
  if (!attachment) throw new HttpError(404, "Вложение не найдено", "service_attachment_not_found");
  const ownsAttachment = attachment.userId === req.user!.id;
  assertServiceAttachmentDownloadAccess({ id: req.user!.id, realRole: req.user!.realRole }, { id: attachment.userId, role: attachment.user.role });
  let bytes: Buffer;
  try { bytes = (await objectStorage.get(attachment.storagePath)).body; } catch (error) {
    if (error instanceof ObjectStorageNotFoundError) throw new HttpError(404, "Файл вложения не найден", "service_attachment_file_missing");
    throw error;
  }
  await writeAudit(req.user!.id, ownsAttachment ? "user.service_message.attachment_download" : "admin.service_message.attachment_download", "service_message_attachment", attachment.id, { ownerUserId: attachment.userId });
  res.attachment(attachment.originalFileName);
  res.type(attachment.mimeType);
  res.send(bytes);
}
}

@Controller("api/admin/payments")
export class PaymentServiceMessagesController {
  @Post("/:id/message-user")
  @HttpCode(200)
  @UseGuards(NestJwtAuthGuard, NestAdminGuard)
  async postidMessageUser0(@Req() req: Request, @Res() res: Response) {
  const payment = await prisma.paymentTransaction.findUnique({ where: { id: req.params.id } });
  if (!payment) throw new HttpError(404, "Платёж не найден", "payment_not_found");
  const input = messageSchema.parse({ ...req.body, relatedPaymentTransactionId: payment.id });
  res.status(201).json(await sendServiceMessage(actor(req), payment.userId, input));
}
}
