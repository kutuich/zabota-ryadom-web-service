import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { getServiceFeeSettings, hasAvailableBalance } from "../services/balanceService";
import { writeAudit } from "../services/auditService";
import { requireFeatureConsent } from "../services/legalService";
import { moderateChatMessage } from "../services/moderationService";
import { serializeRequestForUser } from "../services/requestPolicy";
import { canShowExactAddressToHelper } from "../services/addressService";
import { serializeAgreedTerms } from "../services/agreementTermsService";
import { PRICING_ADDONS, PRICING_PACKAGES } from "../services/pricingService";
import { asyncHandler, HttpError } from "../utils/http";
import { confirmAgreementVersionTx, createAgreementVersionTx, finalizeAgreementBatchTx } from "../services/agreementWorkflowService";
import { serializeAgreementContract } from "./agreementContracts";

export const chatsRouter = Router();

chatsRouter.use(authenticate);

const chatInclude = {
  request: { include: { category: true, city: true } },
  client: { select: { id: true, displayName: true } },
  performer: {
    select: {
      id: true,
      displayName: true,
      performerProfile: true
    }
  },
  messages: {
    include: { sender: { select: { id: true, displayName: true, role: true } } },
    orderBy: { createdAt: "asc" as const }
  },
  agreementVersions: { include: { contract: true }, orderBy: { version: "desc" as const }, take: 1 }
};

const agreementTermsSchema = z.object({
  agreedHelperAmount: z.number().int().min(1).max(100_000),
  agreedVisits: z.array(z.object({
    visitId: z.string().min(1).max(160),
    amount: z.number().int().min(1).max(100_000)
  })).max(5000).optional(),
  agreedPackageId: z.string().min(1).max(80).nullable().optional(),
  agreedAddons: z.array(z.string().min(1).max(80)).max(20).optional(),
  agreedDurationMinutes: z.number().int().min(15).max(24 * 60).nullable().optional(),
  agreedScheduledAt: z.string().max(40).refine((value) => !Number.isNaN(Date.parse(value)), "Некорректная дата и время").nullable().optional(),
  agreedTermsComment: z.string().max(1000).nullable().optional(),
  selectedTasks: z.array(z.object({
    categoryId: z.string().min(1),
    subcategoryId: z.string().min(1).nullable().optional(),
    taskTemplateId: z.string().min(1).nullable().optional()
  })).max(100).optional(),
  schedule: z.object({
    frequency: z.enum(["urgent_today", "once", "daily", "weekly", "several_weekly", "regular_schedule"]),
    startDate: z.string(),
    endDate: z.string().nullable().optional(),
    weeksCount: z.number().int().positive().nullable().optional(),
    visitCount: z.number().int().positive().nullable().optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    slots: z.array(z.object({ id: z.string(), startTime: z.string(), durationMinutes: z.number().int().positive() })).optional(),
    daySchedules: z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), slots: z.array(z.object({ id: z.string(), startTime: z.string(), durationMinutes: z.number().int().positive() })) })).optional()
  }).optional()
});

chatsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const where = ["admin", "superadmin"].includes(req.user!.role)
      ? {}
      : { OR: [{ clientId: req.user!.id }, { performerId: req.user!.id }] };

    const chats = await prisma.chat.findMany({
      where,
      include: chatInclude,
      orderBy: { createdAt: "desc" }
    });

    res.json(chats.map((chat) => serializeChat(chat, req.user!)));
  })
);

chatsRouter.get(
  "/:id/messages",
  asyncHandler(async (req, res) => {
    const chat = await loadChatForViewer(req.params.id, req.user!);
    res.json(serializeChat(chat, req.user!));
  })
);

