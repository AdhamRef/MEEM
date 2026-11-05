import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { clearHistory, recordContentView, removeFromHistory, viewInputSchema } from "@/features/users/library.service";
import { getCurrentActor } from "@/lib/auth/session";
import { apiHandler, assertSameOrigin, readJsonBody } from "@/lib/http/api";
import { assertSignedIn } from "@/lib/permissions";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const removeSchema = z.union([viewInputSchema, z.strictObject({ all: z.literal(true) })]);

export const POST = apiHandler(async (request: NextRequest) => {
  assertSameOrigin(request);
  const actor = await getCurrentActor();
  assertSignedIn(actor);
  await enforceRateLimit(RATE_LIMITS.views, actor.id);

  await recordContentView(actor, await readJsonBody(request, viewInputSchema));
  return new NextResponse(null, { status: 204 });
});

export const DELETE = apiHandler(async (request: NextRequest) => {
  assertSameOrigin(request);
  const actor = await getCurrentActor();
  assertSignedIn(actor);
  await enforceRateLimit(RATE_LIMITS.views, actor.id);

  const body = await readJsonBody(request, removeSchema);
  if ("all" in body) await clearHistory(actor);
  else await removeFromHistory(actor, body);
  return new NextResponse(null, { status: 204 });
});
