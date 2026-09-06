import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { test } from "vitest";
import { prisma } from "../db/prisma";
import { createNestApplication } from "../nest/bootstrap";
import { runResetSuperadminPasswordCli } from "../scripts/resetSuperadminPassword";
import {
  EmergencySuperadminResetError,
  resetEmergencySuperadminPassword
} from "../services/emergencySuperadminPasswordResetService";
import { hashPassword, verifyPassword } from "../services/passwordService";

test("emergency CLI resets only an active superadmin credential and preserves temporary-password restrictions", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const oldPassword = "0ld!EmergencyPass2026";
  const newPassword = "N3w!EmergencyPass2026";
  const otherPassword = "0ther!AccountPass2026";
  const target = await prisma.user.create({
    data: {
      role: "superadmin",
      rolesJson: '["superadmin"]',
      displayName: `Emergency admin ${suffix}`,
      email: `emergency-admin-${suffix}@zabota.local`,
      passwordHash: await hashPassword(oldPassword),
      status: "active"
    }
  });
  const other = await prisma.user.create({
    data: {
      role: "client",
      rolesJson: '["client"]',
      displayName: `Unaffected user ${suffix}`,
      email: `unaffected-${suffix}@zabota.local`,
      passwordHash: await hashPassword(otherPassword),
      status: "active"
    }
  });
  await prisma.authSession.createMany({
    data: [
      sessionFixture(target.id, `target-${suffix}`),
      sessionFixture(other.id, `other-${suffix}`)
    ]
  });

  const targetBefore = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
  const otherBefore = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let stdoutText = "";
  let stderrText = "";
  stdout.on("data", (chunk) => { stdoutText += chunk.toString("utf8"); });
  stderr.on("data", (chunk) => { stderrText += chunk.toString("utf8"); });
  const prompts: string[] = [];

  let app: Awaited<ReturnType<typeof createNestApplication>> | undefined;
  try {
    const exitCode = await runResetSuperadminPasswordCli(["--user-id", target.id], {
      output: stdout as unknown as NodeJS.WriteStream,
      errorOutput: stderr as unknown as NodeJS.WriteStream,
      isInteractive: true,
      readHidden: async (prompt) => {
        prompts.push(prompt);
        return newPassword;
      }
    });
    assert.equal(exitCode, 0, stderrText);
    assert.equal(prompts.length, 2, "the password must be entered and confirmed separately");

    const targetAfter = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    const otherAfter = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
    assert.match(targetAfter.passwordHash ?? "", /^\$argon2id\$/);
    assert.equal(await verifyPassword(targetAfter.passwordHash, newPassword), true);
    assert.equal(await verifyPassword(targetAfter.passwordHash, oldPassword), false);
    assert.equal(targetAfter.mustChangePassword, true);
    assert.ok(targetAfter.temporaryPasswordExpiresAt && targetAfter.temporaryPasswordExpiresAt > new Date());
    assert.equal(targetAfter.authTokenVersion, targetBefore.authTokenVersion + 1);
    assert.equal(targetAfter.role, targetBefore.role);
    assert.equal(targetAfter.status, targetBefore.status);
    assert.equal(targetAfter.rolesJson, targetBefore.rolesJson);
    assert.equal(targetAfter.email, targetBefore.email);
    assert.equal(otherAfter.passwordHash, otherBefore.passwordHash);
    assert.equal(otherAfter.authTokenVersion, otherBefore.authTokenVersion);
    assert.equal(otherAfter.mustChangePassword, otherBefore.mustChangePassword);

    const targetSession = await prisma.authSession.findFirstOrThrow({ where: { userId: target.id } });
    const otherSession = await prisma.authSession.findFirstOrThrow({ where: { userId: other.id } });
    assert.ok(targetSession.revokedAt);
    assert.equal(targetSession.revokeReason, "superadmin_emergency_password_reset");
    assert.equal(otherSession.revokedAt, null);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "SUPERADMIN_PASSWORD_RESET_VIA_CLI", entityId: target.id },
      orderBy: { createdAt: "desc" }
    });
    const forbiddenValues = [newPassword, targetAfter.passwordHash ?? "impossible", oldPassword];
    for (const value of forbiddenValues) {
      assert.equal(stdoutText.includes(value), false);
      assert.equal(stderrText.includes(value), false);
      assert.equal(audit.payloadJson?.includes(value), false);
    }
    assert.equal(audit.actorUserId, null);

    app = await createNestApplication({ startScheduler: false, exposeOpenApi: false });
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneOrEmail: target.email, password: newPassword })
    });
    const loginText = await loginResponse.text();
    assert.equal(loginResponse.status, 200, loginText);
    const login = JSON.parse(loginText) as { token: string; user: { mustChangePassword: boolean } };
    assert.equal(login.user.mustChangePassword, true);

    let response = await fetch(`${baseUrl}/api/auth/me`, { headers: { authorization: `Bearer ${login.token}` } });
    assert.equal(response.status, 200);
    response = await fetch(`${baseUrl}/api/admin/summary`, { headers: { authorization: `Bearer ${login.token}` } });
    assert.equal(response.status, 403);
    assert.equal((await response.json() as { code: string }).code, "temporary_password_change_required");
  } finally {
    if (app) await app.close();
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [target.id, other.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [target.id, other.id] } } });
  }
});

test("emergency reset refuses a non-superadmin and does not accept a password argument", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = "Client!OriginalPass2026";
  const user = await prisma.user.create({
    data: {
      role: "client",
      rolesJson: '["client"]',
      displayName: `Reset refusal ${suffix}`,
      email: `reset-refusal-${suffix}@zabota.local`,
      passwordHash: await hashPassword(password),
      status: "active"
    }
  });
  try {
    await assert.rejects(
      () => resetEmergencySuperadminPassword(user.id, "N3w!ForbiddenPass2026"),
      (error: unknown) => error instanceof EmergencySuperadminResetError && error.code === "target_not_superadmin"
    );
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(unchanged.passwordHash, user.passwordHash);
    assert.equal(unchanged.authTokenVersion, user.authTokenVersion);

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let output = "";
    stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
    stderr.on("data", (chunk) => { output += chunk.toString("utf8"); });
    const rejectedPassword = "Argument!MustNeverBeAccepted2026";
    const exitCode = await runResetSuperadminPasswordCli(["--password", rejectedPassword], {
      output: stdout as unknown as NodeJS.WriteStream,
      errorOutput: stderr as unknown as NodeJS.WriteStream,
      isInteractive: true,
      readHidden: async () => { throw new Error("must not prompt"); }
    });
    assert.equal(exitCode, 1);
    assert.equal(output.includes(rejectedPassword), false);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

function sessionFixture(userId: string, unique: string) {
  const now = Date.now();
  return {
    familyId: `family-${unique}`,
    userId,
    tokenHash: `token-${unique}`,
    expiresAt: new Date(now + 60 * 60 * 1000),
    idleExpiresAt: new Date(now + 30 * 60 * 1000)
  };
}
