import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { authenticate } from "../middleware/auth";
import { writeAudit } from "../services/auditService";
import { acceptLatestLegalDocuments, missingAcceptedDocumentTypes } from "../services/legalService";
import { isPhoneLikeLogin, normalizeRussianPhone } from "../services/phoneService";
import { grantTrialBalanceToUser } from "../services/trialBalanceService";
import { signUserToken } from "../services/authTokenService";
import { linkUserCityTx, normalizeSettlementName, sanitizeSettlementText } from "../services/settlementService";
import { isUserRole, type UserRole } from "../types/domain";
import { asyncHandler, HttpError } from "../utils/http";
import {
  VK_OAUTH_SESSION_COOKIE,
  VK_OAUTH_TRANSACTION_COOKIE,
  assertVkIdConfigured,
  createVkOAuthSessionCookie,
  createVkOAuthTransaction,
  exchangeVkCode,
  fetchVkProfile,
  isUserProfileComplete,
  readVkOAuthSession,
  readVkOAuthTransaction,
  resolveVkUser,
  safeOAuthRedirectPath
} from "../services/vkIdService";

export const authRouter = Router();

const consentTypes = [
  "terms",
  "privacy",
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
  cityId: z.string().min(1).optional(),
  citySuggestion: z.object({ name: z.string().min(2).max(120), region: z.string().max(160).optional() }).optional(),
  acceptedConsentTypes: z.array(z.enum(consentTypes)).default([]),
  acceptedLegalDocumentTypes: z.array(z.string()).default([]),
  marketingNotificationsAccepted: z.boolean().default(false),
  dependentDataTransferConfirmed: z.boolean().default(false),
  helperNotEmployerAcknowledged: z.boolean().default(false),
  helperNoMedicalServicesConfirmed: z.boolean().default(false)
}).refine((value) => Boolean(value.cityId || value.citySuggestion), { message: "Выберите или предложите населённый пункт", path: ["cityId"] });

const loginSchema = z.object({
  phoneOrEmail: z.string().min(3),
  password: z.string().min(1)
});

const completeOAuthProfileSchema = z.object({
  role: z.enum(["client", "performer"]),
  cityId: z.string().min(1),
  phone: z.string().min(7),
  acceptedDocuments: z.array(z.string()).optional(),
  acceptedLegalDocumentTypes: z.array(z.string()).optional(),
  marketingNotificationsAccepted: z.boolean().default(false),
  dependentDataTransferConfirmed: z.boolean().default(false),
  helperNotEmployerAcknowledged: z.boolean().default(false),
  helperNoMedicalServicesConfirmed: z.boolean().default(false)
});

authRouter.get(
  "/oauth/vk/start",
  asyncHandler(async (_req, res) => {
    assertVkIdConfigured();
    const transaction = createVkOAuthTransaction();
    setOAuthCookie(res, VK_OAUTH_TRANSACTION_COOKIE, transaction.cookieValue, 10 * 60);
    res.redirect(302, transaction.authorizationUrl);
  })
);

authRouter.post(
  "/oauth/vk/start",
  authenticate,
  asyncHandler(async (req, res) => {
    assertVkIdConfigured();
    if (req.user!.role === "admin" || req.user!.role === "superadmin") {
      throw new HttpError(403, "VK ID нельзя привязать к профилю администратора", "vk_admin_link_forbidden");
    }
    const transaction = createVkOAuthTransaction(req.user!.id);
    setOAuthCookie(res, VK_OAUTH_TRANSACTION_COOKIE, transaction.cookieValue, 10 * 60);
    res.json({ authorizationUrl: transaction.authorizationUrl });
  })
);

