import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Pass the transaction client, so the record commits or rolls back with the change it
 * describes. This module deliberately offers no update or delete: audit logs are append-only.
 */
export async function recordAudit(db: Prisma.TransactionClient | PrismaClient, actor: Actor, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata,
    },
  });
}
