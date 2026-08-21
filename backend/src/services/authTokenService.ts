import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import type { UserRole } from "../types/domain";

export type ActingRole = "client" | "performer";

export type AuthTokenPayload = {
  sub: string;
  role: UserRole;
  realRole?: UserRole;
  actingRole?: ActingRole;
  isActingAsRole?: boolean;
  tokenVersion: number;
  sessionId: string;
};

export function signUserToken(userId: string, role: UserRole, tokenVersion: number, sessionId: string, actingRole?: ActingRole) {
  const adminSession = role === "superadmin" || role === "manager";
  const expiresIn = `${adminSession ? env.adminAccessTokenTtlMinutes : env.accessTokenTtlMinutes}m`;
  const options: SignOptions = { expiresIn: expiresIn as SignOptions["expiresIn"], jwtid: sessionId };
  const payload: AuthTokenPayload = actingRole
    ? { sub: userId, role, realRole: role, actingRole, isActingAsRole: true, tokenVersion, sessionId }
    : { sub: userId, role, tokenVersion, sessionId };
  return jwt.sign(payload, env.jwtSecret, options);
}