chatsRouter.post(
  "/:id/messages",
  requireFeatureConsent("send_chat_message"),
  asyncHandler(async (req, res) => {
    const input = z.object({ text: z.string().min(1).max(2000) }).parse(req.body);
    const chat = await loadChatForViewer(req.params.id, req.user!);
    if (!["open", "waiting_client_confirmation", "waiting_performer_confirmation", "in_work", "dispute"].includes(chat.status)) {
      throw new HttpError(400, "Чат закрыт", "chat_closed");
    }

    const moderation = moderateChatMessage(input.text);
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          chatId: chat.id,
          senderId: req.user!.id,
          text: input.text,
          moderationStatus: moderation.status,
          isHidden: moderation.isHidden
        },
        include: { sender: { select: { id: true, displayName: true, role: true } } }
      });

      if (moderation.flags.length > 0) {
        await tx.userRiskFlag.create({
          data: {
            userId: req.user!.id,
            type: `chat_${moderation.flags.join("_")}`,
            severity: moderation.isHidden ? "high" : "medium",
            reason: `Сообщение в чате помечено модерацией: ${moderation.flags.join(", ")}`
          }
        });
      }

      await writeAudit(req.user!.id, "chat.message_create", "chat", chat.id, {
        moderation
      }, tx);

      return created;
    });

    res.status(201).json({
      message,
      moderation
    });
  })
);

chatsRouter.delete(
  "/:chatId/messages/:messageId",
  asyncHandler(async (req, res) => {
    if (!["admin", "superadmin"].includes(req.user!.role)) {
      throw new HttpError(403, "Удалять сообщения может только администратор", "forbidden");
    }

    const chat = await loadChatForViewer(req.params.chatId, req.user!);
    const message = chat.messages.find((item: any) => item.id === req.params.messageId);
    if (!message) {
      throw new HttpError(404, "Сообщение не найдено", "message_not_found");
    }

    await prisma.$transaction(async (tx) => {
      await tx.chatMessage.update({
        where: { id: message.id },
        data: {
          text: "Сообщение удалено администратором",
          visibility: "deleted",
          isHidden: true,
          moderationStatus: "deleted"
        }
      });
      await writeAudit(req.user!.id, "chat.message_delete", "chatMessage", message.id, {
        chatId: chat.id,
        requestId: chat.requestId,
        publicNumber: chat.request?.publicNumber,
        deletedByAdminId: req.user!.id,
        deletedReason: null,
        wasFlagged: message.moderationStatus !== "clean" || message.isHidden,
        previousModerationStatus: message.moderationStatus,
        previousVisibility: message.visibility,
        originalText: message.text
      }, tx);
    });

    const updated = await loadChatForViewer(chat.id, req.user!);
    res.json(serializeChat(updated, req.user!));
  })
);

