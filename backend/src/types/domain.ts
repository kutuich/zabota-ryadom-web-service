export type UserRole = "client" | "performer" | "admin" | "superadmin" | "oauth_pending";

export const adminRoles: UserRole[] = ["admin", "superadmin"];

export function isUserRole(value: string): value is UserRole {
  return value === "client" || value === "performer" || value === "admin" || value === "superadmin" || value === "oauth_pending";
}
