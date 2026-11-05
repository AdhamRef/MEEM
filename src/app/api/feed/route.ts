import { NextResponse, type NextRequest } from "next/server";
import { getFeedPage, type GuestFeedHints } from "@/features/shorts/feed.service";
import { getCurrentActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { apiHandler } from "@/lib/http/api";
import { clientAddress, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const MAX_HINT_LENGTH = 4096;

function parseGuestHints(params: URLSearchParams): GuestFeedHints {
  const interests = params.get("interests") ?? "";
  const behaviour = params.get("behaviour") ?? "";
  if (interests.length > MAX_HINT_LENGTH || behaviour.length > MAX_HINT_LENGTH) throw new AppError("VALIDATION");

  return {
    selectedCategoryIds: interests ? interests.split(",") : [],
    behaviour: Object.fromEntries(
      (behaviour ? behaviour.split(",") : []).map((entry) => {
        const [categoryId = "", score = ""] = entry.split(":");
        return [categoryId, Number(score)];
      }),
    ),
  };
}

/** Reads stored data only. Rendering the feed never calls the YouTube API. */
export const GET = apiHandler(async (request: NextRequest) => {
  await enforceRateLimit(RATE_LIMITS.feed, clientAddress(request.headers));

  const params = request.nextUrl.searchParams;
  const page = await getFeedPage(await getCurrentActor(), {
    cursor: params.get("cursor"),
    categoryId: params.get("categoryId"),
    guest: parseGuestHints(params),
  });
  return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
});
