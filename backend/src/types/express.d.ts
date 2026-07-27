import type { UserRole } from "./domain";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: UserRole;
        realRole: UserRole;
        effectiveRole: UserRole;
        isActingAsRole: boolean;
        actingRole: "client" | "performer" | null;
        realAdminUserId: string | null;
        cityId: string | null;
      };
    }
  }
}

export {};
