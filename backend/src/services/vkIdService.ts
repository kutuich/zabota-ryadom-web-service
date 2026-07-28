import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { getConsentStatuses, requiredDocumentTypesForRegistration } from "./legalService";
import { normalizeRussianPhone } from "./phoneService";
import { HttpError } from "../utils/http";
import { restoreArchivedOAuthPendingUser } from "./userLifecycleService";

export const VK_OAUTH_TRANSACTION_COOKIE = "zabota_vk_oauth";
export const VK_OAUTH_SESSION_COOKIE = "zabota_vk_session";
export const VK_ID_PROVIDER = "vk";

const VK_AUTHORIZE_URL = "https://id.vk.ru/authorize";
const VK_TOKEN_URL = "https://id.vk.ru/oauth2/auth";
const VK_USER_INFO_URL = "https://id.vk.ru/oauth2/user_info";

type VkOAuthTransaction = {
  type: "vk_oauth";
  state: string;
  codeVerifier: string;
  linkUserId?: string;
};

type VkOAuthSession = {
  type: "vk_session";
  userId: string;
};

export type VkTokenResponse = {
  access_token: string;
  user_id: string | number;
  state?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

export type VkProfile = {
  user_id?: string | number;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  avatar?: string;
};

export function isVkIdConfigured() {
  return Boolean(
    env.oauthEnabled
    && env.vkIdEnabled
    && env.vkIdClientId
    && env.vkIdClientSecret
    && env.vkIdRedirectUri
  );
}

export function assertVkIdConfigured() {
  if (!isVkIdConfigured()) {
    throw new HttpError(503, "Вход через VK временно недоступен", "vk_id_disabled");
  }
}

export function createVkOAuthTransaction(linkUserId?: string) {
  const state = randomUrlSafe(32);
  const codeVerifier = randomUrlSafe(64);
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const payload: VkOAuthTransaction = { type: "vk_oauth", state, codeVerifier, linkUserId };
  const cookieValue = jwt.sign(payload, env.jwtSecret, { expiresIn: "10m" });

  const authorizationUrl = new URL(VK_AUTHORIZE_URL);
  authorizationUrl.searchParams.set("client_id", env.vkIdClientId);
  authorizationUrl.searchParams.set("app_id", env.vkIdClientId);
  authorizationUrl.searchParams.set("redirect_uri", env.vkIdRedirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "email phone");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "s256");

  return { state, codeVerifier, cookieValue, authorizationUrl: authorizationUrl.toString() };
}

export function readVkOAuthTransaction(cookieValue: string | undefined): VkOAuthTransaction | null {
  if (!cookieValue) return null;
  try {
    const payload = jwt.verify(cookieValue, env.jwtSecret) as Partial<VkOAuthTransaction>;
    if (payload.type !== "vk_oauth" || !payload.state || !payload.codeVerifier) return null;
    return payload as VkOAuthTransaction;
  } catch {
    return null;
  }
}

export function createVkOAuthSessionCookie(userId: string) {
  const payload: VkOAuthSession = { type: "vk_session", userId };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "2m" });
}

export function readVkOAuthSession(cookieValue: string | undefined): VkOAuthSession | null {
  if (!cookieValue) return null;
  try {
    const payload = jwt.verify(cookieValue, env.jwtSecret) as Partial<VkOAuthSession>;
    if (payload.type !== "vk_session" || !payload.userId) return null;
    return payload as VkOAuthSession;
  } catch {
    return null;
  }
}

export async function exchangeVkCode(input: {
  code: string;
  deviceId: string;
  state: string;
  codeVerifier: string;
}) {
  assertVkIdConfigured();
  const url = new URL(VK_TOKEN_URL);
  url.searchParams.set("grant_type", "authorization_code");
  url.searchParams.set("redirect_uri", env.vkIdRedirectUri);
  url.searchParams.set("client_id", env.vkIdClientId);
  url.searchParams.set("code_verifier", input.codeVerifier);
  url.searchParams.set("state", input.state);
  url.searchParams.set("device_id", input.deviceId);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: input.code, client_secret: env.vkIdClientSecret }),
    signal: AbortSignal.timeout(12_000)
  });
  const payload = await response.json().catch(() => null) as VkTokenResponse | null;
  if (!response.ok || !payload?.access_token || payload.error) {
    throw new HttpError(502, "Не удалось подтвердить вход через VK", "vk_token_exchange_failed");
  }
  if (payload.state && payload.state !== input.state) {
    throw new HttpError(400, "Проверка безопасности VK ID не пройдена", "vk_state_mismatch");
  }
  return payload;
}

export async function fetchVkProfile(accessToken: string): Promise<VkProfile> {
  const url = new URL(VK_USER_INFO_URL);
  url.searchParams.set("client_id", env.vkIdClientId);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: accessToken }),
    signal: AbortSignal.timeout(12_000)
  });
  const payload = await response.json().catch(() => null) as { user?: VkProfile; error?: string } | null;
  if (!response.ok || !payload?.user || payload.error) {
    throw new HttpError(502, "Не удалось получить профиль VK", "vk_profile_failed");
  }
  return payload.user;
}

