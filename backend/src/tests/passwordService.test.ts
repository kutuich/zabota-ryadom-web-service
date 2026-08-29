import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { test } from "vitest";
import { ARGON2ID_OPTIONS, hashPassword, isArgon2idHash, verifyPassword } from "../services/passwordService";
import { signUserToken } from "../services/authTokenService";
import {
  refreshCookieOptions,
  resolveAbsoluteSessionExpiry,
  resolveIdleSessionExpiry,
  resolveRefreshCookieName
} from "../services/authSessionService";

test("password credentials use only the centralized Argon2id contract", async () => {
  const hash = await hashPassword("Strong!Password2026");
  assert.equal(isArgon2idHash(hash), true);
  assert.match(hash, /^\$argon2id\$v=19\$/);
  assert.match(hash, new RegExp(`m=${ARGON2ID_OPTIONS.memoryCost},t=${ARGON2ID_OPTIONS.timeCost},p=${ARGON2ID_OPTIONS.parallelism}`));
  assert.equal(await verifyPassword(hash, "Strong!Password2026"), true);
  assert.equal(await verifyPassword(hash, "Wrong!Password2026"), false);
  assert.equal(await verifyPassword("$2b$10$legacy-bcrypt-is-not-an-active-path", "Strong!Password2026"), false);
});

test("administrative access tokens expire sooner than regular access tokens", () => {
  const regular = jwt.decode(signUserToken("regular", "client", 0, "regular-session")) as { exp: number; iat: number };
  const admin = jwt.decode(signUserToken("admin", "superadmin", 0, "admin-session")) as { exp: number; iat: number };
  assert.ok(regular.exp - regular.iat <= 10 * 60);
  assert.ok(admin.exp - admin.iat <= 5 * 60);
  assert.ok(admin.exp - admin.iat < regular.exp - regular.iat);
});

test("production refresh cookies use __Host, HttpOnly, Secure and SameSite=Strict", () => {
  const expires = new Date("2030-01-01T00:00:00.000Z");
  assert.equal(resolveRefreshCookieName("production"), "__Host-zabota_refresh");
  assert.deepEqual(refreshCookieOptions("production", expires), {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    expires
  });
});

test("administrative refresh sessions have stricter absolute and idle lifetimes", () => {
  const now = new Date("2030-01-01T00:00:00.000Z");
  const regularAbsolute = resolveAbsoluteSessionExpiry("client", now);
  const adminAbsolute = resolveAbsoluteSessionExpiry("superadmin", now);
  assert.ok(adminAbsolute < regularAbsolute);
  assert.equal(adminAbsolute.getTime() - now.getTime(), 8 * 60 * 60 * 1000);
  assert.equal(resolveIdleSessionExpiry("superadmin", now, adminAbsolute).getTime() - now.getTime(), 30 * 60 * 1000);
});
