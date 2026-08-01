import { prisma } from "../db/prisma";
import { writeAudit } from "./auditService";
import { HttpError } from "../utils/http";
import type { UserRole } from "../types/domain";

type Operator = { id: string; role: UserRole };

export async function assignManagerRole(actor: Operator, targetUserId: string, reason?: string) {
  if (actor.role !== 'superadmin') {
    throw new HttpError(403, "Менеджер не может менять роли пользователей", "manager_permission_denied");
  }
  if (actor.id === targetUserId) {
    throw new HttpError(400, "Нельзя изменить собственную административную роль", "cannot_change_own_role");
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id: targetUserId } });
    if (!current) throw new HttpError(404, "Пользователь не найден", "user_not_found");
    if (current.status !== "active") {
      throw new HttpError(409, "Назначить менеджером можно только активного пользователя", "manager_assignment_status_invalid");
    }
    if (!['client', 'performer'].includes(current.role)) {
      throw new HttpError(409, "Эту роль нельзя заменить ролью менеджера", "manager_assignment_role_invalid");
    }

    const assignedAt = new Date();
    const user = await tx.user.update({
      where: { id: current.id },
      data: {
        role: "manager",
        rolesJson: JSON.stringify(["manager"]),
        roleBeforeManager: current.role,
        managerAssignedAt: assignedAt,
        managerAssignedByAdminId: actor.id,
        managerRevokedAt: null,
        managerRevokedByAdminId: null,
        authTokenVersion: { increment: 1 }
      }
    });
    await writeAudit(actor.id, "admin.manager.assign", "user", user.id, {
      actorUserId: actor.id,
      actorRole: actor.role,
      targetUserId: user.id,
      previousRole: current.role,
      newRole: "manager",
      reason: reason ?? null,
      source: "admin_panel"
    }, tx);
    return user;
  });
}

export async function revokeManagerRole(
  actor: Operator,
  targetUserId: string,
  restoreRole?: "client" | "performer",
  reason?: string
) {
  if (actor.role !== 'superadmin') {
    throw new HttpError(403, "Менеджер не может менять роли пользователей", "manager_permission_denied");
  }
  if (actor.id === targetUserId) {
    throw new HttpError(400, "Нельзя изменить собственную административную роль", "cannot_change_own_role");
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id: targetUserId } });
    if (!current) throw new HttpError(404, "Пользователь не найден", "user_not_found");
    if (current.role !== "manager") {
      throw new HttpError(409, "Пользователь не является менеджером", "manager_role_required");
    }
    const previousRole = current.roleBeforeManager;
    const nextRole = restoreRole ?? (previousRole === "client" || previousRole === "performer" ? previousRole : null);
    if (!nextRole) {
      throw new HttpError(400, "Укажите роль, которую нужно восстановить", "manager_restore_role_required");
    }

    const user = await tx.user.update({
      where: { id: current.id },
      data: {
        role: nextRole,
        rolesJson: JSON.stringify([nextRole]),
        roleBeforeManager: null,
        managerRevokedAt: new Date(),
        managerRevokedByAdminId: actor.id,
        authTokenVersion: { increment: 1 }
      }
    });
    await writeAudit(actor.id, "admin.manager.revoke", "user", user.id, {
      actorUserId: actor.id,
      actorRole: actor.role,
      targetUserId: user.id,
      previousRole: "manager",
      restoredRole: nextRole,
      reason: reason ?? null,
      source: "admin_panel"
    }, tx);
    return user;
  });
}

export async function blockUser(actor: Operator, targetUserId: string, reason: string) {
  if (!['manager', 'superadmin'].includes(actor.role)) {
    throw new HttpError(403, "Недостаточно прав для блокировки", "user_blocking_forbidden");
  }
  if (actor.id === targetUserId) {
    throw new HttpError(400, "Нельзя заблокировать текущую учётную запись", "cannot_block_self");
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id: targetUserId } });
    if (!current) throw new HttpError(404, "Пользователь не найден", "user_not_found");
    if (current.status === "archived") {
      throw new HttpError(409, "Архивный профиль нельзя заблокировать", "user_already_archived");
    }
    if (actor.role === "manager" && ['manager', 'admin', 'superadmin'].includes(current.role)) {
      throw new HttpError(403, "Менеджер не может блокировать административные роли", "manager_permission_denied");
    }
    if (current.role === "superadmin") {
      throw new HttpError(409, "Суперадминистратор защищён от блокировки", "last_superadmin_protected");
    }

    const user = await tx.user.update({
      where: { id: current.id },
      data: {
        status: "blocked",
        blockedAt: new Date(),
        blockedByAdminId: actor.id,
        blockedByRole: actor.role,
        blockReason: reason,
        authTokenVersion: { increment: 1 }
      }
    });
    const managerAction = actor.role === "manager";
    await writeAudit(actor.id, managerAction ? "manager.user.block" : "user.block", "user", user.id, {
      actorUserId: actor.id,
      actorRole: actor.role,
      targetUserId: user.id,
      reason,
      source: managerAction ? "manager_panel" : "admin_panel"
    }, tx);
    return user;
  });
}

export async function unblockUser(actor: Operator, targetUserId: string) {
  if (!['manager', 'superadmin'].includes(actor.role)) {
    throw new HttpError(403, "Недостаточно прав для разблокировки", "user_blocking_forbidden");
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id: targetUserId } });
    if (!current) throw new HttpError(404, "Пользователь не найден", "user_not_found");
    if (!['blocked', 'pending_archive'].includes(current.status)) {
      throw new HttpError(409, "Разблокирование для этого статуса недоступно", "user_status_invalid");
    }
    if (actor.role === "manager" && current.blockedByRole !== "manager") {
      throw new HttpError(403, "Менеджер может снять только блокировку менеджера", "manager_permission_denied");
    }

    const user = await tx.user.update({
      where: { id: current.id },
      data: {
        status: "active",
        blockedAt: null,
        blockedByAdminId: null,
        blockedByRole: null,
        blockReason: null,
        archiveRequestedAt: null,
        archiveRequestedByAdminId: null,
        archiveReason: null,
        archiveBlockedReason: null
      }
    });
    const managerAction = actor.role === "manager";
    await writeAudit(actor.id, managerAction ? "manager.user.unblock" : "user.unblock", "user", user.id, {
      actorUserId: actor.id,
      actorRole: actor.role,
      targetUserId: user.id,
      source: managerAction ? "manager_panel" : "admin_panel"
    }, tx);
    return user;
  });
}
