import { strings } from "@/config/strings.ar";
import { AppError } from "@/lib/errors";
import { assertSignedIn, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";

export async function getOwnAccount(actor: Actor | null) {
  assertSignedIn(actor);
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true, role: true, createdAt: true } });
  if (!user) throw new AppError("NOT_FOUND");
  return { ...user, canDelete: user.role !== "SUPER_ADMIN" };
}

/**
 * Removes the person and everything personal: sign-ins, sessions, preferences, interests,
 * saved items, history, and viewing positions, all of which cascade from the user. Published
 * work stays, without the link to its author, because readers and other pages depend on it.
 * The audit log is never removed (§19.6), so a staff member's past actions keep their record.
 * The super admin can't do this, because that account can't be replaced from within the site.
 */
export async function deleteOwnAccount(actor: Actor | null): Promise<void> {
  assertSignedIn(actor);

  await withTransaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true } });
    if (!user) throw new AppError("NOT_FOUND");
    if (user.role === "SUPER_ADMIN") throw new AppError("FORBIDDEN", strings.account.superAdminCantDelete);

    const value = { $oid: actor.id };
    await tx.$runCommandRaw({ update: "Article", updates: [{ q: { assigneeIds: value }, u: { $pull: { assigneeIds: value } }, multi: true }] });
    await tx.video.updateMany({ where: { createdById: actor.id }, data: { createdById: null } });
    await tx.user.delete({ where: { id: actor.id } });

    // Records that it happened without keeping the address of someone who asked to be removed.
    await tx.auditLog.create({ data: { actorRole: user.role, action: "account.delete_self", entityType: "User", entityId: actor.id } });
  });
}
