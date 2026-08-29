import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  mixin,
  SetMetadata,
  Type
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { UserRole } from "../../types/domain";
import { authenticateRequest } from "../../services/authenticationService";
import { canUseFeature, type ConsentFeature } from "../../services/legalService";
import { HttpError } from "../../utils/http";

export const REQUIRED_ROLES = "zabota.requiredRoles";
export const RequireRoles = (...roles: UserRole[]) => SetMetadata(REQUIRED_ROLES, roles);

@Injectable()
export class NestJwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    request.user = await authenticateRequest({
      authorization: request.headers.authorization,
      method: request.method,
      path: request.originalUrl
    });
    return true;
  }
}

@Injectable()
export class NestRolesGuard implements CanActivate {
  private readonly reflector = new Reflector();

  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(REQUIRED_ROLES, [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;
    const user = context.switchToHttp().getRequest<Request>().user;
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException({ error: "Недостаточно прав", code: "forbidden" });
    }
    return true;
  }
}

@Injectable()
export class NestAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const user = context.switchToHttp().getRequest<Request>().user;
    if (!user || user.realRole !== "superadmin") {
      throw new ForbiddenException({
        error: "Недостаточно прав администратора",
        code: user?.realRole === "manager" ? "manager_permission_denied" : "admin_required"
      });
    }
    return true;
  }
}

@Injectable()
export class NestAdminManagerGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const user = context.switchToHttp().getRequest<Request>().user;
    if (!user || !["manager", "superadmin"].includes(user.realRole)) {
      throw new HttpError(403, "Недостаточно прав", "admin_or_manager_required");
    }
    return true;
  }
}

export function NestFeatureConsentGuard(feature: ConsentFeature): Type<CanActivate> {
  @Injectable()
  class FeatureConsentGuard implements CanActivate {
    async canActivate(context: ExecutionContext) {
      const user = context.switchToHttp().getRequest<Request>().user;
      if (!user) throw new HttpError(401, "Нужна авторизация", "auth_required");
      const result = await canUseFeature(user, feature);
      if (!result.allowed) {
        throw new HttpError(
          403,
          "Для этого действия нужно принять обязательные юридические документы.",
          "MISSING_REQUIRED_CONSENT",
          { missing: result.missing, feature }
        );
      }
      return true;
    }
  }
  return mixin(FeatureConsentGuard);
}
