import { NextResponse, type NextRequest } from "next/server";
import { suggestContent } from "@/features/search/search.service";
import { apiHandler } from "@/lib/http/api";
import { clientAddress, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/** Public, and the same for everyone. What's typed isn't stored or logged. */
export const GET = apiHandler(async (request: NextRequest) => {
  await enforceRateLimit(RATE_LIMITS.search, clientAddress(request.headers));
  const suggestions = await suggestContent(request.nextUrl.searchParams.get("q") ?? "");
  return NextResponse.json({ suggestions }, { headers: { "Cache-Control": "private, no-store" } });
});
