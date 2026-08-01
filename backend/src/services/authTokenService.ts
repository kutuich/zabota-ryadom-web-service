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
};

export function signUserToken(userId: string, role: UserRole, tokenVersion = 0, actingRole?: ActingRole) {
  const options: SignOptions = { expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"] };
  const payload: AuthTokenPayload = actingRole
    ? { sub: userId, role, realRole: role, actingRole, isActingAsRole: true, tokenVersion }
    : { sub: userId, role, tokenVersion };
  return jwt.sign(payload, env.jwtSecret, options);
}