chatsRouter.patch(
  "/:id/terms",
  asyncHandler(async (req, res) => {
    const input = agreementTermsSchema.parse(req.body);
    const chat = await loadChatForViewer(req.params.id, req.user!);
    if (chat.clientId !== req.user!.id && chat.performerId !== req.user!.id) {
      throw new HttpError(403, "Изменять условия могут только участники чата", "forbidden");
    }
    if (
      chat.agreementFinalizedAt ||
      chat.status === "in_work" ||
      chat.archivedAt ||
      ["completed", "cancelled", "archived"].includes(chat.status) ||
      ["in_progress", "completed", "cancelled", "archived"].includes(chat.request.status)
    ) {
      throw new HttpError(400, "Согласованный график уже подтверждён и защищён от изменения. Для изменения условий потребуется создать новую версию графика. Эта возможность будет добавлена отдельным этапом.", "agreement_terms_locked");
    }

    const requestPricing = safeJsonObject(chat.request.pricingBreakdownJson);
    const packageId = input.agreedPackageId === undefined
      ? chat.agreedPackageId ?? stringOrNull(requestPricing?.packageId)
      : input.agreedPackageId;
    if (packageId && !Object.prototype.hasOwnProperty.call(PRICING_PACKAGES, packageId)) {
      throw new HttpError(400, "Неизвестный пакет помощи", "agreement_package_invalid");
    }
    const currentAddons = parseStringArray(chat.agreedAddonsJson);
    const agreedAddons = input.agreedAddons ?? currentAddons;
    if (agreedAddons.some((id) => !Object.prototype.hasOwnProperty.call(PRICING_ADDONS, id))) {
      throw new HttpError(400, "Неизвестная доплата в согласованных условиях", "agreement_addon_invalid");
    }

    const settings = await getServiceFeeSettings();
    const termsUpdatedAt = new Date();
    const result = await prisma.$transaction(async (tx) => {
      await tx.chat.update({
        where: { id: chat.id },
        data: {
          agreedHelperAmount: input.agreedHelperAmount,
          customerServiceFeeAmount: settings.clientServiceFeeAmount,
          helperServiceFeeAmount: settings.performerCommissionAmount,
          customerTotalAmount: input.agreedHelperAmount + settings.clientServiceFeeAmount,
          helperNetAmount: Math.max(0, input.agreedHelperAmount - settings.performerCommissionAmount),
          agreedPackageId: packageId,
          agreedPackageTitle: packageId ? PRICING_PACKAGES[packageId as keyof typeof PRICING_PACKAGES].title : null,
          agreedAddonsJson: JSON.stringify(agreedAddons),
          agreedDurationMinutes: input.agreedDurationMinutes === undefined
            ? chat.agreedDurationMinutes ?? durationMinutes(chat.request.expectedDurationHours)
            : input.agreedDurationMinutes,
          agreedScheduledAt: input.agreedScheduledAt === undefined
            ? chat.agreedScheduledAt
            : input.agreedScheduledAt ? new Date(input.agreedScheduledAt) : null,
          agreedTermsComment: input.agreedTermsComment === undefined ? chat.agreedTermsComment : input.agreedTermsComment?.trim() || null,
          clientConfirmedAt: null,
          performerConfirmedAt: null,
          agreedByCustomerAt: null,
          agreedByHelperAt: null,
          status: "open",
          termsUpdatedAt,
          termsUpdatedByUserId: req.user!.id
        }
      });
      await tx.clientRequest.update({
        where: { id: chat.requestId },
        data: { status: "discussion" }
      });
      await tx.chatMessage.create({
        data: {
          chatId: chat.id,
          senderId: null,
          text: `Условия заявки обновлены. Сумма помощи: ${input.agreedHelperAmount} ₽. Для перехода заявки в работу нужно подтверждение Заказчика и Помощника.`,
          isSystem: true
        }
      });
      const agreementVersion = await createAgreementVersionTx(tx, { ...chat, request: chat.request }, req.user!.id, {
        agreedHelperAmount: input.agreedHelperAmount,
        agreedVisits: input.agreedVisits,
        termsComment: input.agreedTermsComment === undefined ? chat.agreedTermsComment : input.agreedTermsComment,
        schedule: input.schedule,
        selectedTasks: input.selectedTasks
      });
      await tx.chat.update({
        where: { id: chat.id },
        data: {
          customerTotalAmount: agreementVersion.totalHelpAmount == null ? null : agreementVersion.totalHelpAmount + agreementVersion.customerServiceFeeTotal,
          helperNetAmount: agreementVersion.totalHelpAmount == null ? null : Math.max(0, agreementVersion.totalHelpAmount - agreementVersion.helperServiceFeeTotal)
        }
      });
      await writeAudit(req.user!.id, "chat.agreement_terms_update", "chat", chat.id, {
        requestId: chat.requestId,
        agreedHelperAmount: input.agreedHelperAmount,
        packageId,
        agreedAddons,
        termsUpdatedAt
      }, tx);
      return tx.chat.findUnique({ where: { id: chat.id }, include: chatInclude });
    });

    res.json(serializeChat(result, req.user!));
  })
);

