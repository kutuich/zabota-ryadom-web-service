import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { chargeAgreementFeesTx, getServiceFeeSettings, hasAvailableBalance } from "../services/balanceService";
import { writeAudit } from "../services/auditService";
import { requireFeatureConsent } from "../services/legalService";
import { moderateChatMessage } from "../services/moderationService";
import {
  buildYandexExactMapAddress,
  buildYandexMapsSearchUrl,
  buildYandexPublicMapAddress,
  canShowExactAddressToHelper
} from "../services/addressService";
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

chatsRouter.post(
  "/:id/client-confirm",
  requireFeatureConsent("confirm_helper"),
  asyncHandler(async (req, res) => {
    const chat = await loadChatForViewer(req.params.id, req.user!);
    if (chat.clientId !== req.user!.id) {
      throw new HttpError(403, "Подтверждать условия может только заказчик заявки", "forbidden");
    }
    if (["not_agreed", "archived", "completed"].includes(chat.status)) {
      throw new HttpError(400, "Этот чат уже не активен", "chat_not_active");
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.chat.update({
        where: { id: chat.id },
        data: {
          clientConfirmedAt: new Date(),
          status: chat.performerConfirmedAt ? "waiting_performer_confirmation" : "waiting_performer_confirmation"
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
      return finalizeAgreementIfReady(tx, chat.id, req.user!.id);
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
    if (["not_agreed", "archived", "completed"].includes(chat.status)) {
      throw new HttpError(400, "Этот чат уже не активен", "chat_not_active");
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.chat.update({
        where: { id: chat.id },
        data: {
          performerConfirmedAt: new Date(),
          status: chat.clientConfirmedAt ? "waiting_performer_confirmation" : "waiting_client_confirmation"
        }
      });
      await tx.clientRequest.update({
        where: { id: chat.requestId },
        data: { status: chat.clientConfirmedAt ? "waiting_performer_confirmation" : "waiting_client_confirmation" }
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
      return finalizeAgreementIfReady(tx, chat.id, req.user!.id);
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

async function finalizeAgreementIfReady(tx: any, chatId: string, actorUserId: string) {
  const chat = await tx.chat.findUnique({
    where: { id: chatId },
    include: chatInclude
  });
  if (!chat) {
    throw new HttpError(404, "Чат не найден", "chat_not_found");
  }
  if (!chat.clientConfirmedAt || !chat.performerConfirmedAt) {
    return serializeChat(chat, { id: actorUserId, role: "client" } as any);
  }

  const settings = await getServiceFeeSettings(tx);
  const [client, performer] = await Promise.all([
    tx.user.findUnique({ where: { id: chat.clientId }, select: { balance: true, bonusBalance: true } }),
    tx.user.findUnique({ where: { id: chat.performerId }, select: { balance: true, bonusBalance: true } })
  ]);
  if (!client || !performer) {
    throw new HttpError(404, "Участник заявки не найден", "participant_not_found");
  }

  if (!hasAvailableBalance(client, settings.clientServiceFeeAmount, settings.useBonusForCommission)) {
    await tx.chat.update({ where: { id: chat.id }, data: { status: "waiting_client_balance" } });
    await tx.clientRequest.update({ where: { id: chat.requestId }, data: { status: "waiting_client_balance" } });
    await writeAudit(actorUserId, "chat.waiting_client_balance", "chat", chat.id, settings, tx);
    const updated = await tx.chat.findUnique({ where: { id: chat.id }, include: chatInclude });
    return serializeChat(updated, { id: actorUserId, role: "client" } as any);
  }

  if (!hasAvailableBalance(performer, settings.performerCommissionAmount, settings.useBonusForCommission)) {
    await tx.chat.update({ where: { id: chat.id }, data: { status: "waiting_performer_balance" } });
    await tx.clientRequest.update({ where: { id: chat.requestId }, data: { status: "waiting_performer_balance" } });
    await writeAudit(actorUserId, "chat.waiting_performer_balance", "chat", chat.id, settings, tx);
    const updated = await tx.chat.findUnique({ where: { id: chat.id }, include: chatInclude });
    return serializeChat(updated, { id: actorUserId, role: "performer" } as any);
  }

  await chargeAgreementFeesTx(tx, {
    requestId: chat.requestId,
    clientId: chat.clientId,
    performerId: chat.performerId,
    actorUserId
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
      conditionsJson: JSON.stringify({
        requestTitle: chat.request.title,
        publicNumber: chat.request.publicNumber,
        date: chat.request.date,
        timeFrom: chat.request.timeFrom,
        timeTo: chat.request.timeTo,
        expectedDurationHours: chat.request.expectedDurationHours,
        priceEstimateAmount: chat.request.priceEstimateAmount,
        pricingBreakdownJson: chat.request.pricingBreakdownJson
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
  await writeAudit(actorUserId, "chat.agreement_finalized", "chat", chat.id, {
    requestId: chat.requestId,
    clientServiceFeeAmount: settings.clientServiceFeeAmount,
    performerCommissionAmount: settings.performerCommissionAmount
  }, tx);

  const updated = await tx.chat.findUnique({ where: { id: chat.id }, include: chatInclude });
  return serializeChat(updated, { id: actorUserId, role: "client" } as any);
}

function serializeChat(chat: any, viewer: { id: string; role: string }) {
  const isAdmin = ["admin", "superadmin"].includes(viewer.role);
  const canSeeExactAddress =
    isAdmin ||
    chat.clientId === viewer.id ||
    (chat.performerId === viewer.id && canShowExactAddressToHelper(chat.request?.status, chat.status));
  const addressParts = {
    city: chat.request?.addressCity,
    street: chat.request?.addressStreet,
    house: chat.request?.addressHouse
  };
  const builtPublicMapAddress = buildYandexPublicMapAddress(addressParts);
  const builtExactMapAddress = buildYandexExactMapAddress(addressParts);
  const publicMapAddress = chat.request?.yandexPublicMapAddress || builtPublicMapAddress || chat.request?.publicAddress || chat.request?.approximateAddressText || "";
  const exactMapAddress = chat.request?.yandexExactMapAddress || builtExactMapAddress || "";
  const request = chat.request
    ? {
        ...chat.request,
        addressText: canSeeExactAddress ? chat.request.addressText : null,
        fullAddress: canSeeExactAddress ? chat.request.fullAddress ?? chat.request.addressText : null,
        publicAddress: chat.request.publicAddress || builtPublicMapAddress || chat.request.approximateAddressText,
        addressHouse: canSeeExactAddress ? chat.request.addressHouse : null,
        addressApartment: canSeeExactAddress ? chat.request.addressApartment : null,
        addressEntrance: canSeeExactAddress ? chat.request.addressEntrance : null,
        addressFloor: canSeeExactAddress ? chat.request.addressFloor : null,
        addressIntercom: canSeeExactAddress ? chat.request.addressIntercom : null,
        addressComment: canSeeExactAddress ? chat.request.addressComment : null,
        yandexPublicMapAddress: publicMapAddress,
        yandexExactMapAddress: canSeeExactAddress ? exactMapAddress : null,
        yandexPublicMapUrl: buildYandexMapsSearchUrl(publicMapAddress),
        yandexExactMapUrl: canSeeExactAddress ? buildYandexMapsSearchUrl(exactMapAddress) : null,
        lat: canSeeExactAddress ? chat.request.lat : chat.request.approximateLat,
        lng: canSeeExactAddress ? chat.request.lng : chat.request.approximateLng,
        exactAddressVisible: canSeeExactAddress,
        phoneVisible: false
      }
    : chat.request;
  return {
    ...chat,
    phoneVisible: false,
    exactAddressVisible: canSeeExactAddress,
    request,
    messages: chat.messages.map((message: any) => ({
      ...message,
      text: message.visibility === "deleted"
        ? "Сообщение удалено администратором"
        : message.isHidden && !isAdmin
          ? "Сообщение скрыто, потому что содержит контактные данные."
          : message.text
    }))
  };
}
