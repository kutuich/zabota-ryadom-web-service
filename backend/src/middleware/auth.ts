import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { isUserRole, type UserRole } from "../types/domain";
import { HttpError } from "../utils/http";

type JwtPayload = {
  sub: string;
  role: UserRole;
};

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!token) {
    return next(new HttpError(401, "Нужна авторизация", "auth_required"));
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, cityId: true, status: true }
    });

    if (!user || user.status !== "active" || !isUserRole(user.role)) {
      return next(new HttpError(401, "Пользователь не найден или заблокирован", "auth_invalid"));
    }

    req.user = { id: user.id, role: user.role, cityId: user.cityId };
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
  if (!req.user || !["admin", "superadmin"].includes(req.user.role)) {
    return next(new HttpError(403, "Недостаточно прав администратора", "admin_required"));
  }

  return next();
}