authRouter.get("/oauth/vk/callback", async (req, res) => {
  const failRedirect = oauthFailureRedirect();
  try {
    assertVkIdConfigured();
    const transaction = readVkOAuthTransaction(readCookie(req, VK_OAUTH_TRANSACTION_COOKIE));
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!transaction || !state || transaction.state !== state) {
      throw new HttpError(400, "Проверка безопасности VK ID не пройдена", "vk_state_mismatch");
    }
    if (typeof req.query.error === "string") {
      return res.redirect(302, `${failRedirect}&oauthReason=cancelled`);
    }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const deviceId = typeof req.query.device_id === "string" ? req.query.device_id : "";
    if (!code || !deviceId) {
      throw new HttpError(400, "VK ID не передал данные для завершения входа", "vk_callback_invalid");
    }

    clearOAuthCookie(res, VK_OAUTH_TRANSACTION_COOKIE);
    const tokenPayload = await exchangeVkCode({ code, deviceId, state, codeVerifier: transaction.codeVerifier });
    const profile = await fetchVkProfile(tokenPayload.access_token);
    const providerUserId = String(profile.user_id ?? tokenPayload.user_id ?? "");
    if (!providerUserId) {
      throw new HttpError(502, "VK ID не вернул идентификатор пользователя", "vk_profile_invalid");
    }
    const { user } = await resolveVkUser({ providerUserId, profile, linkUserId: transaction.linkUserId });
    const vkAction = transaction.linkUserId
      ? "auth.vk.link"
      : user.role === "manager"
        ? "manager.vk_login"
        : "auth.vk.login";
    await writeAudit(user.id, vkAction, "user_identity", providerUserId, {
      actorUserId: user.id,
      actorRole: user.role,
      source: user.role === "manager" ? "manager_login" : "oauth"
    });
    setOAuthCookie(res, VK_OAUTH_SESSION_COOKIE, createVkOAuthSessionCookie(user.id), 2 * 60);
    return res.redirect(302, safeOAuthRedirectPath(env.vkIdSuccessRedirectPath, "/app/oauth/complete"));
  } catch (error) {
    clearOAuthCookie(res, VK_OAUTH_TRANSACTION_COOKIE);
    const reason = error instanceof HttpError && error.code === "vk_identity_already_linked" ? "already-linked" : "failed";
    return res.redirect(302, `${failRedirect}&oauthReason=${reason}`);
  }
});

authRouter.post(
  "/oauth/session",
  asyncHandler(async (req, res) => {
    const session = readVkOAuthSession(readCookie(req, VK_OAUTH_SESSION_COOKIE));
    if (!session) throw new HttpError(401, "Сессия VK ID истекла. Войдите ещё раз", "vk_session_invalid");
    clearOAuthCookie(res, VK_OAUTH_SESSION_COOKIE);
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || !isUserRole(user.role) || user.role === "admin" || user.role === "superadmin") {
      throw new HttpError(401, "Профиль VK ID не найден", "vk_session_invalid");
    }
    const profileComplete = await isUserProfileComplete(user.id);
    res.json({
      token: signUserToken(user.id, toUserRole(user.role)),
      user: await getUserPayload(user.id),
      profileComplete,
      nextPath: profileComplete ? oauthNextPath(user.role) : "/app/oauth/complete"
    });
  })
);

