import type { User, UserRole } from "../types";

export function effectiveRoleForUser(user: User | null | undefined): UserRole | undefined {
  return user?.effectiveRole ?? user?.role;
}
