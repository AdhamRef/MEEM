import { NextResponse, type NextRequest } from "next/server";
import { getPlaylistProgress, getVideoProgress, progressInputSchema, recordViewingProgress } from "@/features/playlists/progress.service";
import { getCurrentActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { apiHandler, assertSameOrigin, readJsonBody } from "@/lib/http/api";
import { assertSignedIn } from "@/lib/permissions";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const PRIVATE = { headers: { "Cache-Control": "private, no-store" } };

export const GET = apiHandler(async (request: NextRequest) => {
  const actor = await getCurrentActor();
  const { searchParams } = request.nextUrl;
  const playlistId = searchParams.get("playlistId");
  const videoId = searchParams.get("videoId");

  if (playlistId) return NextResponse.json(await getPlaylistProgress(actor, playlistId), PRIVATE);
  if (videoId) return NextResponse.json({ progress: await getVideoProgress(actor, videoId) }, PRIVATE);
  throw new AppError("VALIDATION");
});

export const PUT = apiHandler(async (request: NextRequest) => {
  assertSameOrigin(request);
  const actor = await getCurrentActor();
  assertSignedIn(actor);
  await enforceRateLimit(RATE_LIMITS.progress, actor.id);

  await recordViewingProgress(actor, await readJsonBody(request, progressInputSchema));
  return new NextResponse(null, { status: 204 });
});
