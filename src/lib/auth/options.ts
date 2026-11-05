import type { UserRole } from "@prisma/client";
import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createAuthAdapter } from "./adapter";
import { isSignInAllowed } from "./sign-in-policy";

/** Identity only. In particular, this requests no YouTube scopes. */
export const GOOGLE_SCOPES = "openid email profile";

export function isGoogleSignInConfigured(): boolean {
  const { AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET } = getEnv();
  return Boolean(AUTH_GOOGLE_ID && AUTH_GOOGLE_SECRET);
}

let cached: NextAuthOptions | undefined;

/** Built on first use, because `next build` imports route modules without any configuration. */
export function getAuthOptions(): NextAuthOptions {
  if (cached) return cached;
  const env = getEnv();

  cached = {
    secret: env.AUTH_SECRET,
    adapter: createAuthAdapter(prisma),
    // Database sessions, so a role change or deactivation applies without waiting for a token to expire.
    session: { strategy: "database", maxAge: 30 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
    providers:
      env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET
        ? [
            GoogleProvider({
              clientId: env.AUTH_GOOGLE_ID,
              clientSecret: env.AUTH_GOOGLE_SECRET,
              authorization: { params: { scope: GOOGLE_SCOPES } },
            }),
          ]
        : [],
    pages: { signIn: "/auth/signin", error: "/auth/signin" },
    // Through our logger, which removes secrets. NextAuth's default prints details as they are.
    logger: {
      error: (code, metadata) => logger.error("Authentication error", { code, metadata }),
      warn: (code) => logger.warn("Authentication warning", { code }),
      debug: () => {},
    },
    callbacks: {
      signIn: ({ account, profile, user }) => isSignInAllowed({ provider: account?.provider, profile, user }),

      // This is what the browser receives from /api/auth/session. It says whether to show
      // the dashboard link and nothing about role or permissions.
      session: ({ session, user }) => {
        const { role, permissionGrants } = user as unknown as { role: UserRole; permissionGrants: string[] };
        return {
          expires: session.expires,
          user: { name: user.name ?? null, email: user.email, hasAdminAccess: hasPermission({ role, permissionGrants }, "admin.access") },
        };
      },
    },
  };
  return cached;
}
