import { NextResponse, type NextRequest } from "next/server";
import { getFeedPage, type GuestFeedHints } from "@/features/shorts/feed.service";
import { getCurrentActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { apiHandler } from "@/lib/http/api";
import { clientAddress, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const MAX_HINT_LENGTH = 4096;

/** Reads "id:score,id:score". The service validates what comes out. */
function parseScores(raw: string | null): Record<string, number> {
  if (!raw) return {};
  if (raw.length > MAX_HINT_LENGTH) throw new AppError("VALIDATION");
  return Object.fromEntries(
    raw.split(",").map((entry) => {
      const [id = "", score = ""] = entry.split(":");
      return [id, Number(score)];
    }),
  );
}

function parseGuestHints(params: URLSearchParams): GuestFeedHints {
  const interests = params.get("interests") ?? "";
  if (interests.length > MAX_HINT_LENGTH) throw new AppError("VALIDATION");
  return { selectedCategoryIds: interests ? interests.split(",") : [], behaviour: parseScores(params.get("behaviour")) };
}

/** Reads stored data only. Rendering the feed never calls the YouTube API. */
export const GET = apiHandler(async (request: NextRequest) => {
  await enforceRateLimit(RATE_LIMITS.feed, clientAddress(request.headers));

  const params = request.nextUrl.searchParams;
  const page = await getFeedPage(await getCurrentActor(), {
    cursor: params.get("cursor"),
    categoryId: params.get("categoryId"),
    guest: parseGuestHints(params),
    session: { categories: parseScores(params.get("momentum")), channels: parseScores(params.get("channelMomentum")) },
  });
  return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
});
