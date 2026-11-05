import { z } from "zod";
import { youtubeRequest } from "./client";
import { normalizeVideo, videoResourceSchema, type NormalizedVideo } from "./normalize";

/** videos.list accepts 50 IDs per request, for 1 quota unit. */
export const VIDEOS_PER_REQUEST = 50;

const videosResponseSchema = z.object({ items: z.array(videoResourceSchema).default([]) });

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

/** Up to 50 IDs. An ID missing from the result means YouTube no longer has that video. */
export async function fetchVideoBatch(videoIds: string[], options: { includeStatistics: boolean }): Promise<NormalizedVideo[]> {
  if (videoIds.length > VIDEOS_PER_REQUEST) throw new RangeError("Too many video IDs for one request");
  if (videoIds.length === 0) return [];

  const parts = ["snippet", "contentDetails", "status", "player", ...(options.includeStatistics ? ["statistics"] : [])];
  const { items } = await youtubeRequest({
    endpoint: "videos",
    // Asking for a maximum height is what makes YouTube report the video's real proportions.
    params: { part: parts.join(","), id: videoIds.join(","), maxResults: String(VIDEOS_PER_REQUEST), maxHeight: "1080" },
    schema: videosResponseSchema,
    quotaUnits: 1,
  });
  return items.map(normalizeVideo);
}
