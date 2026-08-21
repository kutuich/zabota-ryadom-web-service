import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { isUserRole } from "../types/domain";
import { HttpError } from "../utils/http";
import type { AuthTokenPayload } from "./authTokenService";
import { writeAudit } from "./auditService";

export type AuthenticationRequest = {
  authorization?: string;
  method: string;
  path: string;
};

export type AuthenticatedUser = NonNullable<Express.Request["user"]>;

export async function authenticateRequest(input: AuthenticationRequest): Promise<AuthenticatedUser> {
  const token = input.authorization?.startsWith("Bearer ")
    ? input.authorization.slice("Bearer ".length)
    : null;
  if (!token) throw new HttpError(401, "Нужна авторизация", "auth_required");

  try {
    const payload = jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
    if (!payload.sessionId) throw new HttpError(401, "Сессия недействительна", "auth_invalid");
    const now = new Date();
    const session = await prisma.authSession.findFirst({
      where: {
        id: payload.sessionId,
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: now },
        idleExpiresAt: { gt: now }
      },
      select: { id: true, actingRole: true }
    });
    if (!session) throw new HttpError(401, "Сессия была завершена. Войдите снова", "session_revoked");
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, cityId: true, status: true, authTokenVersion: true, mustChangePassword: true }
    });
    if (!user || user.status !== "active" || !isUserRole(user.role)) {
      throw new HttpError(401, "Пользователь не найден или заблокирован", "auth_invalid");
    }
    if (user.role === "admin") {
      throw new HttpError(403, "Роль admin выведена из бизнес-модели. Обратитесь к Суперадминистратору", "admin_role_deprecated");
    }
    if ((payload.tokenVersion ?? 0) !== user.authTokenVersion) {
      throw new HttpError(401, "Сессия была завершена. Войдите снова", "session_revoked");
    }

    const realRole = user.role;
    const actingRole = payload.isActingAsRole ? payload.actingRole ?? null : null;
    const sessionActingRole = session.actingRole === "client" || session.actingRole === "performer" ? session.actingRole : null;
    if (actingRole !== sessionActingRole) {
      throw new HttpError(401, "Режим сессии изменён. Обновите авторизацию", "acting_session_invalid");
    }
    if (actingRole) {
      const validPayload = payload.realRole === realRole
        && payload.role === realRole
        && ["client", "performer"].includes(actingRole);
      if (realRole !== "superadmin" || !validPayload) {
        throw new HttpError(401, "Сессия режима администратора недействительна", "acting_session_invalid");
      }
    }

    const effectiveRole = actingRole ?? realRole;
    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      role: effectiveRole,
      realRole,
      effectiveRole,
      isActingAsRole: Boolean(actingRole),
      actingRole,
      realAdminUserId: actingRole ? user.id : null,
      cityId: user.cityId,
      authTokenVersion: user.authTokenVersion,
      mustChangePassword: user.mustChangePassword,
      sessionId: session.id
    };
    if (user.mustChangePassword && !isTemporaryPasswordAllowedPath(input.path)) {
      throw new HttpError(403, "Необходимо создать новый пароль", "temporary_password_change_required");
    }
    if (actingRole && !["GET", "HEAD", "OPTIONS"].includes(input.method.toUpperCase())) {
      await writeAudit(user.id, "admin.acting.action", "http_request", null, {
        realUserId: user.id,
        effectiveUserId: user.id,
        realRole,
        effectiveRole,
        actingRole,
        actionSource: "admin_acting_mode",
        method: input.method,
        path: input.path
      });
    }
    return authenticatedUser;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, "Сессия недействительна", "auth_invalid");
  }
}

function isTemporaryPasswordAllowedPath(path: string) {
  const pathname = path.split("?", 1)[0];
  return pathname === "/api/auth/me" || pathname === "/api/auth/change-temporary-password";
}
