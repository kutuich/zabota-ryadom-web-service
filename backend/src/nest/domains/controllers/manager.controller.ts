import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import { NestAdminGuard, NestAdminManagerGuard, NestFeatureConsentGuard, NestJwtAuthGuard, NestRolesGuard, RequireRoles } from "../../common/auth.guards";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../../db/prisma";
import { HttpError } from "../../../utils/http";
import { writeAudit } from "../../../services/auditService";
import { blockUser, unblockUser } from "../../../services/userAccessService";
import { serializeAgreedTerms } from "../../../services/agreementTermsService";
import { calculatePrice } from "../../../services/pricingService";
import { nextRequestPublicNumber } from "../../../services/requestNumberService";
import { detectMedicalTerms } from "../../../services/requestPolicy";
import {
  buildFullAddress,
  buildPublicAddress,
  buildYandexExactMapAddress,
  buildYandexPublicMapAddress,
  normalizeAddressParts
} from "../../../services/addressService";
import { createRequestCategorySnapshotTx, serializeRequestCategorySnapshot } from "../../../services/categoryStructureService";

const managerCreateRequestSchema = z.object({
  customerUserId: z.string().min(1),
  cityId: z.string().min(1),
  categoryId: z.string().min(1),
  structuredCategoryId: z.string().min(1).optional(),
  structuredSubcategoryId: z.string().min(1).optional(),
  categoryTaskTemplateId: z.string().min(1).optional(),
  contactName: z.string().max(120).optional(),
  contactPhone: z.string().max(40).optional(),
  helpFor: z.enum(["elderly", "child", "limited_mobility", "home_family", "other"]).optional(),
  dependentAge: z.number().int().positive().max(120).optional(),
  title: z.string().min(4).max(160),
  description: z.string().min(10).max(4000),
  addressStreet: z.string().min(1).max(160),
  addressHouse: z.string().min(1).max(60),
  addressApartment: z.string().max(60).optional(),
  addressEntrance: z.string().max(60).optional(),
  addressFloor: z.string().max(60).optional(),
  addressIntercom: z.string().max(120).optional(),
  addressComment: z.string().max(500).optional(),
  date: z.string().optional(),
  timeFrom: z.string().max(20).optional(),
  timeTo: z.string().max(20).optional(),
  expectedDurationHours: z.number().positive().max(24).optional(),
  urgency: z.enum(["normal", "urgent", "regular"]).default("normal"),
  priceEstimateAmount: z.number().int().positive().max(100_000).optional(),
  comment: z.string().max(2000).optional()
});

async function managerViewAudit(actorUserId: string, action: string, entityType: string, entityId: string) {
  await writeAudit(actorUserId, action, entityType, entityId, {
    actorUserId,
    actorRole: "manager",
    targetUserId: entityType === "user" ? entityId : null,
    source: "manager_panel"
  });
}
@Controller("api/manager")
export class ManagerController {
  @Get("/summary")
  @RequireRoles("manager")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async getsummary0(@Req() _req: Request, @Res() res: Response) {
    const [usersTotal, requestsTotal, chatsTotal, complaintsTotal, paymentsTotal, blockedUsersTotal] = await Promise.all([
      prisma.user.count(),
      prisma.clientRequest.count(),
      prisma.chat.count(),
      prisma.complaint.count(),
      prisma.paymentTransaction.count(),
      prisma.user.count({ where: { status: "blocked" } })
    ]);
    res.json({ usersTotal, requestsTotal, chatsTotal, complaintsTotal, paymentsTotal, blockedUsersTotal });
  }

  @Get("/users")
  @RequireRoles("manager")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async getusers1(@Req() _req: Request, @Res() res: Response) {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        role: true,
        displayName: true,
        phone: true,
        email: true,
        cityId: true,
        status: true,
        balance: true,
        bonusBalance: true,
        createdAt: true,
        blockedAt: true,
        blockedByAdminId: true,
        blockedByRole: true,
        blockReason: true,
        city: true,
        identities: { select: { provider: true, displayName: true, createdAt: true } },
        riskFlags: { where: { resolvedAt: null }, orderBy: { createdAt: "desc" } }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    res.json(users);
  }

