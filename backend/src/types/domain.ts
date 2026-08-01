export type UserRole = "client" | "performer" | "manager" | "admin" | "superadmin" | "oauth_pending";

// `admin` remains parseable only for legacy data; it has no business permissions.
export const adminRoles: UserRole[] = ["superadmin"];

export function isUserRole(value: string): value is UserRole {
  return value === "client" || value === "performer" || value === "manager" || value === "admin" || value === "superadmin" || value === "oauth_pending";
}
