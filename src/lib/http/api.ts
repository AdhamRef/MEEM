import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { getEnv } from "@/config/env";
import { AppError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";

const MAX_JSON_BODY_CHARACTERS = 64 * 1024;

/** Turns thrown errors into safe JSON, so a route can never leak a stack trace. */
export function apiHandler<Context>(handler: (request: NextRequest, context: Context) => Promise<Response>) {
  return async (request: NextRequest, context: Context): Promise<Response> => {
    try {
      return await handler(request, context);
    } catch (error) {
      const publicError = toPublicError(error);
      if (publicError.status >= 500) {
        logger.error("API request failed", { path: request.nextUrl.pathname, method: request.method, error });
      }
      return NextResponse.json({ error: { code: publicError.code, message: publicError.message } }, { status: publicError.status });
    }
  };
}

/**
 * A cookie-authenticated write must come from this site. The session cookie's SameSite
 * setting already stops most cross-site requests, and this is the second layer.
 * The Host header also counts, so testing from a phone on the local network still works.
 */
export function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (!origin) throw new AppError("FORBIDDEN");

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new AppError("FORBIDDEN");
  }

  const isAppOrigin = originUrl.origin === new URL(getEnv().APP_URL).origin;
  if (!isAppOrigin && originUrl.host !== request.headers.get("host")) throw new AppError("FORBIDDEN");
}

export async function readJsonBody<Schema extends z.ZodType>(request: NextRequest, schema: Schema): Promise<z.output<Schema>> {
  const text = await request.text();
  if (text.length > MAX_JSON_BODY_CHARACTERS) throw new AppError("VALIDATION");

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError("VALIDATION");
  return parsed.data;
}
