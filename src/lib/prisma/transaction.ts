import type { Prisma } from "@prisma/client";
import { isTransactionConflictError } from "@/lib/errors";
import { prisma } from "./index";

const MAX_ATTEMPTS = 4;
/** Prisma allows 5 seconds by default, which a remote database can use up on ordinary work. */
const TRANSACTION_LIMITS = { maxWait: 10_000, timeout: 30_000 };

/**
 * MongoDB aborts a transaction that touches a document another transaction is changing,
 * rather than waiting for it. The caller's work is safe to repeat, because the aborted
 * attempt left nothing behind.
 */
export async function withTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, TRANSACTION_LIMITS);
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isTransactionConflictError(error)) throw error;
    }
  }
}
