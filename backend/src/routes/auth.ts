import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { authenticate } from "../middleware/auth";
import { writeAudit } from "../services/auditService";
import { acceptLatestLegalDocuments, missingAcceptedDocumentTypes } from "../services/legalService";
import { isPhoneLikeLogin, normalizeRussianPhone } from "../services/phoneService";
import { isUserRole, type UserRole } from "../types/domain";
import { asyncHandler, HttpError } from "../utils/http";

export const authRouter = Router();

const consentTypes = [
  "terms",
  "privacy_policy",
  "personal_data_processing",
  "contact_data_transfer_for_request",
  "chat_rules",
  "payment_rules"
] as const;

const registerSchema = z.object({
  role: z.enum(["client", "performer"]),
  phone: z.string().min(7),
  email: z.string().email().optional().or(z.literal("")),
  password: z.string().min(8),
  displayName: z.string().min(2).max(120),
  cityId: z.string().min(1),
  acceptedConsentTypes: z.array(z.enum(consentTypes)).default([]),
  acceptedLegalDocumentTypes: z.array(z.string()).default([]),
  marketingNotificationsAccepted: z.boolean().default(false),
  dependentDataTransferConfirmed: z.boolean().default(false),
  helperNotEmployerAcknowledged: z.boolean().default(false),
  helperNoMedicalServicesConfirmed: z.boolean().default(false)
});

const loginSchema = z.object({
  phoneOrEmail: z.string().min(3),
  password: z.string().min(1)
});

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const normalizedPhone = normalizePhoneOrHttp(input.phone);
    const acceptedLegalDocumentTypes = Array.from(new Set([
      ...input.acceptedLegalDocumentTypes,
      ...(input.marketingNotificationsAccepted ? ["marketing_notifications_consent"] : [])
    ]));
    const missing = missingAcceptedDocumentTypes(input.role, acceptedLegalDocumentTypes);

    if (missing.length > 0) {
      throw new HttpError(400, "Нужно принять обязательные юридические документы", "MISSING_REQUIRED_CONSENT", { missing });
    }
    if (input.role === "client" && !input.dependentDataTransferConfirmed) {
      throw new HttpError(400, "Подтвердите основание для передачи данных человека, которому нужна помощь", "dependent_data_confirmation_required");
    }
    if (input.role === "performer" && !input.helperNotEmployerAcknowledged) {
      throw new HttpError(400, "Подтвердите, что сервис не является работодателем и не гарантирует заявки", "helper_not_employer_confirmation_required");
    }
    if (input.role === "performer" && !input.helperNoMedicalServicesConfirmed) {
      throw new HttpError(400, "Подтвердите запрет медицинских услуг", "helper_no_medical_confirmation_required");
    }

    const city = await prisma.city.findFirst({ where: { id: input.cityId, isActive: true } });
    if (!city) {
      throw new HttpError(400, "Город не найден или отключён", "city_invalid");
    }

    const phoneExisting = await prisma.user.findFirst({
      where: {
        OR: [
          { normalizedPhone },
          { phone: normalizedPhone }
        ]
      }
    });

    if (phoneExisting) {
      throw new HttpError(409, "Пользователь с таким телефоном уже зарегистрирован", "phone_exists");
    }

    if (input.email) {
      const emailExisting = await prisma.user.findUnique({ where: { email: input.email } });
      if (emailExisting) {
        throw new HttpError(409, "Пользователь с таким email уже есть", "email_exists");
      }
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await prisma.$transaction(async (tx) => {
      const ipAddress = getRequestIp(req);
      const userAgent = getRequestUserAgent(req);
      const created = await tx.user.create({
        data: {
          role: input.role as UserRole,
          rolesJson: JSON.stringify([input.role]),
          phone: normalizedPhone,
          normalizedPhone,
          email: input.email || null,
          displayName: input.displayName,
          passwordHash,
          cityId: input.cityId,
          status: "active"
        }
      });

      if (input.role === "client") {
        await tx.clientProfile.create({
          data: { userId: created.id, fullName: input.displayName, preferredContactMethod: "chat" }
        });
      } else {
        await tx.performerProfile.create({
          data: {
            userId: created.id,
            verificationStatuses: JSON.stringify(["documents_optional"]),
            selfEmployedStatus: "self_employed_not_provided",
            criminalRecordCertificateStatus: "criminal_record_not_provided"
          }
        });
      }

      const legacyConsentTypes = input.acceptedConsentTypes.length
        ? input.acceptedConsentTypes
        : ["terms", "privacy_policy", "personal_data_processing", "chat_rules"];

      await tx.consent.createMany({
        data: legacyConsentTypes.map((type) => ({
          userId: created.id,
          type,
          version: "2026-07-16-draft",
          ip: ipAddress,
          userAgent
        }))
      });

      await acceptLatestLegalDocuments({
        userId: created.id,
        documentTypes: acceptedLegalDocumentTypes,
        source: "registration",
        ipAddress,
        userAgent,
        client: tx
      });

      await writeAudit(created.id, "auth.register", "user", created.id, { role: input.role }, tx);
      return created;
    });

    res.status(201).json({
      token: signToken(user.id, input.role),
      user: await getUserPayload(user.id)
    });
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const login = input.phoneOrEmail.trim();
    const user = isPhoneLikeLogin(login)
      ? await prisma.user.findFirst({
          where: {
            OR: [
              { normalizedPhone: normalizePhoneOrHttp(login) },
              { phone: normalizePhoneOrHttp(login) }
            ]
          }
        })
      : await prisma.user.findFirst({ where: { email: login } });

    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new HttpError(401, "Неверный логин или пароль", "invalid_credentials");
    }

    if (user.status !== "active") {
      throw new HttpError(403, "Пользователь заблокирован", "user_blocked", {
        blockReason: user.blockReason
      });
    }

    await writeAudit(user.id, "auth.login", "user", user.id);

    res.json({
      token: signToken(user.id, toUserRole(user.role)),
      user: await getUserPayload(user.id)
    });
  })
);

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: await getUserPayload(req.user!.id) });
  })
);

function signToken(userId: string, role: UserRole) {
  const options: SignOptions = { expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"] };
  return jwt.sign({ sub: userId, role }, env.jwtSecret, {
    ...options
  });
}

function toUserRole(role: string): UserRole {
  if (!isUserRole(role)) {
    throw new HttpError(500, "У пользователя некорректная роль", "invalid_role");
  }
  return role;
}

async function getUserPayload(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      city: true,
      clientProfile: true,
      performerProfile: true,
      consents: { orderBy: { acceptedAt: "desc" } }
    }
  });

  if (!user) {
    throw new HttpError(404, "Пользователь не найден", "user_not_found");
  }

  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

function normalizePhoneOrHttp(input: string) {
  try {
    return normalizeRussianPhone(input);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Укажите корректный номер телефона", "invalid_phone");
  }
}

function getRequestIp(req: Request) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0]?.trim() ?? null;
  }
  return req.socket?.remoteAddress ?? null;
}

function getRequestUserAgent(req: Request) {
  const userAgent = req.headers["user-agent"];
  return Array.isArray(userAgent) ? userAgent[0] ?? null : userAgent ?? null;
}
