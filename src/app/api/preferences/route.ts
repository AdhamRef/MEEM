import { NextResponse, type NextRequest } from "next/server";
import { getPreferences, resetInterests, saveInterests } from "@/features/preferences/preferences.service";
import { saveInterestsSchema } from "@/features/preferences/schemas";
import { getCurrentActor } from "@/lib/auth/session";
import { apiHandler, assertSameOrigin, readJsonBody } from "@/lib/http/api";
import { assertSignedIn } from "@/lib/permissions";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const PRIVATE = { headers: { "Cache-Control": "private, no-store" } };

export const GET = apiHandler(async () => {
  return NextResponse.json(await getPreferences(await getCurrentActor()), PRIVATE);
});

export const PUT = apiHandler(async (request: NextRequest) => {
  assertSameOrigin(request);
  const actor = await getCurrentActor();
  assertSignedIn(actor);
  await enforceRateLimit(RATE_LIMITS.preferencesWrite, actor.id);

  return NextResponse.json(await saveInterests(actor, await readJsonBody(request, saveInterestsSchema)), PRIVATE);
});

export const DELETE = apiHandler(async (request: NextRequest) => {
  assertSameOrigin(request);
  const actor = await getCurrentActor();
  assertSignedIn(actor);
  await enforceRateLimit(RATE_LIMITS.preferencesWrite, actor.id);

  return NextResponse.json(await resetInterests(actor), PRIVATE);
});
