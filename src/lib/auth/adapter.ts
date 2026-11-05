import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { PrismaClient } from "@prisma/client";
import type { Adapter, AdapterAccount, AdapterSession, AdapterUser } from "next-auth/adapters";

/**
 * The standard adapter, with five rules on top. All of NextAuth's database access goes
 * through here, which makes this the one place to enforce them.
 */
export function createAuthAdapter(prisma: PrismaClient): Adapter {
  const base = PrismaAdapter(prisma) as Required<Adapter>;

  return {
    ...base,

    // Only known fields are written, so nothing in a provider profile can set a role.
    createUser: ({ name, email, image, emailVerified }: Omit<AdapterUser, "id">) =>
      base.createUser({ name, email: email.toLowerCase(), image, emailVerified } as AdapterUser),

    // The bootstrap command and lookups expect lowercase addresses.
    getUserByEmail: (email: string) => base.getUserByEmail(email.toLowerCase()),

    // Google is used only for sign-in. Storing its tokens would add risk and no function.
    linkAccount: ({ userId, type, provider, providerAccountId }: AdapterAccount) =>
      base.linkAccount({ userId, type, provider, providerAccountId } as AdapterAccount),

    // Checked on every session read, so deactivation applies to the very next request.
    getSessionAndUser: async (sessionToken: string): Promise<{ session: AdapterSession; user: AdapterUser } | null> => {
      const result = await base.getSessionAndUser(sessionToken);
      if (!result) return null;
      return (result.user as AdapterUser & { isDeactivated?: boolean }).isDeactivated ? null : result;
    },

    // Several requests can find the same expired session at once. The standard version throws
    // for every one after the first, though the session being gone is the wanted outcome.
    deleteSession: async (sessionToken: string) => {
      await prisma.session.deleteMany({ where: { sessionToken } });
    },
  };
}
