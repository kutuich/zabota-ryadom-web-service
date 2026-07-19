import type { UserRole } from "./domain";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: UserRole;
        cityId: string | null;
      };
    }
  }
}

export {};
