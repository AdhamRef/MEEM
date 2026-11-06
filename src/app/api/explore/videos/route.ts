import { NextResponse, type NextRequest } from "next/server";
import { listExploreVideos } from "@/features/explore/explore.service";
import { apiHandler } from "@/lib/http/api";
import { clientAddress, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/** Reads stored data only, and never who's asking. Browsing Explore never calls the YouTube API. */
export const GET = apiHandler(async (request: NextRequest) => {
  await enforceRateLimit(RATE_LIMITS.feed, clientAddress(request.headers));

  const params = request.nextUrl.searchParams;
  const page = await listExploreVideos({
    kind: params.get("kind"),
    categoryId: params.get("categoryId"),
    cursor: params.get("cursor"),
    size: Number(params.get("size")),
  });
  return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
});
