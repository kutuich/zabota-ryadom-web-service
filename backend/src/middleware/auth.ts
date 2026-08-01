import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { isUserRole, type UserRole } from "../types/domain";
import { HttpError } from "../utils/http";
import type { AuthTokenPayload } from "../services/authTokenService";
import { writeAudit } from "../services/auditService";

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!token) {
    return next(new HttpError(401, "Нужна авторизация", "auth_required"));
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, cityId: true, status: true, authTokenVersion: true, mustChangePassword: true }
    });

    if (!user || user.status !== "active" || !isUserRole(user.role)) {
      return next(new HttpError(401, "Пользователь не найден или заблокирован", "auth_invalid"));
    }
    if (user.role === "admin") {
      return next(new HttpError(403, "Роль admin выведена из бизнес-модели. Обратитесь к Суперадминистратору", "admin_role_deprecated"));
    }
    if ((payload.tokenVersion ?? 0) !== user.authTokenVersion) {
      return next(new HttpError(401, "Сессия была завершена. Войдите снова", "session_revoked"));
    }

    const realRole = user.role;
    const actingRole = payload.isActingAsRole ? payload.actingRole ?? null : null;
    if (actingRole) {
      const validAdmin = realRole === "superadmin";
      const validPayload = payload.realRole === realRole && payload.role === realRole && ["client", "performer"].includes(actingRole);
      if (!validAdmin || !validPayload) {
        return next(new HttpError(401, "Сессия режима администратора недействительна", "acting_session_invalid"));
      }
    }
    const effectiveRole = actingRole ?? realRole;
    req.user = {
      id: user.id,
      role: effectiveRole,
      realRole,
      effectiveRole,
      isActingAsRole: Boolean(actingRole),
      actingRole,
      realAdminUserId: actingRole ? user.id : null,
      cityId: user.cityId,
      authTokenVersion: user.authTokenVersion,
      mustChangePassword: user.mustChangePassword
    };
    if (user.mustChangePassword && !isTemporaryPasswordAllowedPath(req.originalUrl)) {
      return next(new HttpError(403, "Необходимо создать новый пароль", "temporary_password_change_required"));
    }
    if (actingRole && !["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) {
      await writeAudit(user.id, "admin.acting.action", "http_request", null, {
        realUserId: user.id,
        effectiveUserId: user.id,
        realRole,
        effectiveRole,
        actingRole,
        actionSource: "admin_acting_mode",
        method: req.method,
        path: req.originalUrl
      });
    }
    return next();
  } catch (error) {
    if (error instanceof HttpError) return next(error);
    return next(new HttpError(401, "Сессия недействительна", "auth_invalid"));
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new HttpError(403, "Недостаточно прав", "forbidden"));
    }

    return next();
  };
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user || req.user.realRole !== "superadmin") {
    const code = req.user?.realRole === "manager" ? "manager_permission_denied" : "admin_required";
    return next(new HttpError(403, "Недостаточно прав администратора", code));
  }

  return next();
}

export const requireAdminOrSuperadmin = requireAdmin;
export const requireSystemAdminOnly = requireAdmin;
export const requireRoleManagementAccess = requireAdmin;

export function requireAdminManagerOrSuperadmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user || !["manager", "superadmin"].includes(req.user.realRole)) {
    return next(new HttpError(403, "Недостаточно прав", "admin_or_manager_required"));
  }
  return next();
}

export const requireUserBlockingAccess = requireAdminManagerOrSuperadmin;

function isTemporaryPasswordAllowedPath(path: string) {
  const pathname = path.split("?", 1)[0];
  return pathname === "/api/auth/me" || pathname === "/api/auth/change-temporary-password";
}