authRouter.post(
  "/oauth/complete-profile",
  authenticate,
  asyncHandler(async (req, res) => {
    const input = completeOAuthProfileSchema.parse(req.body);
    const userId = req.user!.id;
    const identity = await prisma.userIdentity.findFirst({ where: { userId, provider: "vk" } });
    if (!identity) throw new HttpError(403, "Профиль не связан с VK ID", "vk_identity_required");
    if (["admin", "superadmin", "manager"].includes(req.user!.role)) {
      throw new HttpError(403, "Роль нельзя изменить через завершение регистрации VK ID", "vk_role_selection_forbidden");
    }

    const acceptedLegalDocumentTypes = Array.from(new Set([
      ...(input.acceptedDocuments ?? input.acceptedLegalDocumentTypes ?? []),
      ...(input.marketingNotificationsAccepted ? ["marketing_notifications_consent"] : [])
    ]));
    const missing = missingAcceptedDocumentTypes(input.role, acceptedLegalDocumentTypes);
    if (missing.length) {
      throw new HttpError(400, "Нужно принять обязательные юридические документы", "MISSING_REQUIRED_CONSENT", { missing });
    }
    validateRoleConfirmations(input);

    const normalizedPhone = normalizePhoneOrHttp(input.phone);
    const [city, phoneOwner] = await Promise.all([
      prisma.city.findFirst({ where: { id: input.cityId, isActive: true, directoryStatus: { notIn: ["hidden", "duplicate"] } } }),
      prisma.user.findFirst({ where: { OR: [{ normalizedPhone }, { phone: normalizedPhone }], NOT: { id: userId } } })
    ]);
    if (!city) throw new HttpError(400, "Город не найден или отключён", "city_invalid");
    if (phoneOwner) throw new HttpError(409, "Пользователь с таким телефоном уже зарегистрирован", "phone_exists");

    const ipAddress = getRequestIp(req);
    const userAgent = getRequestUserAgent(req);
    await prisma.$transaction(async (tx) => {
      const current = await tx.user.update({
        where: { id: userId },
        data: { role: input.role, rolesJson: JSON.stringify([input.role]), cityId: city.id, phone: normalizedPhone, normalizedPhone }
      });
      await linkUserCityTx(tx, {
        userId,
        cityId: city.id,
        roleScope: input.role === "performer" ? "helper" : "customer",
        isPrimary: true
      });
      if (input.role === "client") {
        await tx.clientProfile.upsert({
          where: { userId },
          create: { userId, fullName: current.displayName, preferredContactMethod: "chat" },
          update: { fullName: current.displayName }
        });
      } else {
        await tx.performerProfile.upsert({
          where: { userId },
          create: { userId, verificationStatuses: JSON.stringify(["documents_optional"]) },
          update: {}
        });
      }
      for (const type of ["terms", "privacy", "personal_data_processing", "chat_rules"]) {
        await tx.consent.upsert({
          where: { userId_type_version: { userId, type, version: "2026-07-16-draft" } },
          create: { userId, type, version: "2026-07-16-draft", ip: ipAddress, userAgent },
          update: { ip: ipAddress, userAgent }
        });
      }
      await acceptLatestLegalDocuments({
        userId,
        documentTypes: acceptedLegalDocumentTypes,
        source: "oauth_registration",
        ipAddress,
        userAgent,
        client: tx
      });
      await writeAudit(userId, "auth.vk.complete_profile", "user", userId, { role: input.role, cityId: city.id }, tx);
    });

    await grantTrialBalanceToUser(userId, "oauth_complete");

    res.json({ user: await getUserPayload(userId), nextPath: oauthNextPath(input.role), profileComplete: true });
  })
);

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
      throw new HttpError(400, "Подтвердите, что оказываете только бытовую помощь без медицинских процедур", "helper_no_medical_confirmation_required");
    }

    let city = input.cityId
      ? await prisma.city.findFirst({ where: { id: input.cityId, isActive: true, directoryStatus: { notIn: ["hidden", "duplicate"] } } })
      : null;
    if (!city && input.citySuggestion) {
      const name = sanitizeSettlementText(input.citySuggestion.name, 120);
      const normalizedName = normalizeSettlementName(name);
      city = await prisma.city.findFirst({ where: { normalizedName } });
      if (!city) {
        city = await prisma.city.create({
          data: {
            name,
            normalizedName,
            slug: `${normalizedName.replace(/[^a-zа-я0-9]+/gi, "-")}-${Date.now().toString(36)}`,
            type: "other",
            region: input.citySuggestion.region?.trim() || "Регион не указан",
            source: "user_suggested",
            directoryStatus: "needs_review",
            serviceStatus: "inactive",
            status: "inactive",
            isActive: true,
            mapCenterLat: 0,
            mapCenterLng: 0,
            pricingZone: "future_settlement"
          }
        });
      }
    }
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
          cityId: city.id,
          status: "active"
        }
      });
      await linkUserCityTx(tx, {
        userId: created.id,
        cityId: city.id,
        roleScope: input.role === "performer" ? "helper" : "customer",
        isPrimary: true
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
        : ["terms", "privacy", "personal_data_processing", "chat_rules"];

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

    await grantTrialBalanceToUser(user.id, "registration");

    res.status(201).json({
      token: signUserToken(user.id, input.role),
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

    if (!user || !user.passwordHash || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new HttpError(401, "Неверный логин или пароль", "invalid_credentials");
    }

    if (user.status !== "active") {
      const archived = user.status === "archived";
      throw new HttpError(403, archived ? "Профиль архивирован" : "Пользователь заблокирован", archived ? "user_archived" : "user_blocked", {
        blockReason: user.blockReason
      });
    }

    await writeAudit(user.id, user.role === "manager" ? "manager.login" : "auth.login", "user", user.id, {
      actorUserId: user.id,
      actorRole: user.role,
      source: user.role === "manager" ? "manager_login" : "login"
    });

    res.json({
      token: signUserToken(user.id, toUserRole(user.role)),
      user: await getUserPayload(user.id)
    });
  })
);

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: await getUserPayload(req.user!.id, req.user) });
  })
);

