import { NextResponse, type NextRequest } from "next/server";
import { uploadImage } from "@/features/media/uploads.service";
import { getCurrentActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { apiHandler, assertSameOrigin } from "@/lib/http/api";
import { assertSignedIn } from "@/lib/permissions";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { MAX_UPLOAD_BYTES } from "@/lib/storage/image";
import { strings } from "@/config/strings.ar";

/** Room for the multipart boundaries around the file itself. */
const MULTIPART_OVERHEAD = 64 * 1024;

export const POST = apiHandler(async (request: NextRequest) => {
  assertSameOrigin(request);
  const actor = await getCurrentActor();
  assertSignedIn(actor);
  await enforceRateLimit(RATE_LIMITS.uploads, actor.id);

  // Refuses an oversized body before reading it into memory.
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD) throw new AppError("VALIDATION", strings.uploads.tooLarge);

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    throw new AppError("VALIDATION");
  }
  if (!(file instanceof File)) throw new AppError("VALIDATION");

  const image = await uploadImage(actor, new Uint8Array(await file.arrayBuffer()));
  return NextResponse.json(image, { status: 201, headers: { "Cache-Control": "private, no-store" } });
});