chatsRouter.post(
  "/:id/client-confirm",
  requireFeatureConsent("confirm_helper"),
  asyncHandler(async (req, res) => {
    const chat = await loadChatForViewer(req.params.id, req.user!);
    if (chat.clientId !== req.user!.id) {
      throw new HttpError(403, "Подтверждать условия может только заказчик заявки", "forbidden");
    }
    if (chat.agreementFinalizedAt || chat.status === "in_work") {
      return res.json(serializeChat(chat, req.user!));
    }
    if (!chat.agreedHelperAmount) {
      throw new HttpError(400, "Сначала согласуйте и сохраните стоимость помощи", "agreement_terms_required");
    }
    if (["not_agreed", "archived", "completed"].includes(chat.status)) {
      throw new HttpError(400, "Этот чат уже не активен", "chat_not_active");
    }

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.chat.findUnique({ where: { id: chat.id }, include: chatInclude });
      if (!current) throw new HttpError(404, "Чат не найден", "chat_not_found");
      if (current.agreementFinalizedAt || current.status === "in_work") {
        return serializeChat(current, req.user!);
      }
      if (!current.agreedHelperAmount) {
        throw new HttpError(400, "Сначала согласуйте и сохраните стоимость помощи", "agreement_terms_required");
      }
      const confirmedAt = new Date();
      await confirmAgreementVersionTx(tx, chat.id, "customer", confirmedAt);
      await tx.chat.update({
        where: { id: chat.id },
        data: {
          clientConfirmedAt: confirmedAt,
          agreedByCustomerAt: confirmedAt,
          status: "waiting_performer_confirmation"
        }
      });
      await tx.clientRequest.update({
        where: { id: chat.requestId },
        data: { status: "waiting_performer_confirmation" }
      });
      await tx.chatMessage.create({
        data: {
          chatId: chat.id,
          senderId: null,
          text: "Заказчик подтвердил помощника и условия. Теперь помощник должен принять заявку в работу.",
          isSystem: true
        }
      });
      await writeAudit(req.user!.id, "chat.client_confirm_conditions", "chat", chat.id, { requestId: chat.requestId }, tx);
      return finalizeAgreementIfReady(tx, chat.id, req.user!);
    });

    res.json(result);
  })
);

chatsRouter.post(
  "/:id/performer-confirm",
  requireFeatureConsent("accept_work"),
  asyncHandler(async (req, res) => {
    const chat = await loadChatForViewer(req.params.id, req.user!);
    if (chat.performerId !== req.user!.id) {
      throw new HttpError(403, "Принимать заявку может только выбранный помощник", "forbidden");
    }
    if (chat.agreementFinalizedAt || chat.status === "in_work") {
      return res.json(serializeChat(chat, req.user!));
    }
    if (!chat.agreedHelperAmount) {
      throw new HttpError(400, "Сначала согласуйте и сохраните стоимость помощи", "agreement_terms_required");
    }
    if (["not_agreed", "archived", "completed"].includes(chat.status)) {
      throw new HttpError(400, "Этот чат уже не активен", "chat_not_active");
    }

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.chat.findUnique({ where: { id: chat.id }, include: chatInclude });
      if (!current) throw new HttpError(404, "Чат не найден", "chat_not_found");
      if (current.agreementFinalizedAt || current.status === "in_work") {
        return serializeChat(current, req.user!);
      }
      if (!current.agreedHelperAmount) {
        throw new HttpError(400, "Сначала согласуйте и сохраните стоимость помощи", "agreement_terms_required");
      }
      const confirmedAt = new Date();
      await confirmAgreementVersionTx(tx, chat.id, "helper", confirmedAt);
      await tx.chat.update({
        where: { id: chat.id },
        data: {
          performerConfirmedAt: confirmedAt,
          agreedByHelperAt: confirmedAt,
          status: current.clientConfirmedAt ? "waiting_performer_confirmation" : "waiting_client_confirmation"
        }
      });
      await tx.clientRequest.update({
        where: { id: chat.requestId },
        data: { status: current.clientConfirmedAt ? "waiting_performer_confirmation" : "waiting_client_confirmation" }
      });
      await tx.chatMessage.create({
        data: {
          chatId: chat.id,
          senderId: null,
          text: "Помощник подтвердил готовность принять заявку в работу.",
          isSystem: true
        }
      });
      await writeAudit(req.user!.id, "chat.performer_confirm_work", "chat", chat.id, { requestId: chat.requestId }, tx);
      return finalizeAgreementIfReady(tx, chat.id, req.user!);
    });

    res.json(result);
  })
);

