export type UserRole = "client" | "performer" | "admin" | "superadmin";

export const adminRoles: UserRole[] = ["admin", "superadmin"];

export function isUserRole(value: string): value is UserRole {
  return value === "client" || value === "performer" || value === "admin" || value === "superadmin";
}
