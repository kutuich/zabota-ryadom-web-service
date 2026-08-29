import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import { test } from "vitest";
import { prisma } from "../db/prisma";
import { createNestApplication } from "../nest/bootstrap";

test("password login, refresh rotation, CSRF origin check and logout use revocable server sessions", async () => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "client@zabota.local" } });
  await prisma.authSession.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: "test_setup" }
  });

  const app = await createNestApplication({ startScheduler: false, exposeOpenApi: false });
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneOrEmail: "client@zabota.local", password: "password123" })
    });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json() as { token: string };
    const claims = jwt.decode(login.token) as { iat: number; exp: number };
    assert.ok(claims.exp - claims.iat <= 10 * 60, "regular access tokens must be short-lived");
    const firstCookie = refreshCookie(loginResponse);
    assert.match(firstCookie, /^zabota_refresh=/);
    assert.match(loginResponse.headers.get("set-cookie") ?? "", /HttpOnly/i);
    assert.match(loginResponse.headers.get("set-cookie") ?? "", /SameSite=Strict/i);

    let response = await fetch(`${baseUrl}/api/auth/me`, { headers: bearer(login.token) });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { cookie: firstCookie, origin: "https://untrusted.example" }
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json() as { code: string }).code, "csrf_origin_invalid");

    const refreshResponse = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { cookie: firstCookie }
    });
    assert.equal(refreshResponse.status, 200);
    const refreshed = await refreshResponse.json() as { token: string; sessionId: string };
    const secondCookie = refreshCookie(refreshResponse);
    assert.notEqual(secondCookie, firstCookie);

    response = await fetch(`${baseUrl}/api/auth/me`, { headers: bearer(login.token) });
    assert.equal(response.status, 401, "access token from the rotated session must be rejected immediately");
    assert.equal((await response.json() as { code: string }).code, "session_revoked");

    response = await fetch(`${baseUrl}/api/auth/me`, { headers: bearer(refreshed.token) });
    assert.equal(response.status, 200);

    response = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: secondCookie }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { loggedOut: true });

    response = await fetch(`${baseUrl}/api/auth/me`, { headers: bearer(refreshed.token) });
    assert.equal(response.status, 401);
    assert.equal((await response.json() as { code: string }).code, "session_revoked");

    response = await fetch(`${baseUrl}/api/auth/refresh`, { method: "POST", headers: { cookie: secondCookie } });
    assert.equal(response.status, 401);
    assert.equal((await response.json() as { code: string }).code, "refresh_session_rotated");
  } finally {
    await app.close();
  }
});

test("password change revokes every prior access and refresh session and issues a replacement session", async () => {
  const original = await prisma.user.findUniqueOrThrow({ where: { email: "client@zabota.local" } });
  const app = await createNestApplication({ startScheduler: false, exposeOpenApi: false });
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const first = await login(baseUrl);
    const second = await login(baseUrl);
    const changedResponse = await fetch(`${baseUrl}/api/me/change-password`, {
      method: "POST",
      headers: {
        ...bearer(first.token),
        cookie: first.cookie,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        currentPassword: "password123",
        newPassword: "N3w!Stage4Secure",
        newPasswordConfirmation: "N3w!Stage4Secure"
      })
    });
    assert.equal(changedResponse.status, 200);
    const changed = await changedResponse.json() as { token: string };
    assert.ok(refreshCookie(changedResponse));

    let response = await fetch(`${baseUrl}/api/auth/me`, { headers: bearer(first.token) });
    assert.equal(response.status, 401);
    response = await fetch(`${baseUrl}/api/auth/me`, { headers: bearer(second.token) });
    assert.equal(response.status, 401);
    response = await fetch(`${baseUrl}/api/auth/refresh`, { method: "POST", headers: { cookie: second.cookie } });
    assert.equal(response.status, 401);
    response = await fetch(`${baseUrl}/api/auth/me`, { headers: bearer(changed.token) });
    assert.equal(response.status, 200);
  } finally {
    await prisma.authSession.updateMany({
      where: { userId: original.id, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "test_cleanup" }
    });
    await prisma.user.update({
      where: { id: original.id },
      data: {
        passwordHash: original.passwordHash,
        passwordChangedAt: original.passwordChangedAt,
        authTokenVersion: original.authTokenVersion
      }
    });
    await app.close();
  }
});

test("reuse of an old refresh credential revokes the rotated session family", async () => {
  const app = await createNestApplication({ startScheduler: false, exposeOpenApi: false });
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const first = await login(baseUrl);
    const refreshResponse = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { cookie: first.cookie }
    });
    assert.equal(refreshResponse.status, 200);
    const refreshed = await refreshResponse.json() as { token: string };
    const oldSessionId = first.cookie.slice("zabota_refresh=".length).split(".", 1)[0];
    const oldSession = await prisma.authSession.update({
      where: { id: oldSessionId },
      data: { rotatedAt: new Date(Date.now() - 11_000) }
    });

    const replayResponse = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { cookie: first.cookie }
    });
    assert.equal(replayResponse.status, 401);
    assert.equal((await replayResponse.json() as { code: string }).code, "refresh_session_rotated");
    assert.equal(await prisma.authSession.count({ where: { familyId: oldSession.familyId, revokedAt: null } }), 0);

    const response = await fetch(`${baseUrl}/api/auth/me`, { headers: bearer(refreshed.token) });
    assert.equal(response.status, 401);
    assert.ok(await prisma.auditLog.findFirst({
      where: { actorUserId: oldSession.userId, action: "AUTH_REFRESH_REPLAY_DETECTED", entityId: oldSession.id }
    }));
  } finally {
    await app.close();
  }
});

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function refreshCookie(response: Response) {
  const header = response.headers.get("set-cookie") ?? "";
  const match = header.match(/(?:^|,\s*)(zabota_refresh=[^;]+)/);
  assert.ok(match, "response must set the refresh-session cookie");
  return match[1];
}

async function login(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneOrEmail: "client@zabota.local", password: "password123" })
  });
  assert.equal(response.status, 200);
  return { ...(await response.json() as { token: string }), cookie: refreshCookie(response) };
}
