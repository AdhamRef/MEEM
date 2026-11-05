import { NextResponse, type NextRequest } from "next/server";
import { deleteOwnAccount } from "@/features/users/account.service";
import { getCurrentActor } from "@/lib/auth/session";
import { apiHandler, assertSameOrigin } from "@/lib/http/api";
import { assertSignedIn } from "@/lib/permissions";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/** Takes no identifier, so it can only ever remove the account that's asking. */
export const DELETE = apiHandler(async (request: NextRequest) => {
  assertSameOrigin(request);
  const actor = await getCurrentActor();
  assertSignedIn(actor);
  await enforceRateLimit(RATE_LIMITS.preferencesWrite, actor.id);

  await deleteOwnAccount(actor);
  return new NextResponse(null, { status: 204 });
});
