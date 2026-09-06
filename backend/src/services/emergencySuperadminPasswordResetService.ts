import { prisma } from "../db/prisma";
import { env } from "../config/env";
import { HttpError } from "../utils/http";
import { writeAudit } from "./auditService";
import { assertPasswordPolicy } from "./accountSecurityService";
import { revokeUserSessions } from "./authSessionService";
import { hashPassword, verifyPassword } from "./passwordService";

export class EmergencySuperadminResetError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export async function findEmergencySuperadminTarget(targetUserId?: string) {
  if (targetUserId) {
    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new EmergencySuperadminResetError("target_not_found", "Указанная учётная запись не найдена.");
    assertEligibleSuperadmin(target);
    return target;
  }

  const targets = await prisma.user.findMany({
    where: { role: "superadmin", status: "active" },
    take: 2
  });
  if (targets.length !== 1) {
    throw new EmergencySuperadminResetError(
      "target_not_unique",
      "Невозможно однозначно выбрать active superadmin. Повторите команду с --user-id <id>."
    );
  }
  return targets[0]!;
}

export async function resetEmergencySuperadminPassword(targetUserId: string, temporaryPassword: string) {
  const target = await findEmergencySuperadminTarget(targetUserId);
  assertPasswordPolicy(temporaryPassword, target);
  if (await verifyPassword(target.passwordHash, temporaryPassword)) {
    throw new HttpError(400, "Новый временный пароль должен отличаться от текущего", "password_reuse_forbidden");
  }

  const passwordHash = await hashPassword(temporaryPassword);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.temporaryPasswordTtlHours * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: {
        id: target.id,
        role: "superadmin",
        status: "active",
        authTokenVersion: target.authTokenVersion,
        passwordHash: target.passwordHash
      },
      data: {
        passwordHash,
        mustChangePassword: true,
        temporaryPasswordExpiresAt: expiresAt,
        passwordResetAt: now,
        passwordResetByUserId: null,
        authTokenVersion: { increment: 1 }
      }
    });
    if (updated.count !== 1) {
      throw new EmergencySuperadminResetError(
        "target_changed",
        "Учётная запись изменилась во время операции. Сброс не выполнен; повторите проверку."
      );
    }

    await revokeUserSessions(tx, target.id, "superadmin_emergency_password_reset");
    await writeAudit(null, "SUPERADMIN_PASSWORD_RESET_VIA_CLI", "user", target.id, {
      source: "administrative_cli",
      reason: "emergency_access_recovery",
      revokedSessions: "all",
      result: "success"
    }, tx);
  });

  return { temporaryPasswordExpiresAt: expiresAt };
}

function assertEligibleSuperadmin(target: { role: string; status: string }) {
  if (target.role !== "superadmin") {
    throw new EmergencySuperadminResetError(
      "target_not_superadmin",
      "Команда разрешает сброс только для учётной записи superadmin."
    );
  }
  if (target.status !== "active") {
    throw new EmergencySuperadminResetError(
      "target_not_active",
      "Учётная запись superadmin не активна. Команда не меняет status или permissions."
    );
  }
}
