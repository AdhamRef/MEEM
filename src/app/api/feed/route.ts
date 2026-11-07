import { NextResponse, type NextRequest } from "next/server";
import { getFeedPage, type GuestFeedHints } from "@/features/shorts/feed.service";
import { getCurrentActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { apiHandler } from "@/lib/http/api";
import { clientAddress, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const MAX_HINT_LENGTH = 8000;

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

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  if (raw.length > MAX_HINT_LENGTH) throw new AppError("VALIDATION");
  return raw.split(",");
}

function parseGuestHints(params: URLSearchParams): GuestFeedHints {
  const channelChoices = {
    ...Object.fromEntries(parseIds(params.get("channelsOn")).map((id) => [id, true])),
    ...Object.fromEntries(parseIds(params.get("channelsOff")).map((id) => [id, false])),
  };
  return { selectedTopicIds: parseIds(params.get("interests")), channelChoices, behaviour: parseScores(params.get("behaviour")) };
}

/** Reads stored data only. Rendering the feed never calls the YouTube API. */
export const GET = apiHandler(async (request: NextRequest) => {
  await enforceRateLimit(RATE_LIMITS.feed, clientAddress(request.headers));

  const params = request.nextUrl.searchParams;
  const page = await getFeedPage(await getCurrentActor(), {
    cursor: params.get("cursor"),
    topicId: params.get("topicId"),
    guest: parseGuestHints(params),
    session: { topics: parseScores(params.get("momentum")), channels: parseScores(params.get("channelMomentum")) },
  });
  return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
});
