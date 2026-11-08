import { prisma } from "@/lib/prisma";

/** YouTube resets its quota at midnight Pacific time. */
export function pacificDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const DUPLICATE_KEY = /\b11000\b|E11000/;

/** findAndModify, because several byEndpoint counters must increase atomically together. */
async function updateDay(update: Record<string, unknown>, now: Date): Promise<void> {
  const day = pacificDay(now);
  for (let attempt = 1; ; attempt += 1) {
    try {
      await prisma.$runCommandRaw({
        findAndModify: "ApiQuotaUsage",
        query: { day },
        update: { ...update, $set: { ...(update.$set as object | undefined), updatedAt: { $date: now.toISOString() } } },
        upsert: true,
      });
      return;
    } catch (error) {
      if (attempt >= 5 || !DUPLICATE_KEY.test(String(error))) throw error;
    }
  }
}

export async function recordQuotaUse(endpoint: string, units: number, now = new Date()): Promise<void> {
  await updateDay({ $inc: { units, [`byEndpoint.${endpoint}`]: units }, $setOnInsert: { exhausted: false } }, now);
}

export async function markQuotaExhausted(now = new Date()): Promise<void> {
  await updateDay({ $set: { exhausted: true }, $setOnInsert: { units: 0 } }, now);
}

export async function isQuotaExhausted(now = new Date()): Promise<boolean> {
  const usage = await prisma.apiQuotaUsage.findUnique({ where: { day: pacificDay(now) }, select: { exhausted: true } });
  return usage?.exhausted ?? false;
}

export async function getQuotaUsage(now = new Date()): Promise<{ day: string; units: number; exhausted: boolean }> {
  const day = pacificDay(now);
  const usage = await prisma.apiQuotaUsage.findUnique({ where: { day }, select: { units: true, exhausted: true } });
  return { day, units: usage?.units ?? 0, exhausted: usage?.exhausted ?? false };
}

/** YouTube's default daily allowance for a project, until an increase is granted. */
export const YOUTUBE_DAILY_QUOTA = 10_000;

/**
 * When the quota next resets: midnight in Los Angeles. Read from the wall clock there, so it
 * follows daylight saving, give or take the hour on the night the clocks change.
 */
export function nextQuotaReset(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  const elapsed = (part("hour") * 3600 + part("minute") * 60 + part("second")) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() + 86_400_000 - elapsed);
}
