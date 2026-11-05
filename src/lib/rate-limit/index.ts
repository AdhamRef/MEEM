import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

export interface RateLimitRule {
  /** What is being limited, for example "auth" or "preferences.write". */
  scope: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

const DUPLICATE_KEY = /\b11000\b|E11000/;

/**
 * A fixed window counter in MongoDB, which works across server instances with no Redis.
 * findAndModify makes each increment atomic. Two first requests can still race to insert
 * the same key, and the loser simply retries against the document the winner created.
 * The TTL index removes expired buckets.
 */
async function incrementBucket(key: string, expiresAt: Date): Promise<number> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const result = (await prisma.$runCommandRaw({
        findAndModify: "RateLimitBucket",
        query: { key },
        update: { $inc: { count: 1 }, $setOnInsert: { expiresAt: { $date: expiresAt.toISOString() } } },
        upsert: true,
        new: true,
      })) as { value: { count: number } };
      return result.value.count;
    } catch (error) {
      if (attempt >= 5 || !DUPLICATE_KEY.test(String(error))) throw error;
    }
  }
}

export async function checkRateLimit(rule: RateLimitRule, subject: string, now = Date.now()): Promise<RateLimitResult> {
  const windowMs = rule.windowSeconds * 1000;
  const windowIndex = Math.floor(now / windowMs);
  const windowEnd = (windowIndex + 1) * windowMs;

  const count = await incrementBucket(`${rule.scope}:${subject}:${windowIndex}`, new Date(windowEnd));

  return { allowed: count <= rule.limit, count, retryAfterSeconds: Math.max(1, Math.ceil((windowEnd - now) / 1000)) };
}

export async function enforceRateLimit(rule: RateLimitRule, subject: string): Promise<void> {
  const { allowed } = await checkRateLimit(rule, subject);
  if (!allowed) throw new AppError("RATE_LIMITED");
}

/**
 * The address the nearest proxy reports. The rightmost X-Forwarded-For entry is the one
 * that proxy added itself, while entries further left can be supplied by the client.
 */
export function clientAddress(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return forwarded || "unknown";
}

export const RATE_LIMITS = {
  auth: { scope: "auth", limit: 20, windowSeconds: 60 },
  preferencesWrite: { scope: "preferences.write", limit: 30, windowSeconds: 60 },
  feed: { scope: "feed", limit: 120, windowSeconds: 60 },
  signals: { scope: "signals", limit: 60, windowSeconds: 60 },
  favorites: { scope: "favorites", limit: 60, windowSeconds: 60 },
  // Each page costs YouTube quota, unlike the rest of the site.
  comments: { scope: "comments", limit: 20, windowSeconds: 60 },
  adminYouTube: { scope: "admin.youtube", limit: 5, windowSeconds: 60 },
  adminWrite: { scope: "admin.write", limit: 120, windowSeconds: 60 },
  uploads: { scope: "uploads", limit: 20, windowSeconds: 60 },
  progress: { scope: "progress", limit: 30, windowSeconds: 60 },
  // Text queries are the most expensive thing a guest can ask for.
  search: { scope: "search", limit: 120, windowSeconds: 60 },
  views: { scope: "views", limit: 60, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;
