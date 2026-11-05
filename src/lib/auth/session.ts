import type { UserRole } from "@prisma/client";
import { connection } from "next/server";
import { getServerSession } from "next-auth";
import { cache } from "react";
import type { Actor } from "@/lib/permissions";
import { getAuthOptions } from "./options";

/**
 * The only source of who is making a request. It reads the session cookie and the user's
 * current database record, so roles are always fresh and nothing the client sends counts.
 * React's cache keeps this to one database read per page render.
 */
export const getCurrentActor = cache(async (): Promise<Actor | null> => {
  // Marks the caller as request-time before anything else. Without this, `next build` tries to
  // pre-render pages that use this, and fails reading configuration that only exists at run time.
  await connection();

  const options = getAuthOptions();

  const session = (await getServerSession({
    ...options,
    callbacks: {
      ...options.callbacks,
      // Server-side version of the session callback, with what authorization needs.
      session: ({ user }) => {
        const { role, permissionGrants } = user as unknown as { role: UserRole; permissionGrants: string[] };
        const actor: Actor = { id: user.id, email: user.email, role, permissionGrants };
        return { actor } as never;
      },
    },
  })) as { actor: Actor } | null;

  return session?.actor ?? null;
});
