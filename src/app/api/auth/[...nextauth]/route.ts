import { NextResponse, type NextRequest } from "next/server";
import NextAuth from "next-auth";
import { getAuthOptions } from "@/lib/auth/options";
import { checkRateLimit, clientAddress, RATE_LIMITS } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ nextauth: string[] }>;
}

/** The actions that start or finish signing in. Session reads happen on every page and aren't limited. */
const LIMITED_ACTIONS = new Set(["signin", "callback", "signout"]);

async function handler(request: NextRequest, context: RouteContext): Promise<Response> {
  const [action] = (await context.params).nextauth;

  if (action && LIMITED_ACTIONS.has(action)) {
    const { allowed } = await checkRateLimit(RATE_LIMITS.auth, clientAddress(request.headers));
    if (!allowed) {
      // A browser arrives here by navigating, so it gets a page with a message, not JSON.
      return NextResponse.redirect(new URL("/auth/signin?error=RateLimited", request.url), 303);
    }
  }

  // NextAuth's own types describe the older API routes form, though it also supports this one.
  const nextAuthHandler = NextAuth(getAuthOptions()) as unknown as (request: NextRequest, context: RouteContext) => Promise<Response>;
  return nextAuthHandler(request, context);
}

export { handler as GET, handler as POST };
