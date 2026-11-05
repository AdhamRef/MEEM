import { NextResponse, type NextRequest } from "next/server";
import { runMetadataRefreshAs } from "@/features/youtube/metadata-refresh.service";
import { getCurrentActor } from "@/lib/auth/session";
import { apiHandler, assertSameOrigin } from "@/lib/http/api";
import { assertPermission } from "@/lib/permissions";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const POST = apiHandler(async (request: NextRequest) => {
  assertSameOrigin(request);
  const actor = await getCurrentActor();
  assertPermission(actor, "youtube.import");
  await enforceRateLimit(RATE_LIMITS.adminYouTube, actor.id);

  return NextResponse.json(await runMetadataRefreshAs(actor), { headers: { "Cache-Control": "no-store" } });
});