export async function resolveVkUser(input: {
  providerUserId: string;
  profile: VkProfile;
  linkUserId?: string;
}) {
  const email = normalizeEmail(input.profile.email);
  const displayName = [input.profile.first_name, input.profile.last_name].filter(Boolean).join(" ").trim() || "Пользователь VK";
  const normalizedPhone = normalizeOptionalPhone(input.profile.phone);

  return prisma.$transaction(async (tx) => {
    const existingIdentity = await tx.userIdentity.findUnique({
      where: { provider_providerUserId: { provider: VK_ID_PROVIDER, providerUserId: input.providerUserId } },
      include: { user: true }
    });

    if (existingIdentity && input.linkUserId && existingIdentity.userId !== input.linkUserId) {
      throw new HttpError(409, "Этот VK ID уже привязан к другому профилю", "vk_identity_already_linked");
    }

    let user = existingIdentity?.user ?? null;
    if (!user && input.linkUserId) {
      user = await tx.user.findUnique({ where: { id: input.linkUserId } });
      if (!user) throw new HttpError(401, "Сессия пользователя не найдена", "auth_invalid");
      if (user.role === "admin" || user.role === "superadmin") {
        throw new HttpError(403, "VK ID нельзя привязать к профилю администратора", "vk_admin_link_forbidden");
      }
    }
    if (!user && email) {
      user = await tx.user.findUnique({ where: { email } });
      if (user && (user.role === "admin" || user.role === "superadmin")) {
        throw new HttpError(403, "VK ID нельзя привязать к профилю администратора", "vk_admin_link_forbidden");
      }
    }
    if (!user) {
      const phoneOwner = normalizedPhone
        ? await tx.user.findFirst({ where: { OR: [{ normalizedPhone }, { phone: normalizedPhone }] }, select: { id: true } })
        : null;
      const phoneForNewUser = phoneOwner ? null : normalizedPhone;
      user = await tx.user.create({
        data: {
          role: "oauth_pending",
          rolesJson: "[]",
          phone: phoneForNewUser,
          normalizedPhone: phoneForNewUser,
          email,
          passwordHash: null,
          displayName,
          avatarUrl: input.profile.avatar || null,
          status: "active"
        }
      });
    }

    if (user.role === "admin" || user.role === "superadmin") {
      throw new HttpError(403, "Вход администратора через VK ID недоступен", "vk_admin_login_forbidden");
    }
    if (existingIdentity && user.status === "archived" && user.role === "oauth_pending") {
      const restored = await restoreArchivedOAuthPendingUser({
        userId: user.id,
        actorUserId: user.id,
        source: "vk_callback",
        providerUserId: input.providerUserId
      }, tx);
      user = restored.user;
    } else if (user.status === "archived" && user.role === "oauth_pending") {
      throw new HttpError(
        400,
        "Регистрация через VK ранее была остановлена. Обратитесь в поддержку или войдите другим способом.",
        "oauth_pending_restore_not_allowed"
      );
    } else if (user.status !== "active") {
      throw new HttpError(403, "Профиль заблокирован или архивирован", "vk_user_access_denied");
    }

    const identity = await tx.userIdentity.upsert({
      where: { provider_providerUserId: { provider: VK_ID_PROVIDER, providerUserId: input.providerUserId } },
      create: {
        userId: user.id,
        provider: VK_ID_PROVIDER,
        providerUserId: input.providerUserId,
        email,
        displayName,
        avatarUrl: input.profile.avatar || null,
        rawProfileJson: JSON.stringify(sanitizeVkProfile(input.profile))
      },
      update: {
        email,
        displayName,
        avatarUrl: input.profile.avatar || null,
        rawProfileJson: JSON.stringify(sanitizeVkProfile(input.profile))
      }
    });

    return { user, identity };
  });
}

export async function isUserProfileComplete(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user?.role === "manager") return true;
  if (!user || (user.role !== "client" && user.role !== "performer")) return false;
  if (!user.normalizedPhone || !user.cityId) return false;
  const statuses = await getConsentStatuses(user.id, user.role);
  const accepted = new Set(statuses.filter((row) => row.status === "accepted").map((row) => row.document.type));
  return requiredDocumentTypesForRegistration(user.role).every((type) => accepted.has(type));
}

export function safeOAuthRedirectPath(pathValue: string, fallback: string) {
  return pathValue.startsWith("/app") && !pathValue.startsWith("//") ? pathValue : fallback;
}

function randomUrlSafe(bytes: number) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function normalizeEmail(value: string | undefined) {
  const email = value?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizeOptionalPhone(value: string | undefined) {
  if (!value) return null;
  try {
    return normalizeRussianPhone(value);
  } catch {
    return null;
  }
}

function sanitizeVkProfile(profile: VkProfile) {
  return {
    user_id: profile.user_id ? String(profile.user_id) : undefined,
    email: normalizeEmail(profile.email),
    phone: normalizeOptionalPhone(profile.phone),
    first_name: profile.first_name,
    last_name: profile.last_name,
    avatar: profile.avatar
  };
}