chatsRouter.post(
  "/:id/not-agreed",
  asyncHandler(async (req, res) => {
    const chat = await loadChatForViewer(req.params.id, req.user!);
    if (chat.clientId !== req.user!.id && chat.performerId !== req.user!.id) {
      throw new HttpError(403, "Нет доступа к действию", "forbidden");
    }

    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const updatedChat = await tx.chat.update({
        where: { id: chat.id },
        data: {
          status: "not_agreed",
          notAgreedAt: now,
          closedAt: now,
          archivedAt: now,
          clientConfirmedAt: null,
          performerConfirmedAt: null
        },
        include: chatInclude
      });
      if (chat.responseId) {
        await tx.requestResponse.update({
          where: { id: chat.responseId },
          data: { status: "not_agreed", notAgreedAt: now }
        });
      }
      await tx.clientRequest.update({
        where: { id: chat.requestId },
        data: { status: "has_responses", visibilityStatus: "city_visible", selectedPerformerId: null }
      });
      await tx.chatMessage.create({
        data: {
          chatId: chat.id,
          senderId: null,
          text: "Условия не согласованы. Чат перенесён в архив, заявка остаётся доступной для других помощников.",
          isSystem: true
        }
      });
      await writeAudit(req.user!.id, "chat.not_agreed", "chat", chat.id, { requestId: chat.requestId }, tx);
      return serializeChat(updatedChat, req.user!);
    });

    res.json(result);
  })
);

chatsRouter.post(
  "/:id/propose-new-terms",
  asyncHandler(async (req, res) => {
    const chat = await loadChatForViewer(req.params.id, req.user!);
    if (chat.performerId !== req.user!.id) {
      throw new HttpError(403, "Новое предложение может отправить помощник", "forbidden");
    }
    if (chat.status !== "not_agreed" && !chat.archivedAt) {
      throw new HttpError(400, "Повторное предложение доступно только из архивного несогласованного чата", "chat_not_archived");
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedChat = await tx.chat.update({
        where: { id: chat.id },
        data: {
          status: "open",
          archivedAt: null,
          closedAt: null,
          reopenedAt: new Date(),
          clientConfirmedAt: null,
          performerConfirmedAt: null
        },
        include: chatInclude
      });
      if (chat.responseId) {
        await tx.requestResponse.update({
          where: { id: chat.responseId },
          data: { status: "new_terms_proposed", newTermsOfferedAt: new Date() }
        });
      }
      await tx.clientRequest.update({
        where: { id: chat.requestId },
        data: { status: "discussion", visibilityStatus: "city_visible" }
      });
      await tx.chatMessage.create({
        data: {
          chatId: chat.id,
          senderId: null,
          text: `Помощник отправил новое предложение по заявке ${chat.request.publicNumber ?? chat.requestId}. Заказчик может рассмотреть его снова или оставить чат в архиве.`,
          isSystem: true
        }
      });
      await writeAudit(req.user!.id, "chat.propose_new_terms", "chat", chat.id, { requestId: chat.requestId }, tx);
      return serializeChat(updatedChat, req.user!);
    });

    res.json(result);
  })
);

async function loadChatForViewer(
  chatId: string,
  viewer: { id: string; role: string }
) {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: chatInclude
  });

  if (!chat) {
    throw new HttpError(404, "Чат не найден", "chat_not_found");
  }

  const canView =
    ["admin", "superadmin"].includes(viewer.role) ||
    chat.clientId === viewer.id ||
    chat.performerId === viewer.id;

  if (!canView) {
    throw new HttpError(403, "Нет доступа к чату", "forbidden");
  }

  await writeAudit(viewer.id, "chat.view", "chat", chat.id, {
    requestId: chat.requestId,
    phoneVisible: false
  });

  return chat;
}

