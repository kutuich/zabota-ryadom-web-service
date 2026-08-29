import type { UserRole } from "./domain";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      user?: {
        id: string;
        role: UserRole;
        realRole: UserRole;
        effectiveRole: UserRole;
        isActingAsRole: boolean;
        actingRole: "client" | "performer" | null;
        realAdminUserId: string | null;
        cityId: string | null;
        authTokenVersion: number;
        mustChangePassword: boolean;
        sessionId: string;
      };
    }
  }
}

export {};
