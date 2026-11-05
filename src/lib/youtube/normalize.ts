import { z } from "zod";

const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

export function parseIsoDuration(value: string | undefined): number | null {
  const match = value ? ISO_DURATION.exec(value) : null;
  if (!match) return null;
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  return Number(days) * 86_400 + Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds);
}

/**
 * The API has no field saying a video is a Short, so this only suggests a kind for a person
 * to review. YouTube says Shorts run up to 3 minutes, which is the default threshold, and are
 * square or vertical, so a wide video is never a candidate however short it is.
 */
export function classifyByDuration(durationSeconds: number | null, maxShortSeconds: number, aspectRatio: number | null = null): "SHORT_CANDIDATE" | "LONG_FORM_CANDIDATE" {
  if (aspectRatio !== null && aspectRatio > 1) return "LONG_FORM_CANDIDATE";
  return durationSeconds !== null && durationSeconds > 0 && durationSeconds <= maxShortSeconds ? "SHORT_CANDIDATE" : "LONG_FORM_CANDIDATE";
}

const thumbnailSchema = z.object({ url: z.url(), width: z.number().optional(), height: z.number().optional() });

/** Every field the application doesn't strictly need is optional, as YouTube omits many of them. */
export const videoResourceSchema = z.object({
  id: z.string(),
  snippet: z.object({
    title: z.string(),
    description: z.string().optional(),
    channelId: z.string().optional(),
    channelTitle: z.string().optional(),
    publishedAt: z.string().optional(),
    tags: z.array(z.string()).optional(),
    thumbnails: z.record(z.string(), thumbnailSchema).optional(),
  }),
  contentDetails: z.object({ duration: z.string().optional() }).optional(),
  player: z.object({ embedWidth: z.coerce.number().optional(), embedHeight: z.coerce.number().optional() }).optional(),
  status: z
    .object({
      embeddable: z.boolean().optional(),
      privacyStatus: z.string().optional(),
      uploadStatus: z.string().optional(),
    })
    .optional(),
  statistics: z
    .object({
      viewCount: z.string().optional(),
      likeCount: z.string().optional(),
      commentCount: z.string().optional(),
    })
    .optional(),
});

export type VideoResource = z.infer<typeof videoResourceSchema>;

export interface NormalizedVideo {
  youtubeVideoId: string;
  title: string;
  description: string | null;
  channelYoutubeId: string | null;
  channelTitle: string | null;
  thumbnails: { quality: string; url: string; width: number | null; height: number | null }[];
  durationSeconds: number | null;
  /** Width divided by height. Null when YouTube doesn't report a size. */
  aspectRatio: number | null;
  tags: string[];
  ytPublishedAt: Date | null;
  availability: "AVAILABLE" | "UNAVAILABLE" | "NOT_EMBEDDABLE";
  statistics: { viewCount: bigint | null; likeCount: bigint | null; commentCount: bigint | null } | null;
}

function toCount(value: string | undefined): bigint | null {
  return value !== undefined && /^\d+$/.test(value) ? BigInt(value) : null;
}

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function availabilityOf(status: VideoResource["status"]): NormalizedVideo["availability"] {
  if (status?.privacyStatus === "private") return "UNAVAILABLE";
  if (status?.uploadStatus && status.uploadStatus !== "processed") return "UNAVAILABLE";
  return status?.embeddable === false ? "NOT_EMBEDDABLE" : "AVAILABLE";
}

/** YouTube titles and descriptions are kept exactly as returned, as the policies require. */
export function normalizeVideo(resource: VideoResource): NormalizedVideo {
  const { snippet, statistics } = resource;
  return {
    youtubeVideoId: resource.id,
    title: snippet.title,
    description: snippet.description || null,
    channelYoutubeId: snippet.channelId ?? null,
    channelTitle: snippet.channelTitle ?? null,
    thumbnails: Object.entries(snippet.thumbnails ?? {}).map(([quality, thumbnail]) => ({
      quality,
      url: thumbnail.url,
      width: thumbnail.width ?? null,
      height: thumbnail.height ?? null,
    })),
    durationSeconds: parseIsoDuration(resource.contentDetails?.duration),
    aspectRatio: resource.player?.embedWidth && resource.player.embedHeight ? resource.player.embedWidth / resource.player.embedHeight : null,
    tags: snippet.tags ?? [],
    ytPublishedAt: toDate(snippet.publishedAt),
    availability: availabilityOf(resource.status),
    // Absent counts stay absent. They are never filled in with zero.
    statistics: statistics
      ? { viewCount: toCount(statistics.viewCount), likeCount: toCount(statistics.likeCount), commentCount: toCount(statistics.commentCount) }
      : null,
  };
}

const THUMBNAIL_PREFERENCE = ["high", "standard", "medium", "maxres", "default"];

/** "high" is sharp enough for a phone without the weight of maxres, which many videos lack. */
export function pickThumbnailUrl(thumbnails: { quality: string; url: string }[]): string | null {
  for (const quality of THUMBNAIL_PREFERENCE) {
    const match = thumbnails.find((thumbnail) => thumbnail.quality === quality);
    if (match) return match.url;
  }
  return thumbnails[0]?.url ?? null;
}
