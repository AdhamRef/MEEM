import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSavedIds, saveContentSchema, saveVideoSchema, setContentSaved, setVideoSaved } from "@/features/favorites/favorites.service";
import { getCurrentActor } from "@/lib/auth/session";
import { apiHandler, assertSameOrigin, readJsonBody } from "@/lib/http/api";
import { assertSignedIn } from "@/lib/permissions";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const PRIVATE = { headers: { "Cache-Control": "private, no-store" } };
const saveSchema = z.union([saveVideoSchema, saveContentSchema]);

export const GET = apiHandler(async (request: NextRequest) => {
  const ids = request.nextUrl.searchParams.get("ids");
  const list = ids ? ids.split(",") : [];
  const actor = await getCurrentActor();
  const savedIds = await getSavedIds(actor, request.nextUrl.searchParams.get("type") ?? "VIDEO", list);
  return NextResponse.json({ savedIds }, PRIVATE);
});

export const PUT = apiHandler(async (request: NextRequest) => {
  assertSameOrigin(request);
  const actor = await getCurrentActor();
  assertSignedIn(actor);
  await enforceRateLimit(RATE_LIMITS.favorites, actor.id);

  const body = await readJsonBody(request, saveSchema);
  return NextResponse.json("entityType" in body ? await setContentSaved(actor, body) : await setVideoSaved(actor, body), PRIVATE);
});
