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
      select: { id: true, role: true, cityId: true, status: true }
    });

    if (!user || user.status !== "active" || !isUserRole(user.role)) {
      return next(new HttpError(401, "Пользователь не найден или заблокирован", "auth_invalid"));
    }

    const realRole = user.role;
    const actingRole = payload.isActingAsRole ? payload.actingRole ?? null : null;
    if (actingRole) {
      const validAdmin = ["admin", "superadmin"].includes(realRole);
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
      cityId: user.cityId
    };
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
  } catch {
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
  if (!req.user || !["admin", "superadmin"].includes(req.user.realRole)) {
    return next(new HttpError(403, "Недостаточно прав администратора", "admin_required"));
  }

  return next();
}
