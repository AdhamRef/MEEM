import { NextResponse, type NextRequest } from "next/server";
import { listTopicsForInterests } from "@/features/explore/explore.service";
import { apiHandler } from "@/lib/http/api";
import { clientAddress, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const MAX_PARAMETER_LENGTH = 2048;

/** Guests' choices live in their browser, so the page asks with them instead of reading a session. */
export const GET = apiHandler(async (request: NextRequest) => {
  await enforceRateLimit(RATE_LIMITS.feed, clientAddress(request.headers));
  const ids = (request.nextUrl.searchParams.get("ids") ?? "").slice(0, MAX_PARAMETER_LENGTH);
  const topics = await listTopicsForInterests(ids ? ids.split(",") : []);
  return NextResponse.json({ topics }, { headers: { "Cache-Control": "private, no-store" } });
});
