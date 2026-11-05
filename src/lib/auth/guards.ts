import { redirect } from "next/navigation";
import { hasPermission, type Actor, type Permission } from "@/lib/permissions";
import { signInHref } from "./callback-url";
import { getCurrentActor } from "./session";

export type PageAccess = { allowed: true; actor: Actor } | { allowed: false };

/**
 * For administrative pages. Guests go to sign-in. Each page calls this as well as the
 * layout, because a layout isn't re-rendered when moving between its pages.
 */
export async function checkPageAccess(permission: Permission, callbackPath: string): Promise<PageAccess> {
  const actor = await getCurrentActor();
  if (!actor) redirect(signInHref(callbackPath));
  return hasPermission(actor, permission) ? { allowed: true, actor } : { allowed: false };
}
