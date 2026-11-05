import { NextResponse, type NextRequest } from "next/server";
import { setOnboardingOutcome } from "@/features/preferences/preferences.service";
import { onboardingOutcomeSchema } from "@/features/preferences/schemas";
import { getCurrentActor } from "@/lib/auth/session";
import { apiHandler, assertSameOrigin, readJsonBody } from "@/lib/http/api";
import { assertSignedIn } from "@/lib/permissions";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export const POST = apiHandler(async (request: NextRequest) => {
  assertSameOrigin(request);
  const actor = await getCurrentActor();
  assertSignedIn(actor);
  await enforceRateLimit(RATE_LIMITS.preferencesWrite, actor.id);

  const view = await setOnboardingOutcome(actor, await readJsonBody(request, onboardingOutcomeSchema));
  return NextResponse.json(view, { headers: { "Cache-Control": "private, no-store" } });
});
