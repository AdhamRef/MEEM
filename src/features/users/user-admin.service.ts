import { z } from "zod";
import { UserRole, type Prisma } from "@prisma/client";
import { recordAudit } from "@/features/admin/audit";
import { objectIdSchema } from "@/features/topics/schemas";
import { AppError } from "@/lib/errors";
import { assertPermission, GRANTABLE_PERMISSIONS, type Actor } from "@/lib/permissions";
import { withTransaction } from "@/lib/prisma/transaction";

// SUPER_ADMIN is excluded on purpose: the bootstrap command is the only way to create one.
const assignableRoleSchema = z.enum(UserRole).exclude(["SUPER_ADMIN"]);
const grantsSchema = z.array(z.enum(GRANTABLE_PERMISSIONS)).max(GRANTABLE_PERMISSIONS.length);

function parseUserId(rawId: unknown): string {
  const parsed = objectIdSchema.safeParse(rawId);
  if (!parsed.success) throw new AppError("VALIDATION");
  return parsed.data;
}

/** Nobody can change the super admin, including that person, so access can't be lost by accident. */
async function loadChangeableUser(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, permissionGrants: true } });
  if (!user) throw new AppError("NOT_FOUND");
  if (user.role === "SUPER_ADMIN") throw new AppError("FORBIDDEN");
  return user;
}

export async function changeUserRole(actor: Actor | null, rawUserId: unknown, rawRole: unknown): Promise<void> {
  assertPermission(actor, "users.manage");
  const userId = parseUserId(rawUserId);
  const role = assignableRoleSchema.safeParse(rawRole);
  if (!role.success) throw new AppError("VALIDATION");

  await withTransaction(async (tx) => {
    const user = await loadChangeableUser(tx, userId);
    await tx.user.update({ where: { id: userId }, data: { role: role.data } });
    await recordAudit(tx, actor, {
      action: "user.role_change",
      entityType: "User",
      entityId: userId,
      metadata: { previousRole: user.role, newRole: role.data },
    });
  });
}

export async function setUserPermissionGrants(actor: Actor | null, rawUserId: unknown, rawGrants: unknown): Promise<void> {
  assertPermission(actor, "users.manage");
  const userId = parseUserId(rawUserId);
  const grants = grantsSchema.safeParse(rawGrants);
  if (!grants.success) throw new AppError("VALIDATION");
  const permissionGrants = [...new Set(grants.data)];

  await withTransaction(async (tx) => {
    const user = await loadChangeableUser(tx, userId);
    await tx.user.update({ where: { id: userId }, data: { permissionGrants } });
    await recordAudit(tx, actor, {
      action: "user.grants_change",
      entityType: "User",
      entityId: userId,
      metadata: { previousGrants: user.permissionGrants, newGrants: permissionGrants },
    });
  });
}

/** Deleting the sessions ends access at once, rather than when they would have expired. */
export async function setUserDeactivated(actor: Actor | null, rawUserId: unknown, isDeactivated: boolean): Promise<void> {
  assertPermission(actor, "users.manage");
  const userId = parseUserId(rawUserId);

  await withTransaction(async (tx) => {
    await loadChangeableUser(tx, userId);
    await tx.user.update({
      where: { id: userId },
      data: { isDeactivated, deactivatedAt: isDeactivated ? new Date() : null },
    });
    if (isDeactivated) await tx.session.deleteMany({ where: { userId } });
    await recordAudit(tx, actor, {
      action: isDeactivated ? "user.deactivate" : "user.reactivate",
      entityType: "User",
      entityId: userId,
    });
  });
}
