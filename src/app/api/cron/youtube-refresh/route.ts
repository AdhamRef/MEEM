import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/config/env";
import { runScheduledRefresh } from "@/features/youtube/metadata-refresh.service";
import { AppError } from "@/lib/errors";
import { apiHandler } from "@/lib/http/api";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Comparing fixed-length digests, so the check reveals nothing through its timing or length. */
function isAuthorized(request: NextRequest, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

/**
 * For a scheduler to call daily. YouTube requires stored data to be refreshed or removed
 * within 30 days. With no CRON_SECRET configured, this endpoint doesn't exist.
 */
const handler = apiHandler(async (request: NextRequest) => {
  const secret = getEnv().CRON_SECRET;
  if (!secret) throw new AppError("NOT_FOUND");
  if (!isAuthorized(request, secret)) throw new AppError("UNAUTHENTICATED");

  const report = await runScheduledRefresh();
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
});

export { handler as GET, handler as POST };
