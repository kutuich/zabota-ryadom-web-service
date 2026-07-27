import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { chargeAgreementFeesTx, getServiceFeeSettings, hasAvailableBalance } from "../services/balanceService";
import { writeAudit } from "../services/auditService";
import { requireFeatureConsent } from "../services/legalService";
import { moderateChatMessage } from "../services/moderationService";
import { serializeRequestForUser } from "../services/requestPolicy";
import { canShowExactAddressToHelper } from "../services/addressService";
import { serializeAgreedTerms } from "../services/agreementTermsService";
import { PRICING_ADDONS, PRICING_PACKAGES } from "../services/pricingService";
import { asyncHandler, HttpError } from "../utils/http";

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
  }
};

const agreementTermsSchema = z.object({
  agreedHelperAmount: z.number().int().min(1).max(100_000),
  agreedPackageId: z.string().min(1).max(80).nullable().optional(),
  agreedAddons: z.array(z.string().min(1).max(80)).max(20).optional(),
  agreedDurationMinutes: z.number().int().min(15).max(24 * 60).nullable().optional(),
  agreedScheduledAt: z.string().max(40).refine((value) => !Number.isNaN(Date.parse(value)), "Некорректная дата и время").nullable().optional(),
  agreedTermsComment: z.string().max(1000).nullable().optional()
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
      throw new HttpError(400, "Условия этой заявки больше нельзя изменить", "agreement_terms_locked");
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
  const [client, performer] = await Promise.all([
    tx.user.findUnique({ where: { id: chat.clientId }, select: { balance: true, bonusBalance: true } }),
    tx.user.findUnique({ where: { id: chat.performerId }, select: { balance: true, bonusBalance: true } })
  ]);
  if (!client || !performer) {
    throw new HttpError(404, "Участник заявки не найден", "participant_not_found");
  }

  if (!hasAvailableBalance(client, settings.clientServiceFeeAmount, true)) {
    await tx.chat.update({ where: { id: chat.id }, data: { status: "waiting_client_balance" } });
    await tx.clientRequest.update({ where: { id: chat.requestId }, data: { status: "waiting_client_balance" } });
    await writeAudit(viewer.id, "chat.waiting_client_balance", "chat", chat.id, settings, tx);
    const updated = await tx.chat.findUnique({ where: { id: chat.id }, include: chatInclude });
    return serializeChat(updated, viewer);
  }

  if (!hasAvailableBalance(performer, settings.performerCommissionAmount, true)) {
    await tx.chat.update({ where: { id: chat.id }, data: { status: "waiting_performer_balance" } });
    await tx.clientRequest.update({ where: { id: chat.requestId }, data: { status: "waiting_performer_balance" } });
    await writeAudit(viewer.id, "chat.waiting_performer_balance", "chat", chat.id, settings, tx);
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

  await chargeAgreementFeesTx(tx, {
    requestId: chat.requestId,
    clientId: chat.clientId,
    performerId: chat.performerId,
    actorUserId: viewer.id
  });
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
      customerServiceFeeAmount: settings.clientServiceFeeAmount,
      helperServiceFeeAmount: settings.performerCommissionAmount,
      customerTotalAmount: chat.agreedHelperAmount + settings.clientServiceFeeAmount,
      helperNetAmount: Math.max(0, chat.agreedHelperAmount - settings.performerCommissionAmount),
      conditionsJson: JSON.stringify({
        requestTitle: chat.request.title,
        publicNumber: chat.request.publicNumber,
        agreedHelperAmount: chat.agreedHelperAmount,
        customerServiceFeeAmount: settings.clientServiceFeeAmount,
        helperServiceFeeAmount: settings.performerCommissionAmount,
        customerTotalAmount: chat.agreedHelperAmount + settings.clientServiceFeeAmount,
        helperNetAmount: Math.max(0, chat.agreedHelperAmount - settings.performerCommissionAmount),
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
    clientServiceFeeAmount: settings.clientServiceFeeAmount,
    performerCommissionAmount: settings.performerCommissionAmount,
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

function stringOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function durationMinutes(hours?: number | null) {
  return hours && hours > 0 ? Math.round(hours * 60) : null;
}
