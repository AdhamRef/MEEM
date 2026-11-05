import type { Prisma } from "@prisma/client";
import type { NormalizedVideo } from "@/lib/youtube/normalize";
import { buildSearchText, normalizeArabicForSearch } from "@/lib/search/normalize";

/** The fields that come from YouTube. Everything else on a video belongs to editors. */
export function youtubeFields(video: NormalizedVideo, options: { includeStatistics: boolean; now: Date }) {
  return {
    title: video.title,
    description: video.description,
    channelTitle: video.channelTitle,
    thumbnails: video.thumbnails,
    durationSeconds: video.durationSeconds,
    aspectRatio: video.aspectRatio,
    tags: video.tags,
    ytPublishedAt: video.ytPublishedAt,
    availability: video.availability,
    metadataFetchedAt: options.now,
    stats:
      options.includeStatistics && video.statistics
        ? { ...video.statistics, fetchedAt: options.now }
        : null,
    titleSearch: normalizeArabicForSearch(video.title),
    searchText: buildSearchText([video.title, video.description, video.channelTitle, ...video.tags]),
  } satisfies Prisma.VideoUncheckedUpdateInput;
}

/**
 * What remains once YouTube's data must go: a video removed from YouTube, or data past the
 * 30-day limit. The record, and everything linking to it, stays. It reappears when a later
 * refresh gets fresh data, and public queries skip it until then.
 */
export function clearedYouTubeFields(availability: "UNKNOWN" | "UNAVAILABLE") {
  return {
    title: "",
    description: null,
    channelTitle: null,
    thumbnails: [],
    durationSeconds: null,
    aspectRatio: null,
    tags: [],
    ytPublishedAt: null,
    stats: null,
    availability,
    titleSearch: "",
    searchText: "",
  } satisfies Prisma.VideoUncheckedUpdateManyInput;
}