async function finalizeAgreementIfReady(
  tx: any,
  chatId: string,
  viewer: { id: string; role: string }
) {
  const chat = await tx.chat.findUnique({
    where: { id: chatId },
    include: chatInclude
  });
  if (!chat) {
    throw new HttpError(404, "Чат не найден", "chat_not_found");
  }
  if (chat.agreementFinalizedAt || chat.status === "in_work" || chat.request?.status === "in_progress") {
    return serializeChat(chat, viewer);
  }
  if (!chat.agreedHelperAmount) {
    throw new HttpError(400, "Сначала согласуйте и сохраните стоимость помощи", "agreement_terms_required");
  }
  if (!chat.clientConfirmedAt || !chat.performerConfirmedAt) {
    return serializeChat(chat, viewer);
  }

  const settings = await getServiceFeeSettings(tx);
  const agreementDraft = await tx.agreementVersion.findFirst({ where: { chatId: chat.id, status: "draft" }, orderBy: { version: "desc" } });
  if (!agreementDraft) throw new HttpError(400, "Сначала сохраните согласованные условия и график", "agreement_version_required");
  const clientFeeTotal = agreementDraft.visitCount * settings.clientServiceFeeAmount;
  const helperFeeTotal = agreementDraft.visitCount * settings.performerCommissionAmount;
  const [clientBalance, helperBalance] = await Promise.all([
    tx.user.findUnique({ where: { id: chat.clientId }, select: { balance: true, bonusBalance: true } }),
    tx.user.findUnique({ where: { id: chat.performerId }, select: { balance: true, bonusBalance: true } })
  ]);
  if (!clientBalance || !helperBalance) throw new HttpError(404, "Участник заявки не найден", "participant_not_found");
  if (!hasAvailableBalance(clientBalance, clientFeeTotal, true)) {
    await tx.chat.update({ where: { id: chat.id }, data: { status: "waiting_client_balance" } });
    await tx.clientRequest.update({ where: { id: chat.requestId }, data: { status: "waiting_client_balance" } });
    const updated = await tx.chat.findUnique({ where: { id: chat.id }, include: chatInclude });
    return serializeChat(updated, viewer);
  }
  if (!hasAvailableBalance(helperBalance, helperFeeTotal, true)) {
    await tx.chat.update({ where: { id: chat.id }, data: { status: "waiting_performer_balance" } });
    await tx.clientRequest.update({ where: { id: chat.requestId }, data: { status: "waiting_performer_balance" } });
    const updated = await tx.chat.findUnique({ where: { id: chat.id }, include: chatInclude });
    return serializeChat(updated, viewer);
  }

  const finalizedAt = new Date();
  const claimed = await tx.chat.updateMany({
    where: {
      id: chat.id,
      agreementFinalizedAt: null,
      status: { not: "in_work" }
    },
    data: { agreementFinalizedAt: finalizedAt }
  });
  if (claimed.count === 0) {
    const current = await tx.chat.findUnique({ where: { id: chat.id }, include: chatInclude });
    return serializeChat(current, viewer);
  }

  const batch = await finalizeAgreementBatchTx(tx, chat, viewer.id);
  if (!batch) return serializeChat(chat, viewer);
  const agreementVersion = await tx.agreementVersion.findUnique({ where: { id: batch.agreementVersionId } });
  await tx.clientRequest.update({
    where: { id: chat.requestId },
    data: {
      selectedPerformerId: chat.performerId,
      status: "in_progress"
    }
  });
  if (chat.responseId) {
    await tx.requestResponse.update({
      where: { id: chat.responseId },
      data: { status: "accepted_by_client", acceptedAt: new Date() }
    });
  }
  await tx.requestResponse.updateMany({
    where: { requestId: chat.requestId, id: chat.responseId ? { not: chat.responseId } : undefined, status: "pending" },
    data: { status: "rejected_by_client", rejectedAt: new Date() }
  });
  await tx.chat.update({
    where: { id: chat.id },
    data: {
      status: "in_work",
      customerServiceFeeAmount: batch.customerServiceFeeTotal,
      helperServiceFeeAmount: batch.helperServiceFeeTotal,
      customerTotalAmount: (agreementVersion?.totalHelpAmount ?? chat.agreedHelperAmount) + batch.customerServiceFeeTotal,
      helperNetAmount: Math.max(0, (agreementVersion?.totalHelpAmount ?? chat.agreedHelperAmount) - batch.helperServiceFeeTotal),
      conditionsJson: JSON.stringify({
        requestTitle: chat.request.title,
        publicNumber: chat.request.publicNumber,
        agreedHelperAmount: chat.agreedHelperAmount,
        agreementVersionId: agreementVersion?.id,
        agreementVersion: agreementVersion?.version,
        termsHash: agreementVersion?.termsHash,
        visitCount: batch.visitCount,
        expandedVisits: agreementVersion ? parseJsonArray(agreementVersion.expandedVisitsJson) : [],
        selectedTasks: agreementVersion ? parseJsonArray(agreementVersion.selectedTasksJson) : [],
        agreedHelpAmountPerVisit: chat.agreedHelperAmount,
        totalHelpAmount: agreementVersion?.totalHelpAmount,
        customerServiceFeeAmount: settings.clientServiceFeeAmount,
        helperServiceFeeAmount: settings.performerCommissionAmount,
        customerServiceFeeTotal: batch.customerServiceFeeTotal,
        helperServiceFeeTotal: batch.helperServiceFeeTotal,
        customerTotalAmount: (agreementVersion?.totalHelpAmount ?? chat.agreedHelperAmount) + batch.customerServiceFeeTotal,
        helperNetAmount: Math.max(0, (agreementVersion?.totalHelpAmount ?? chat.agreedHelperAmount) - batch.helperServiceFeeTotal),
        agreedPackageId: chat.agreedPackageId,
        agreedPackageTitle: chat.agreedPackageTitle,
        agreedAddons: parseStringArray(chat.agreedAddonsJson),
        agreedDurationMinutes: chat.agreedDurationMinutes,
        agreedScheduledAt: chat.agreedScheduledAt,
        agreedTermsComment: chat.agreedTermsComment,
        agreedByCustomerAt: chat.agreedByCustomerAt,
        agreedByHelperAt: chat.agreedByHelperAt,
        termsUpdatedAt: chat.termsUpdatedAt,
        termsUpdatedByUserId: chat.termsUpdatedByUserId
      })
    }
  });
  await tx.chatMessage.create({
    data: {
      chatId: chat.id,
      senderId: null,
      text: `Сервис «Забота Рядом»: заявка ${chat.request.publicNumber ?? chat.requestId} перешла в работу. Сервисный сбор списан.`,
      isSystem: true
    }
  });
  await writeAudit(viewer.id, "chat.agreement_finalized", "chat", chat.id, {
    requestId: chat.requestId,
    clientServiceFeeAmount: batch.customerServiceFeeTotal,
    performerCommissionAmount: batch.helperServiceFeeTotal,
    visitCount: batch.visitCount,
    agreementVersionId: batch.agreementVersionId,
    agreedHelperAmount: chat.agreedHelperAmount
  }, tx);

  const updated = await tx.chat.findUnique({ where: { id: chat.id }, include: chatInclude });
  return serializeChat(updated, viewer);
}

