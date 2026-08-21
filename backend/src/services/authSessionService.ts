import crypto from "node:crypto";
import type { Prisma, User } from "@prisma/client";
import type { Request, Response } from "express";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { isUserRole, type UserRole } from "../types/domain";
import { HttpError } from "../utils/http";
import { signUserToken, type ActingRole } from "./authTokenService";
import { writeAudit } from "./auditService";

const ROTATION_RETRY_GRACE_MS = 10_000;
const DEV_COOKIE_NAME = "zabota_refresh";
const PRODUCTION_COOKIE_NAME = "__Host-zabota_refresh";

type SessionUser = Pick<User, "id" | "role" | "status" | "authTokenVersion">;

export async function createAuthSession(user: SessionUser, req: Request, res: Response, actingRole?: ActingRole | null) {
  if (!isUserRole(user.role) || user.role === "admin" || user.status !== "active") {
    throw new HttpError(401, "Пользователь не найден или заблокирован", "auth_invalid");
  }
  const now = new Date();
  const secret = randomSecret();
  const expiresAt = resolveAbsoluteSessionExpiry(user.role, now);
  const session = await prisma.authSession.create({
    data: {
      familyId: crypto.randomUUID(),
      userId: user.id,
      tokenHash: hashSecret(secret),
      actingRole: actingRole ?? null,
      expiresAt,
      idleExpiresAt: resolveIdleSessionExpiry(user.role, now, expiresAt),
      ipAddress: requestIp(req),
      userAgent: requestUserAgent(req)
    }
  });
  setRefreshCookie(res, session.id, secret, expiresAt);
  return {
    token: signUserToken(user.id, user.role as UserRole, user.authTokenVersion, session.id, actingRole ?? undefined),
    sessionId: session.id
  };
}

export async function refreshAuthSession(req: Request, res: Response) {
  assertTrustedOrigin(req);
  const credential = readRefreshCredential(req);
  if (!credential) throw new HttpError(401, "Сессия недействительна", "refresh_session_invalid");
  const current = await prisma.authSession.findUnique({ where: { id: credential.sessionId }, include: { user: true } });
  if (!current || !secretMatches(current.tokenHash, credential.secret)) {
    clearRefreshCookie(res);
    throw new HttpError(401, "Сессия недействительна", "refresh_session_invalid");
  }
  const now = new Date();
  if (current.revokedAt) {
    if (current.revokeReason === "rotated" && current.rotatedAt && now.getTime() - current.rotatedAt.getTime() > ROTATION_RETRY_GRACE_MS) {
      await prisma.authSession.updateMany({
        where: { familyId: current.familyId, revokedAt: null },
        data: { revokedAt: now, revokeReason: "refresh_replay_detected" }
      });
      await writeAudit(current.userId, "AUTH_REFRESH_REPLAY_DETECTED", "auth_session", current.id, { familyId: current.familyId });
    }
    throw new HttpError(401, "Сессия уже обновлена или завершена", "refresh_session_rotated");
  }
  if (current.expiresAt <= now || current.idleExpiresAt <= now) {
    await prisma.authSession.update({ where: { id: current.id }, data: { revokedAt: now, revokeReason: "expired" } });
    clearRefreshCookie(res);
    throw new HttpError(401, "Срок сессии истёк", "refresh_session_expired");
  }
  const user = current.user;
  if (!isUserRole(user.role) || user.role === "admin" || user.status !== "active") {
    await prisma.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now, revokeReason: "user_inactive" } });
    clearRefreshCookie(res);
    throw new HttpError(401, "Пользователь не найден или заблокирован", "auth_invalid");
  }

  const nextSecret = randomSecret();
  const nextId = crypto.randomUUID();
  const nextIdleExpiry = resolveIdleSessionExpiry(user.role, now, current.expiresAt);
  const rotated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.authSession.updateMany({
      where: { id: current.id, revokedAt: null, tokenHash: current.tokenHash },
      data: { revokedAt: now, rotatedAt: now, revokeReason: "rotated", replacedBySessionId: nextId }
    });
    if (claimed.count !== 1) return null;
    return tx.authSession.create({
      data: {
        id: nextId,
        familyId: current.familyId,
        userId: user.id,
        tokenHash: hashSecret(nextSecret),
        actingRole: current.actingRole,
        expiresAt: current.expiresAt,
        idleExpiresAt: nextIdleExpiry,
        lastUsedAt: now,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req)
      }
    });
  });
  if (!rotated) throw new HttpError(401, "Сессия уже обновлена", "refresh_session_rotated");

  const actingRole = rotated.actingRole === "client" || rotated.actingRole === "performer" ? rotated.actingRole : undefined;
  setRefreshCookie(res, rotated.id, nextSecret, rotated.expiresAt);
  return {
    token: signUserToken(user.id, user.role as UserRole, user.authTokenVersion, rotated.id, actingRole),
    sessionId: rotated.id
  };
}

