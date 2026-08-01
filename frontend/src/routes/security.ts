export const TEMPORARY_PASSWORD_PATH = "/app/security/change-temporary-password";

export function temporaryPasswordRedirectPath(
  user: { mustChangePassword?: boolean } | null,
  pathname: string
) {
  return user?.mustChangePassword && pathname !== TEMPORARY_PASSWORD_PATH
    ? TEMPORARY_PASSWORD_PATH
    : null;
}
