import { z } from "zod";
import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import { isQuotaExhausted, markQuotaExhausted, recordQuotaUse } from "./quota";

const API_BASE_URL = "https://www.googleapis.com/youtube/v3";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 200;

export type YouTubeErrorReason =
  | "NOT_CONFIGURED"
  | "QUOTA_EXCEEDED"
  | "CONFIGURATION_REJECTED"
  | "COMMENTS_DISABLED"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "TRANSIENT"
  | "INVALID_RESPONSE";

/** Internal only. It never carries the request URL, which contains the API key. */
export class YouTubeApiError extends Error {
  constructor(public readonly reason: YouTubeErrorReason) {
    super(`YouTube API request failed: ${reason}`);
    this.name = "YouTubeApiError";
  }
}

export function isYouTubeApiConfigured(): boolean {
  const { YOUTUBE_API_ENABLED, YOUTUBE_API_KEY } = getEnv();
  return YOUTUBE_API_ENABLED && Boolean(YOUTUBE_API_KEY);
}

const errorBodySchema = z.object({
  error: z.object({
    errors: z.array(z.object({ reason: z.string().optional() })).optional(),
  }),
});

const REASON_BY_API_REASON: Record<string, YouTubeErrorReason> = {
  quotaExceeded: "QUOTA_EXCEEDED",
  dailyLimitExceeded: "QUOTA_EXCEEDED",
  commentsDisabled: "COMMENTS_DISABLED",
  videoNotFound: "NOT_FOUND",
  playlistNotFound: "NOT_FOUND",
  playlistItemsNotAccessible: "NOT_FOUND",
  keyInvalid: "CONFIGURATION_REJECTED",
  keyExpired: "CONFIGURATION_REJECTED",
  accessNotConfigured: "CONFIGURATION_REJECTED",
  ipRefererBlocked: "CONFIGURATION_REJECTED",
  rateLimitExceeded: "TRANSIENT",
  userRateLimitExceeded: "TRANSIENT",
  backendError: "TRANSIENT",
};

function classifyFailure(status: number, body: unknown): YouTubeErrorReason {
  const parsed = errorBodySchema.safeParse(body);
  const apiReason = parsed.success ? parsed.data.error.errors?.[0]?.reason : undefined;
  const known = apiReason ? REASON_BY_API_REASON[apiReason] : undefined;
  if (known) return known;
  if (status >= 500 || status === 429) return "TRANSIENT";
  if (status === 404) return "NOT_FOUND";
  return status === 401 || status === 403 ? "CONFIGURATION_REJECTED" : "BAD_REQUEST";
}

export interface YouTubeRequest<Schema extends z.ZodType> {
  endpoint: string;
  params: Record<string, string>;
  schema: Schema;
  /** Quota cost from YouTube's published table, recorded per Pacific-time day. */
  quotaUnits: number;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The only caller of the YouTube Data API in the application. Only temporary failures are
 * retried. A quota error is final, and also stops further calls until YouTube's next reset.
 */
export async function youtubeRequest<Schema extends z.ZodType>({ endpoint, params, schema, quotaUnits }: YouTubeRequest<Schema>): Promise<z.output<Schema>> {
  const { YOUTUBE_API_KEY, YOUTUBE_API_ENABLED } = getEnv();
  if (!YOUTUBE_API_ENABLED || !YOUTUBE_API_KEY) throw new YouTubeApiError("NOT_CONFIGURED");
  if (await isQuotaExhausted()) throw new YouTubeApiError("QUOTA_EXCEEDED");

  const url = new URL(`${API_BASE_URL}/${endpoint}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set("key", YOUTUBE_API_KEY);

  for (let attempt = 1; ; attempt += 1) {
    let failure: YouTubeErrorReason;

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { Accept: "application/json" } });
      await recordQuotaUse(endpoint, quotaUnits);
      const body: unknown = await response.json().catch(() => null);

      if (response.ok) {
        const parsed = schema.safeParse(body);
        if (parsed.success) return parsed.data;
        logger.error("YouTube API returned an unexpected shape", { endpoint });
        throw new YouTubeApiError("INVALID_RESPONSE");
      }
      failure = classifyFailure(response.status, body);
    } catch (error) {
      if (error instanceof YouTubeApiError) throw error;
      // A network failure or timeout. The error may mention the URL, so it isn't logged.
      failure = "TRANSIENT";
    }

    if (failure === "QUOTA_EXCEEDED") await markQuotaExhausted();
    if (failure !== "TRANSIENT" || attempt >= MAX_ATTEMPTS) {
      logger.warn("YouTube API request failed", { endpoint, reason: failure, attempt });
      throw new YouTubeApiError(failure);
    }
    await wait(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
  }
}
