import { z } from "zod";
import { objectIdSchema } from "@/features/topics/schemas";

const MAX_FEED_KEY = 2 ** 31;

export const feedCursorSchema = z.strictObject({
  /** Where this session started in the feedKey order, so each visit doesn't open the same way. */
  s: z.number().int().min(0).max(MAX_FEED_KEY),
  /** Page number, which seeds that page's choices. */
  n: z.number().int().min(0).max(1_000_000),
  /** How many have been read from each channel, shortened by poolKey. */
  o: z.record(z.string().regex(/^[0-9a-f]{16}$/), z.number().int().min(0).max(1_000_000)),
  /** The channels shown last, oldest first, so spacing carries across pages. */
  r: z.array(objectIdSchema).max(50),
});

export type FeedCursor = z.infer<typeof feedCursorSchema>;

const ID_TAIL = 16;

/** Keeps a long session's cursor small. A clash could only skip a few videos until the next round. */
export function poolKey(channelId: string | null): string {
  return (channelId ?? "0".repeat(ID_TAIL)).slice(-ID_TAIL);
}

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
  return { s: startKey, n: 0, o: {}, r: [] };
}