export async function logoutAuthSession(req: Request, res: Response) {
  assertTrustedOrigin(req);
  const credential = readRefreshCredential(req);
  clearRefreshCookie(res);
  if (!credential) return { loggedOut: true };
  const session = await prisma.authSession.findUnique({ where: { id: credential.sessionId } });
  if (!session || !secretMatches(session.tokenHash, credential.secret)) return { loggedOut: true };
  const now = new Date();
  await prisma.authSession.updateMany({
    where: { id: session.id, revokedAt: null },
    data: { revokedAt: now, revokeReason: "logout" }
  });
  await writeAudit(session.userId, "AUTH_SESSION_LOGOUT", "auth_session", session.id, { result: "success" });
  return { loggedOut: true };
}

export async function setSessionActingRole(sessionId: string, userId: string, actingRole: ActingRole | null) {
  const updated = await prisma.authSession.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { actingRole }
  });
  if (updated.count !== 1) throw new HttpError(401, "Сессия была завершена", "session_revoked");
}

export async function revokeUserSessions(
  tx: Prisma.TransactionClient,
  userId: string,
  reason: string,
  exceptSessionId?: string
) {
  await tx.authSession.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date(), revokeReason: reason }
  });
}

export function clearAuthCookies(res: Response) {
  clearRefreshCookie(res);
}

function setRefreshCookie(res: Response, sessionId: string, secret: string, expiresAt: Date) {
  res.cookie(resolveRefreshCookieName(env.nodeEnv), `${sessionId}.${secret}`, refreshCookieOptions(env.nodeEnv, expiresAt));
}

function clearRefreshCookie(res: Response) {
  for (const name of [DEV_COOKIE_NAME, PRODUCTION_COOKIE_NAME]) {
    res.clearCookie(name, { httpOnly: true, secure: name === PRODUCTION_COOKIE_NAME, sameSite: "strict", path: "/" });
  }
}

function readRefreshCredential(req: Request) {
  const value = readCookie(req, DEV_COOKIE_NAME) ?? readCookie(req, PRODUCTION_COOKIE_NAME);
  if (!value) return null;
  const separator = value.indexOf(".");
  if (separator <= 0) return null;
  return { sessionId: value.slice(0, separator), secret: value.slice(separator + 1) };
}

function readCookie(req: Request, name: string) {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const pair of raw.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === name) return decodeURIComponent(pair.slice(separator + 1).trim());
  }
  return undefined;
}

export function resolveRefreshCookieName(nodeEnv: string) {
  return nodeEnv === "production" ? PRODUCTION_COOKIE_NAME : DEV_COOKIE_NAME;
}

export function refreshCookieOptions(nodeEnv: string, expires: Date) {
  return {
    httpOnly: true,
    secure: nodeEnv === "production",
    sameSite: "strict" as const,
    path: "/",
    expires
  };
}

export function resolveAbsoluteSessionExpiry(role: string, now: Date) {
  const ms = role === "superadmin" || role === "manager"
    ? env.adminRefreshSessionHours * 60 * 60 * 1000
    : env.refreshSessionDays * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() + ms);
}

export function resolveIdleSessionExpiry(role: string, now: Date, absolute: Date) {
  const ms = role === "superadmin" || role === "manager"
    ? env.adminRefreshIdleMinutes * 60 * 1000
    : env.refreshIdleDays * 24 * 60 * 60 * 1000;
  return new Date(Math.min(now.getTime() + ms, absolute.getTime()));
}

function randomSecret() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashSecret(secret: string) {
  return crypto.createHash("sha256").update(secret).digest("base64url");
}

function secretMatches(expectedHash: string, secret: string) {
  const actual = Buffer.from(hashSecret(secret));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function requestIp(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  return typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() ?? null : req.socket?.remoteAddress ?? null;
}

function requestUserAgent(req: Request) {
  return typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 500) : null;
}

function assertTrustedOrigin(req: Request) {
  const origin = req.headers.origin;
  if (origin && origin !== env.corsOrigin) throw new HttpError(403, "Недоверенный источник запроса", "csrf_origin_invalid");
}
