import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { env } from "../config/env";
import { writeAudit } from "./auditService";
import { HttpError } from "../utils/http";
import { hashPassword, verifyPassword } from "./passwordService";
import { revokeUserSessions } from "./authSessionService";

const resetAttempts = new Map<string, number>();
const accountAttempts = new Map<string, number>();

export const passwordResetReasonCodes = [
  "user_forgot_password",
  "user_request",
  "suspected_compromise",
  "administrative_need",
  "other"
] as const;

export function assertPasswordPolicy(password: string, user?: { phone?: string | null; email?: string | null; displayName?: string | null }) {
  if (password.length < 12 || password.length > 128) {
    throw new HttpError(400, "Пароль должен содержать от 12 до 128 символов", "password_policy_failed");
  }
  if (!/[a-zа-яё]/u.test(password) || !/[A-ZА-ЯЁ]/u.test(password) || !/\d/u.test(password) || !/[^\p{L}\p{N}\s]/u.test(password)) {
    throw new HttpError(400, "Пароль должен содержать строчную и заглавную буквы, цифру и специальный символ", "password_policy_failed");
  }
  const normalizedPassword = password.toLocaleLowerCase("ru-RU");
  const identityValues = [user?.phone?.replace(/\D/g, ""), user?.email, user?.displayName]
    .map((value) => value?.trim().toLocaleLowerCase("ru-RU"))
    .filter((value): value is string => Boolean(value && value.length >= 3));
  if (identityValues.some((value) => normalizedPassword.includes(value))) {
    throw new HttpError(400, "Пароль не должен содержать телефон, email или никнейм", "password_contains_profile_data");
  }
}

export function normalizeDisplayName(value: string) {
  const displayName = value.trim().replace(/\s+/g, " ");
  if (displayName.length < 2 || displayName.length > 50) {
    throw new HttpError(400, "Никнейм должен содержать от 2 до 50 символов", "display_name_invalid");
  }
  if (/[<>\u0000-\u001f\u007f]/u.test(displayName) || /script/i.test(displayName)) {
    throw new HttpError(400, "Никнейм содержит недопустимые символы", "display_name_invalid");
  }
  if (!/^[\p{L}\p{N} ._-]+$/u.test(displayName)) {
    throw new HttpError(400, "Используйте буквы, цифры, пробел, дефис, точку или подчёркивание", "display_name_invalid");
  }
  return displayName;
}

export function checkRateLimit(key: string, scope: "reset" | "account", intervalMs = 60_000) {
  const store = scope === "reset" ? resetAttempts : accountAttempts;
  const previous = store.get(key) ?? 0;
  const now = Date.now();
  if (now - previous < intervalMs) {
    throw new HttpError(429, "Повторите операцию позже", "rate_limit_exceeded");
  }
  store.set(key, now);
}

export async function resetPasswordBySuperadmin(input: {
  actorId: string;
  actorRole: string;
  targetUserId: string;
  reasonCode: typeof passwordResetReasonCodes[number];
  reasonComment?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  if (input.actorRole !== "superadmin") throw new HttpError(403, "Доступно только Суперадминистратору", "superadmin_required");
  if (input.actorId === input.targetUserId) throw new HttpError(400, "Собственный пароль изменяется в профиле", "cannot_reset_own_password");
  if (input.reasonCode === "other" && !input.reasonComment?.trim()) {
    throw new HttpError(400, "Для причины «Другое» нужен комментарий", "password_reset_comment_required");
  }
  if (input.reasonCode === "suspected_compromise" && !input.reasonComment?.trim()) {
    throw new HttpError(400, "Опишите признаки возможной компрометации", "password_reset_comment_required");
  }
  checkRateLimit(input.targetUserId, "reset");
  const target = await prisma.user.findUnique({ where: { id: input.targetUserId } });
  if (!target) throw new HttpError(404, "Пользователь не найден", "user_not_found");
  if (!['manager', 'client', 'performer'].includes(target.role)) {
    throw new HttpError(409, "Для этой роли административный сброс недоступен", "password_reset_role_forbidden");
  }
  if (["archived", "oauth_pending"].includes(target.status) || !target.passwordHash) {
    throw new HttpError(409, "Для этой учётной записи сброс недоступен", "password_reset_status_forbidden");
  }

  const temporaryPassword = await generateTemporaryPassword(target);
  const passwordHash = await hashPassword(temporaryPassword);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.temporaryPasswordTtlHours * 60 * 60 * 1000);
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: target.id },
      data: {
        passwordHash,
        mustChangePassword: true,
        temporaryPasswordExpiresAt: expiresAt,
        passwordResetAt: now,
        passwordResetByUserId: input.actorId,
        authTokenVersion: { increment: 1 }
      }
    });
    await revokeUserSessions(tx, target.id, "password_reset_by_superadmin");
    await createSecurityNotice(tx, target.id, input.actorId,
      "Пароль учётной записи сброшен",
      "Пароль вашей учётной записи был сброшен Суперадминистратором. Для входа используйте временный пароль, переданный вам безопасным способом. После входа необходимо создать новый пароль. Если вы не обращались за сбросом, свяжитесь с сервисом."
    );
    await writeAudit(input.actorId, "USER_PASSWORD_RESET_BY_SUPERADMIN", "user", target.id, {
      actorId: input.actorId,
      actorRole: input.actorRole,
      targetUserId: target.id,
      reasonCode: input.reasonCode,
      reasonComment: input.reasonComment?.trim() || null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      revokedSessions: "all",
      result: "success"
    }, tx);
    return user;
  });
  return { temporaryPassword, temporaryPasswordExpiresAt: expiresAt, authTokenVersion: result.authTokenVersion };
}

export async function createSecurityNotice(
  tx: Prisma.TransactionClient,
  userId: string,
  senderUserId: string | null,
  title: string,
  body: string
) {
  const conversation = await tx.serviceConversation.upsert({
    where: { userId },
    create: { userId, lastMessageAt: new Date(), unreadForUserCount: 1 },
    update: { lastMessageAt: new Date(), unreadForUserCount: { increment: 1 }, status: "active" }
  });
  await tx.serviceMessage.create({
    data: { conversationId: conversation.id, userId, senderUserId, senderRole: senderUserId ? "superadmin" : "system", messageType: "system_notice", title, body }
  });
}

async function generateTemporaryPassword(user: { phone: string | null; email: string | null; displayName: string; passwordHash: string | null }) {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%&*+-=?";
  const alphabet = upper + lower + digits + special;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const required = [randomChar(upper), randomChar(lower), randomChar(digits), randomChar(special)];
    const generated = [...required, ...Array.from({ length: 14 }, () => randomChar(alphabet))]
      .sort(() => crypto.randomInt(3) - 1)
      .join("");
    try {
      assertPasswordPolicy(generated, user);
      if (!(await verifyPassword(user.passwordHash, generated))) return generated;
    } catch {
      // Generate a new value when profile data accidentally appears in the password.
    }
  }
  throw new HttpError(500, "Не удалось безопасно создать временный пароль", "temporary_password_generation_failed");
}

function randomChar(alphabet: string) {
  return alphabet[crypto.randomInt(alphabet.length)]!;
}
