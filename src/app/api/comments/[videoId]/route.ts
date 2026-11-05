import { NextResponse, type NextRequest } from "next/server";
import { getVideoComments } from "@/features/youtube/comments.service";
import { apiHandler } from "@/lib/http/api";
import { clientAddress, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

interface RouteContext {
  params: Promise<{ videoId: string }>;
}

/** Fetched from YouTube on request and passed on. Comments are never stored here. */
export const GET = apiHandler(async (request: NextRequest, context: RouteContext) => {
  await enforceRateLimit(RATE_LIMITS.comments, clientAddress(request.headers));

  const { videoId } = await context.params;
  const result = await getVideoComments(videoId, request.nextUrl.searchParams.get("pageToken"));
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
