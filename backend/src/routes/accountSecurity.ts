import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { authenticate } from "../middleware/auth";
import { signUserToken } from "../services/authTokenService";
import { assertPasswordPolicy, checkRateLimit, createSecurityNotice, normalizeDisplayName } from "../services/accountSecurityService";
import { writeAudit } from "../services/auditService";
import { asyncHandler, HttpError } from "../utils/http";

export const accountSecurityRouter = Router();
export const temporaryPasswordRouter = Router();

accountSecurityRouter.use(authenticate);

accountSecurityRouter.get("/profile", asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, displayName: true, phone: true, email: true, role: true, status: true, createdAt: true, city: true, passwordChangedAt: true, passwordResetAt: true, lastLoginAt: true, mustChangePassword: true }
  });
  if (!user) throw new HttpError(404, "Пользователь не найден", "user_not_found");
  res.json(user);
}));

accountSecurityRouter.patch("/profile", asyncHandler(async (req, res) => {
  const input = z.object({ displayName: z.string() }).strict().parse(req.body);
  checkRateLimit(`display-name:${req.user!.id}`, "account");
  const displayName = normalizeDisplayName(input.displayName);
  const user = await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    const updated = await tx.user.update({ where: { id: current.id }, data: { displayName, displayNameChangedAt: new Date() } });
    await writeAudit(current.id, "USER_DISPLAY_NAME_CHANGED", "user", current.id, {
      oldDisplayName: current.displayName,
      newDisplayName: displayName,
      ipAddress: requestIp(req),
      userAgent: req.headers["user-agent"] ?? null
    }, tx);
    return updated;
  });
  res.json({ id: user.id, displayName: user.displayName, updatedAt: user.updatedAt });
}));

accountSecurityRouter.post("/change-password", asyncHandler(async (req, res) => {
  const input = z.object({ currentPassword: z.string().min(1), newPassword: z.string(), newPasswordConfirmation: z.string() }).parse(req.body);
  if (req.user!.mustChangePassword) throw new HttpError(409, "Используйте форму смены временного пароля", "temporary_password_change_required");
  checkRateLimit(`password:${req.user!.id}`, "account");
  if (input.newPassword !== input.newPasswordConfirmation) throw new HttpError(400, "Пароли не совпадают", "password_confirmation_mismatch");
  const current = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!current.passwordHash || !(await bcrypt.compare(input.currentPassword, current.passwordHash))) {
    throw new HttpError(401, "Текущий пароль указан неверно", "current_password_invalid");
  }
  assertPasswordPolicy(input.newPassword, current);
  if (await bcrypt.compare(input.newPassword, current.passwordHash)) throw new HttpError(400, "Новый пароль должен отличаться от текущего", "password_unchanged");
  const passwordHash = await bcrypt.hash(input.newPassword, 10);
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: current.id }, data: { passwordHash, passwordChangedAt: new Date(), authTokenVersion: { increment: 1 } } });
    await createSecurityNotice(tx, current.id, null, "Пароль изменён", "Пароль вашей учётной записи изменён. Если это сделали не вы, обратитесь в сервис.");
    await writeAudit(current.id, "USER_PASSWORD_CHANGED", "user", current.id, { revokedSessions: "all", ipAddress: requestIp(req), userAgent: req.headers["user-agent"] ?? null }, tx);
    return updated;
  });
  res.json({ token: signUserToken(user.id, user.role as any, user.authTokenVersion), passwordChangedAt: user.passwordChangedAt });
}));

accountSecurityRouter.post("/sessions/revoke-others", asyncHandler(async (req, res) => {
  checkRateLimit(`sessions:${req.user!.id}`, "account");
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: req.user!.id }, data: { authTokenVersion: { increment: 1 } } });
    await writeAudit(updated.id, "USER_SESSIONS_REVOKED", "user", updated.id, { scope: "others", ipAddress: requestIp(req), userAgent: req.headers["user-agent"] ?? null }, tx);
    return updated;
  });
  res.json({ token: signUserToken(user.id, user.role as any, user.authTokenVersion), revoked: true });
}));

temporaryPasswordRouter.post("/change-temporary-password", authenticate, asyncHandler(async (req, res) => {
  const input = z.object({ newPassword: z.string(), newPasswordConfirmation: z.string() }).strict().parse(req.body);
  if (input.newPassword !== input.newPasswordConfirmation) throw new HttpError(400, "Пароли не совпадают", "password_confirmation_mismatch");
  const current = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!current.mustChangePassword) throw new HttpError(409, "Обязательная смена пароля не требуется", "temporary_password_not_required");
  if (!current.temporaryPasswordExpiresAt || current.temporaryPasswordExpiresAt <= new Date()) throw new HttpError(401, "Срок временного пароля истёк. Обратитесь к Суперадминистратору", "temporary_password_expired");
  assertPasswordPolicy(input.newPassword, current);
  if (current.passwordHash && await bcrypt.compare(input.newPassword, current.passwordHash)) throw new HttpError(400, "Новый пароль должен отличаться от временного", "password_unchanged");
  const passwordHash = await bcrypt.hash(input.newPassword, 10);
  const user = await prisma.$transaction(async (tx) => {
    const changedAt = new Date();
    const claimed = await tx.user.updateMany({
      where: {
        id: current.id,
        mustChangePassword: true,
        authTokenVersion: current.authTokenVersion,
        temporaryPasswordExpiresAt: { gt: changedAt }
      },
      data: {
        passwordHash,
        mustChangePassword: false,
        temporaryPasswordExpiresAt: null,
        passwordChangedAt: changedAt,
        authTokenVersion: { increment: 1 }
      }
    });
    if (claimed.count !== 1) {
      const latest = await tx.user.findUnique({ where: { id: current.id }, select: { mustChangePassword: true, temporaryPasswordExpiresAt: true } });
      if (latest?.mustChangePassword && (!latest.temporaryPasswordExpiresAt || latest.temporaryPasswordExpiresAt <= changedAt)) {
        throw new HttpError(401, "Срок временного пароля истёк. Обратитесь к Суперадминистратору", "temporary_password_expired");
      }
      throw new HttpError(409, "Обязательная смена пароля уже завершена", "temporary_password_not_required");
    }
    const updated = await tx.user.findUniqueOrThrow({ where: { id: current.id } });
    await createSecurityNotice(tx, current.id, null, "Временный пароль заменён", "Пароль вашей учётной записи изменён. Если это сделали не вы, обратитесь в сервис.");
    await writeAudit(current.id, "USER_TEMPORARY_PASSWORD_CHANGED", "user", current.id, { ipAddress: requestIp(req), userAgent: req.headers["user-agent"] ?? null }, tx);
    return updated;
  });
  res.json({ token: signUserToken(user.id, user.role as any, user.authTokenVersion), mustChangePassword: false });
}));

function requestIp(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }) {
  const forwarded = req.headers["x-forwarded-for"];
  return typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : req.socket?.remoteAddress ?? null;
}