function toUserRole(role: string): UserRole {
  if (!isUserRole(role)) {
    throw new HttpError(500, "У пользователя некорректная роль", "invalid_role");
  }
  return role;
}

async function getUserPayload(userId: string, authState?: Express.Request["user"]) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      city: true,
      clientProfile: true,
      performerProfile: true,
      identities: {
        select: { id: true, provider: true, providerUserId: true, displayName: true, avatarUrl: true, createdAt: true }
      },
      userCities: { where: { isActive: true }, include: { city: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      consents: { orderBy: { acceptedAt: "desc" } }
    }
  });

  if (!user) {
    throw new HttpError(404, "Пользователь не найден", "user_not_found");
  }

  const { passwordHash: _passwordHash, ...safeUser } = user;
  const realRole = authState?.realRole ?? toUserRole(user.role);
  const effectiveRole = authState?.effectiveRole ?? realRole;
  return {
    ...safeUser,
    role: realRole,
    realRole,
    effectiveRole,
    isActingAsRole: authState?.isActingAsRole ?? false,
    actingRole: authState?.actingRole ?? null,
    realAdminUserId: authState?.realAdminUserId ?? null,
    displayActingBanner: authState?.isActingAsRole ?? false
  };
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

function validateRoleConfirmations(input: z.infer<typeof completeOAuthProfileSchema>) {
  if (input.role === "client" && !input.dependentDataTransferConfirmed) {
    throw new HttpError(400, "Подтвердите основание для передачи данных человека, которому нужна помощь", "dependent_data_confirmation_required");
  }
  if (input.role === "performer" && !input.helperNotEmployerAcknowledged) {
    throw new HttpError(400, "Подтвердите, что сервис не является работодателем и не гарантирует заявки", "helper_not_employer_confirmation_required");
  }
  if (input.role === "performer" && !input.helperNoMedicalServicesConfirmed) {
    throw new HttpError(400, "Подтвердите, что оказываете только бытовую помощь без медицинских процедур", "helper_no_medical_confirmation_required");
  }
}

function oauthNextPath(role: string) {
  if (role === "client") return "/app/client/requests";
  if (role === "performer") return "/app/performer/profile";
  if (role === "manager") return "/app/manager";
  return "/app/oauth/complete";
}

function oauthFailureRedirect() {
  const path = safeOAuthRedirectPath(env.vkIdFailRedirectPath, "/app/login?oauthError=vk");
  return path.includes("?") ? path : `${path}?oauthError=vk`;
}

function setOAuthCookie(res: Response, name: string, value: string, maxAgeSeconds: number) {
  const secure = env.nodeEnv === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/api/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`);
}

function clearOAuthCookie(res: Response, name: string) {
  const secure = env.nodeEnv === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${name}=; Path=/api/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function readCookie(req: Request, name: string) {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) return decodeURIComponent(valueParts.join("="));
  }
  return undefined;
}