function serializeChat(chat: any, viewer: { id: string; role: string }) {
  const isAdmin = ["admin", "superadmin"].includes(viewer.role);
  const canSeeExactAddress =
    isAdmin ||
    chat.clientId === viewer.id ||
    (chat.performerId === viewer.id && canShowExactAddressToHelper(chat.request?.status, chat.status));
  const request = chat.request
    ? serializeRequestForUser(chat.request, viewer as any, {
        id: chat.id,
        status: chat.status,
        performerId: chat.performerId,
        clientConfirmedAt: chat.clientConfirmedAt,
        performerConfirmedAt: chat.performerConfirmedAt,
        agreementFinalizedAt: chat.agreementFinalizedAt,
        agreedHelperAmount: chat.agreedHelperAmount,
        customerServiceFeeAmount: chat.customerServiceFeeAmount,
        helperServiceFeeAmount: chat.helperServiceFeeAmount,
        customerTotalAmount: chat.customerTotalAmount,
        helperNetAmount: chat.helperNetAmount,
        agreedPackageId: chat.agreedPackageId,
        agreedPackageTitle: chat.agreedPackageTitle,
        agreedAddonsJson: chat.agreedAddonsJson,
        agreedDurationMinutes: chat.agreedDurationMinutes,
        agreedScheduledAt: chat.agreedScheduledAt,
        agreedTermsComment: chat.agreedTermsComment,
        agreedByCustomerAt: chat.agreedByCustomerAt,
        agreedByHelperAt: chat.agreedByHelperAt,
        termsUpdatedAt: chat.termsUpdatedAt,
        termsUpdatedByUserId: chat.termsUpdatedByUserId,
        archivedAt: chat.archivedAt
      })
    : chat.request;
  const agreementVersion = chat.agreementVersions?.[0];
  return {
    id: chat.id,
    requestId: chat.requestId,
    responseId: chat.responseId,
    clientId: chat.clientId,
    performerId: chat.performerId,
    status: chat.status,
    clientConfirmedAt: chat.clientConfirmedAt,
    performerConfirmedAt: chat.performerConfirmedAt,
    agreementFinalizedAt: chat.agreementFinalizedAt,
    agreedHelperAmount: chat.agreedHelperAmount,
    customerServiceFeeAmount: chat.customerServiceFeeAmount,
    helperServiceFeeAmount: chat.helperServiceFeeAmount,
    customerTotalAmount: chat.customerTotalAmount,
    helperNetAmount: chat.helperNetAmount,
    agreedPackageId: chat.agreedPackageId,
    agreedPackageTitle: chat.agreedPackageTitle,
    agreedAddonsJson: chat.agreedAddonsJson,
    agreedDurationMinutes: chat.agreedDurationMinutes,
    agreedScheduledAt: chat.agreedScheduledAt,
    agreedTermsComment: chat.agreedTermsComment,
    agreedByCustomerAt: chat.agreedByCustomerAt,
    agreedByHelperAt: chat.agreedByHelperAt,
    termsUpdatedAt: chat.termsUpdatedAt,
    termsUpdatedByUserId: chat.termsUpdatedByUserId,
    agreedTerms: serializeAgreedTerms(chat),
    agreementVersion: agreementVersion ? {
      id: agreementVersion.id,
      version: agreementVersion.version,
      status: agreementVersion.status,
      selectedTasks: parseJsonArray(agreementVersion.selectedTasksJson),
      scheduleRules: safeJsonObject(agreementVersion.scheduleRulesJson),
      expandedVisits: parseJsonArray(agreementVersion.expandedVisitsJson),
      pricingSnapshot: safeJsonObject(agreementVersion.pricingSnapshotJson),
      visitCount: agreementVersion.visitCount,
      totalDurationMinutes: agreementVersion.totalDurationMinutes,
      totalHelpAmount: agreementVersion.totalHelpAmount,
      customerServiceFeeTotal: agreementVersion.customerServiceFeeTotal,
      helperServiceFeeTotal: agreementVersion.helperServiceFeeTotal,
      termsHash: agreementVersion.termsHash,
      customerConfirmedAt: agreementVersion.customerConfirmedAt,
      helperConfirmedAt: agreementVersion.helperConfirmedAt,
      finalizedAt: agreementVersion.finalizedAt,
      contract: agreementVersion.contract ? serializeAgreementContract(agreementVersion.contract) : null
    } : null,
    conditionsJson: chat.conditionsJson,
    notAgreedAt: chat.notAgreedAt,
    reopenedAt: chat.reopenedAt,
    createdAt: chat.createdAt,
    closedAt: chat.closedAt,
    archivedAt: chat.archivedAt,
    phoneVisible: false,
    exactAddressVisible: canSeeExactAddress,
    request,
    client: chat.client,
    performer: chat.performer,
    messages: chat.messages.map((message: any) => ({
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      text: message.visibility === "deleted"
        ? "Сообщение удалено администратором"
        : message.isHidden && !isAdmin
          ? "Сообщение скрыто, потому что содержит контактные данные."
          : message.text,
      visibility: message.visibility,
      isSystem: message.isSystem,
      moderationStatus: message.moderationStatus,
      isHidden: message.isHidden,
      createdAt: message.createdAt,
      sender: message.sender
    }))
  };
}

function safeJsonObject(value?: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseStringArray(value?: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonArray(value?: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function durationMinutes(hours?: number | null) {
  return hours && hours > 0 ? Math.round(hours * 60) : null;
}