  @Get("/users/:id")
  @RequireRoles("manager")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async getusersId2(@Req() req: Request, @Res() res: Response) {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        role: true,
        displayName: true,
        phone: true,
        email: true,
        cityId: true,
        status: true,
        balance: true,
        bonusBalance: true,
        createdAt: true,
        updatedAt: true,
        lastSeenAt: true,
        blockedAt: true,
        blockedByAdminId: true,
        blockedByRole: true,
        blockReason: true,
        city: true,
        clientProfile: true,
        performerProfile: true,
        identities: { select: { provider: true, displayName: true, createdAt: true } },
        riskFlags: { orderBy: { createdAt: "desc" } }
      }
    });
    if (!user) throw new HttpError(404, "Пользователь не найден", "user_not_found");
    const [balanceTransactions, requestsCount, responsesCount, chatsCount, complaintsCount, requestActivity, responseActivity, chatActivity, complaintActivity] = await Promise.all([
      prisma.balanceTransaction.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          type: true,
          source: true,
          amount: true,
          balanceKind: true,
          reason: true,
          comment: true,
          balanceBefore: true,
          balanceAfter: true,
          createdAt: true,
          createdByAdmin: { select: { id: true, displayName: true } }
        },
        orderBy: { createdAt: "desc" },
        take: 10
      }),
      prisma.clientRequest.count({ where: { OR: [{ clientId: user.id }, { selectedPerformerId: user.id }] } }),
      prisma.requestResponse.count({ where: { performerId: user.id } }),
      prisma.chat.count({ where: { OR: [{ clientId: user.id }, { performerId: user.id }] } }),
      prisma.complaint.count({ where: { OR: [{ fromUserId: user.id }, { againstUserId: user.id }] } }),
      prisma.clientRequest.aggregate({ where: { OR: [{ clientId: user.id }, { selectedPerformerId: user.id }] }, _max: { updatedAt: true } }),
      prisma.requestResponse.aggregate({ where: { performerId: user.id }, _max: { createdAt: true } }),
      prisma.chat.aggregate({ where: { OR: [{ clientId: user.id }, { performerId: user.id }] }, _max: { createdAt: true } }),
      prisma.complaint.aggregate({ where: { OR: [{ fromUserId: user.id }, { againstUserId: user.id }] }, _max: { createdAt: true } })
    ]);
    const activityDates = [
      user.lastSeenAt,
      user.updatedAt,
      requestActivity._max.updatedAt,
      responseActivity._max.createdAt,
      chatActivity._max?.createdAt,
      complaintActivity._max.createdAt
    ].filter((value): value is Date => Boolean(value));
    const registrationSource = user.identities.some((identity) => identity.provider === "vk")
      ? user.role === "oauth_pending" ? "vk_pending" : "vk"
      : "standard";
    await managerViewAudit(req.user!.id, "manager.user.view", "user", user.id);
    res.json({
      user: { ...user, registrationSource },
      finance: {
        mainBalance: user.balance,
        bonusBalance: user.bonusBalance,
        availableBalance: user.balance + user.bonusBalance,
        balanceTransactions
      },
      activity: {
        requestsCount,
        responsesCount,
        chatsCount,
        complaintsCount,
        lastActivityAt: activityDates.length
          ? new Date(Math.max(...activityDates.map((value) => value.getTime())))
          : user.createdAt
      }
    });
  }

  @Post("/users/:id/block")
  @HttpCode(200)
  @RequireRoles("manager")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async postusersIdBlock3(@Req() req: Request, @Res() res: Response) {
    const input = z.object({ reason: z.string().min(3).max(500) }).parse(req.body);
    const user = await blockUser({ id: req.user!.id, role: "manager" }, req.params.id, input.reason);
    const { passwordHash: _passwordHash, ...safeUser } = user;
    res.json(safeUser);
  }

  @Post("/users/:id/unblock")
  @HttpCode(200)
  @RequireRoles("manager")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async postusersIdUnblock4(@Req() req: Request, @Res() res: Response) {
    const user = await unblockUser({ id: req.user!.id, role: "manager" }, req.params.id);
    const { passwordHash: _passwordHash, ...safeUser } = user;
    res.json(safeUser);
  }

  @Get("/requests")
  @RequireRoles("manager")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async getrequests5(@Req() _req: Request, @Res() res: Response) {
    const requests = await prisma.clientRequest.findMany({
      include: {
        city: true,
        category: true,
        client: { select: { id: true, displayName: true, phone: true } },
        createdByManager: { select: { id: true, displayName: true } },
        selectedPerformer: { select: { id: true, displayName: true, phone: true } },
        chats: { orderBy: { createdAt: "desc" }, take: 1 },
        categorySnapshots: { orderBy: { createdAt: "desc" }, take: 1 }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    res.json(requests.map((request) => ({
      ...request,
      chat: request.chats[0]
        ? { ...request.chats[0], agreedTerms: serializeAgreedTerms(request.chats[0]) }
        : null,
      categorySnapshot: serializeRequestCategorySnapshot(request.categorySnapshots[0])
    })));
  }

  @Post("/requests")
  @HttpCode(200)
  @RequireRoles("manager")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async postrequests6(@Req() req: Request, @Res() res: Response) {
    const input = managerCreateRequestSchema.parse(req.body);
    const medicalMatches = detectMedicalTerms(`${input.title} ${input.description}`);
    if (medicalMatches.length > 0) {
      throw new HttpError(
        400,
        "Уберите из заявки действия, относящиеся к медицинским процедурам.",
        "medical_terms_forbidden",
        { matches: medicalMatches }
      );
    }

    const [customer, city, category] = await Promise.all([
      prisma.user.findFirst({
        where: { id: input.customerUserId, role: "client", status: "active" },
        select: { id: true, displayName: true, phone: true }
      }),
      prisma.city.findFirst({
        where: {
          id: input.cityId,
          isActive: true,
          serviceStatus: "active",
          directoryStatus: { notIn: ["hidden", "duplicate"] }
        }
      }),
      prisma.serviceCategory.findFirst({ where: { id: input.categoryId, isActive: true } })
    ]);
    if (!customer) {
      throw new HttpError(400, "Можно выбрать только активного Заказчика.", "manager_customer_not_eligible");
    }
    if (!city || !category) {
      throw new HttpError(400, "Город или категория недоступны.", "dictionary_invalid");
    }

    const address = normalizeAddressParts({
      city: city.name,
      street: input.addressStreet,
      house: input.addressHouse,
      apartment: input.addressApartment,
      entrance: input.addressEntrance,
      floor: input.addressFloor,
      intercom: input.addressIntercom,
      addressComment: input.addressComment
    }, city.name);
    const fullAddress = buildFullAddress(address);
    const publicAddress = buildPublicAddress(address);
    const pricing = calculatePrice({
      category,
      helperAmount: input.priceEstimateAmount,
      expectedDurationHours: input.expectedDurationHours,
      date: input.date,
      timeFrom: input.timeFrom,
      urgency: input.urgency,
      helpFor: input.helpFor
    });

    const created = await prisma.$transaction(async (tx) => {
      const publicNumber = await nextRequestPublicNumber(tx);
      const request = await tx.clientRequest.create({
        data: {
          publicNumber,
          clientId: customer.id,
          createdByRole: "manager",
          createdByManagerId: req.user!.id,
          cityId: city.id,
          categoryId: category.id,
          contactName: input.contactName?.trim() || customer.displayName,
          contactPhone: input.contactPhone?.trim() || customer.phone,
          helpFor: input.helpFor,
          dependentAge: input.dependentAge,
          title: input.title,
          description: input.description,
          addressText: fullAddress,
          approximateAddressText: publicAddress,
          addressCity: address.city,
          addressStreet: address.street,
          addressHouse: address.house,
          addressApartment: address.apartment,
          addressEntrance: address.entrance,
          addressFloor: address.floor,
          addressIntercom: address.intercom,
          addressComment: address.addressComment,
          fullAddress,
          publicAddress,
          yandexPublicMapAddress: buildYandexPublicMapAddress(address),
          yandexExactMapAddress: buildYandexExactMapAddress(address),
          approximateLat: city.mapCenterLat,
          approximateLng: city.mapCenterLng,
          mapPrivacyRadiusMeters: city.mapDefaultRadiusMeters,
          date: input.date ? new Date(input.date) : null,
          timeFrom: input.timeFrom,
          timeTo: input.timeTo,
          expectedDurationHours: input.expectedDurationHours,
          urgency: input.urgency,
          budgetAmount: pricing.performerPaymentAmount,
          priceEstimateAmount: pricing.performerPaymentAmount,
          pricingBreakdownJson: JSON.stringify(pricing),
          comment: input.comment,
          status: "draft",
          visibilityStatus: "private"
        },
        include: {
          city: true,
          category: true,
          client: { select: { id: true, displayName: true, phone: true } },
          createdByManager: { select: { id: true, displayName: true } }
        }
      });
      await createRequestCategorySnapshotTx(tx, {
        requestId: request.id,
        cityId: city.id,
        categoryId: input.structuredCategoryId,
        subcategoryId: input.structuredSubcategoryId,
        taskTemplateId: input.categoryTaskTemplateId
      });
      await writeAudit(req.user!.id, "manager.request.create_for_customer", "request", request.id, {
        managerUserId: req.user!.id,
        customerUserId: customer.id,
        requestId: request.id,
        cityId: city.id,
        source: "manager_panel"
      }, tx);
      return request;
    });

    res.status(201).json(created);
  }

  @Get("/requests/:id")
  @RequireRoles("manager")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async getrequestsId7(@Req() req: Request, @Res() res: Response) {
    const request = await prisma.clientRequest.findUnique({
      where: { id: req.params.id },
      include: {
        city: true,
        category: true,
        client: { select: { id: true, displayName: true, phone: true, email: true } },
        createdByManager: { select: { id: true, displayName: true } },
        selectedPerformer: { select: { id: true, displayName: true, phone: true, email: true } },
        responses: { include: { performer: { select: { id: true, displayName: true } } } },
        chats: { orderBy: { createdAt: "desc" } },
        categorySnapshots: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    });
    if (!request) throw new HttpError(404, "Заявка не найдена", "request_not_found");
    await managerViewAudit(req.user!.id, "manager.request.view", "request", request.id);
    res.json({ ...request, categorySnapshot: serializeRequestCategorySnapshot(request.categorySnapshots[0]) });
  }

  @Patch("/requests/:id/category")
  @RequireRoles("manager")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async patchrequestsIdCategory8(@Req() req: Request, @Res() res: Response) {
    const input = z.object({ categoryId: z.string().min(1), subcategoryId: z.string().optional(), taskTemplateId: z.string().optional() }).parse(req.body);
    const request = await prisma.clientRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw new HttpError(404, "Заявка не найдена", "request_not_found");
    if (["completed", "cancelled", "archived", "blocked"].includes(request.status)) throw new HttpError(409, "Категорию закрытой заявки изменить нельзя", "request_category_locked");
    const snapshot = await prisma.$transaction(async (tx) => {
      const created = await createRequestCategorySnapshotTx(tx, { requestId: request.id, cityId: request.cityId, categoryId: input.categoryId, subcategoryId: input.subcategoryId, taskTemplateId: input.taskTemplateId });
      if (!created) throw new HttpError(409, "Структура категорий города не настроена", "category_structure_missing");
      await writeAudit(req.user!.id, "manager.request.category.update", "request", request.id, { categoryId: input.categoryId, subcategoryId: input.subcategoryId, snapshotId: created.id }, tx);
      return created;
    });
    res.json(snapshot);
  }

  @Get("/chats")
  @RequireRoles("manager")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async getchats9(@Req() _req: Request, @Res() res: Response) {
    const chats = await prisma.chat.findMany({
      include: {
        request: { select: { id: true, publicNumber: true, title: true, status: true } },
        client: { select: { id: true, displayName: true } },
        performer: { select: { id: true, displayName: true } },
        messages: {
          include: { sender: { select: { id: true, displayName: true, role: true } } },
          orderBy: { createdAt: "desc" },
          take: 20
        }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    res.json(chats.map((chat) => ({ ...chat, agreedTerms: serializeAgreedTerms(chat) })));
  }

  @Get("/chats/:id")
  @RequireRoles("manager")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async getchatsId10(@Req() req: Request, @Res() res: Response) {
    const chat = await prisma.chat.findUnique({
      where: { id: req.params.id },
      include: {
        request: true,
        client: { select: { id: true, displayName: true } },
        performer: { select: { id: true, displayName: true } },
        messages: {
          include: { sender: { select: { id: true, displayName: true, role: true } } },
          orderBy: { createdAt: "asc" }
        }
      }
    });
    if (!chat) throw new HttpError(404, "Чат не найден", "chat_not_found");
    await managerViewAudit(req.user!.id, "manager.chat.view", "chat", chat.id);
    res.json({ ...chat, agreedTerms: serializeAgreedTerms(chat) });
  }

  @Get("/complaints")
  @RequireRoles("manager")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async getcomplaints11(@Req() _req: Request, @Res() res: Response) {
    res.json(await prisma.complaint.findMany({
      include: {
        fromUser: { select: { id: true, displayName: true, role: true } },
        againstUser: { select: { id: true, displayName: true, role: true } },
        request: { select: { id: true, publicNumber: true, title: true } },
        chat: { select: { id: true, status: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    }));
  }

  @Get("/complaints/:id")
  @RequireRoles("manager")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async getcomplaintsId12(@Req() req: Request, @Res() res: Response) {
    const complaint = await prisma.complaint.findUnique({
      where: { id: req.params.id },
      include: {
        fromUser: { select: { id: true, displayName: true, role: true, phone: true, email: true } },
        againstUser: { select: { id: true, displayName: true, role: true, phone: true, email: true } },
        request: true,
        chat: true
      }
    });
    if (!complaint) throw new HttpError(404, "Обращение не найдено", "complaint_not_found");
    await managerViewAudit(req.user!.id, "manager.complaint.view", "complaint", complaint.id);
    res.json(complaint);
  }

  @Get("/payments")
  @RequireRoles("manager")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async getpayments13(@Req() _req: Request, @Res() res: Response) {
    res.json(await prisma.paymentTransaction.findMany({
      select: {
        id: true,
        userId: true,
        provider: true,
        providerPaymentId: true,
        orderId: true,
        amount: true,
        currency: true,
        status: true,
        purpose: true,
        createdAt: true,
        paidAt: true,
        creditedAt: true,
        user: { select: { id: true, displayName: true, role: true, phone: true, email: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    }));
  }

  @Get("/balance-transactions")
  @RequireRoles("manager")
  @UseGuards(NestJwtAuthGuard, NestRolesGuard)
  async getbalanceTransactions14(@Req() _req: Request, @Res() res: Response) {
    res.json(await prisma.balanceTransaction.findMany({
      include: { user: { select: { id: true, displayName: true, role: true } } },
      orderBy: { createdAt: "desc" },
      take: 300
    }));
  }
}
