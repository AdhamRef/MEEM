import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { AppError, isTransactionConflictError, isUniqueConstraintError } from "@/lib/errors";

const emailSchema = z.email();

/**
 * A count check alone would let two simultaneous runs both promote someone, because they
 * would write different users. Both must insert this one key, so its unique index or a
 * transaction conflict stops the second run.
 */
export const BOOTSTRAP_GUARD_KEY = "system.superAdminBootstrap";

export interface BootstrapResult {
  userId: string;
  email: string;
}

/**
 * Promotes one existing account to the first SUPER_ADMIN. It runs only from the command
 * line, so it is not reachable from the web, and it works only once. Later role changes
 * must go through the audited admin interface.
 *
 * The account must already exist, meaning that person has signed in with Google once.
 * Creating it here would make NextAuth reject their first Google sign-in, because an
 * account with that email would exist with no linked provider.
 */
export async function bootstrapSuperAdmin(prisma: PrismaClient, rawEmail: string): Promise<BootstrapResult> {
  const parsed = emailSchema.safeParse(rawEmail.trim().toLowerCase());
  if (!parsed.success) throw new AppError("VALIDATION", "Provide a valid email address.");
  const email = parsed.data;

  try {
    return await prisma.$transaction(async (tx) => {
      const existingAdmins = await tx.user.count({ where: { role: "SUPER_ADMIN" } });
      const guard = await tx.applicationSetting.findUnique({ where: { key: BOOTSTRAP_GUARD_KEY } });
      if (existingAdmins > 0 || guard) throw alreadyBootstrapped();

      const user = await tx.user.findUnique({ where: { email } });
      if (!user) {
        throw new AppError("NOT_FOUND", `No account for ${email}. Sign in with Google once using it, then run this again.`);
      }
      if (user.isDeactivated) {
        throw new AppError("CONFLICT", "This account is deactivated and cannot become super admin.");
      }

      await tx.applicationSetting.create({
        data: { key: BOOTSTRAP_GUARD_KEY, value: { userId: user.id, completedAt: new Date().toISOString() } },
      });
      await tx.user.update({ where: { id: user.id }, data: { role: "SUPER_ADMIN" } });
      await tx.auditLog.create({
        data: {
          actorEmail: "system:bootstrap-script",
          action: "role.bootstrap_super_admin",
          entityType: "User",
          entityId: user.id,
          metadata: { email, previousRole: user.role },
        },
      });

      return { userId: user.id, email };
    });
  } catch (error) {
    if (isUniqueConstraintError(error) || isTransactionConflictError(error)) throw alreadyBootstrapped();
    throw error;
  }
}

function alreadyBootstrapped(): AppError {
  return new AppError("CONFLICT", "A super admin has already been set up. Manage roles from the admin dashboard.");
}
