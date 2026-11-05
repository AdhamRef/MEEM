import { NextResponse, type NextRequest } from "next/server";
import { recordVideoSignal, videoSignalSchema } from "@/features/recommendations/signals.service";
import { getCurrentActor } from "@/lib/auth/session";
import { apiHandler, assertSameOrigin, readJsonBody } from "@/lib/http/api";
import { assertSignedIn } from "@/lib/permissions";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const POST = apiHandler(async (request: NextRequest) => {
  assertSameOrigin(request);
  const actor = await getCurrentActor();
  assertSignedIn(actor);
  await enforceRateLimit(RATE_LIMITS.signals, actor.id);

  await recordVideoSignal(actor, await readJsonBody(request, videoSignalSchema));
  return new NextResponse(null, { status: 204 });
});
