import { getCurrentActor } from "@/lib/auth/session";
import { toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { Actor } from "@/lib/permissions";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export type ActionResult<Data = undefined> = { ok: true; data: Data } | { ok: false; message: string };

/**
 * Wraps an administrative Server Action. Next.js checks the request's origin for these, and
 * the service called inside checks permissions. Failures come back as safe messages, because
 * an error thrown from an action would otherwise reach the client as a generic crash.
 */
export async function runAction<Data>(name: string, work: (actor: Actor | null) => Promise<Data>): Promise<ActionResult<Data>> {
  try {
    const actor = await getCurrentActor();
    if (actor) await enforceRateLimit(RATE_LIMITS.adminWrite, actor.id);
    return { ok: true, data: await work(actor) };
  } catch (error) {
    const publicError = toPublicError(error);
    if (publicError.status >= 500) logger.error("Server action failed", { action: name, error });
    return { ok: false, message: publicError.message };
  }
}
