import { z } from "zod";
import { objectIdSchema } from "@/features/categories/schemas";

const MAX_FEED_KEY = 2 ** 31;

const positionSchema = z.strictObject({
  /** The last feedKey and ID served from this category. */
  k: z.number().int().min(0).max(MAX_FEED_KEY),
  i: objectIdSchema,
  /** True once reading has passed the end and wrapped to below the start key. */
  w: z.boolean(),
});

export const feedCursorSchema = z.strictObject({
  /** Where this session started in the feedKey order, so each visit doesn't open the same way. */
  s: z.number().int().min(0).max(MAX_FEED_KEY),
  /** Page number, which seeds that page's choices. */
  n: z.number().int().min(0).max(1_000_000),
  p: z.record(objectIdSchema, positionSchema),
  /** Categories with nothing left. */
  d: z.array(objectIdSchema).max(500),
});

export type FeedCursor = z.infer<typeof feedCursorSchema>;
export type CategoryPosition = z.infer<typeof positionSchema>;

export function encodeFeedCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Null when malformed. A cursor is only a position, so a tampered one can't reveal anything. */
export function decodeFeedCursor(raw: string): FeedCursor | null {
  if (raw.length > 16_384) return null;
  try {
    const parsed = feedCursorSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function newFeedCursor(startKey: number): FeedCursor {
  return { s: startKey, n: 0, p: {}, d: [] };
}
