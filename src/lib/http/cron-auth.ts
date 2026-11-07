import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getEnv } from "@/config/env";
import { AppError } from "@/lib/errors";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * For the scheduled endpoints. Comparing fixed-length digests reveals nothing through timing or
 * length. With no CRON_SECRET configured, the endpoints don't exist.
 */
export function assertCronRequest(request: NextRequest): void {
  const secret = getEnv().CRON_SECRET;
  if (!secret) throw new AppError("NOT_FOUND");
  const header = request.headers.get("authorization") ?? "";
  if (!timingSafeEqual(digest(header), digest(`Bearer ${secret}`))) throw new AppError("UNAUTHENTICATED");
}
