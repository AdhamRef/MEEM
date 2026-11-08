import { z } from "zod";
import { youtubeRequest } from "./client";

/** Both lists accept up to 50 per request, for 1 quota unit. */
export const PLAYLISTS_PER_REQUEST = 50;

const thumbnailSchema = z.object({ url: z.url(), width: z.number().optional(), height: z.number().optional() });

const playlistResourceSchema = z.object({
  id: z.string(),
  snippet: z.object({
    title: z.string(),
    description: z.string().optional(),
    channelId: z.string().optional(),
    channelTitle: z.string().optional(),
    thumbnails: z.record(z.string(), thumbnailSchema).optional(),
  }),
  contentDetails: z.object({ itemCount: z.number().optional() }).optional(),
});

const playlistsResponseSchema = z.object({ nextPageToken: z.string().optional(), items: z.array(playlistResourceSchema).default([]) });

const playlistItemsResponseSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z
    .array(
      z.object({
        contentDetails: z.object({ videoId: z.string().optional() }).optional(),
        status: z.object({ privacyStatus: z.string().optional() }).optional(),
      }),
    )
    .default([]),
});

export interface NormalizedPlaylist {
  youtubePlaylistId: string;
  /** Exactly as YouTube returned it. */
  title: string;
  description: string | null;
  channelYoutubeId: string | null;
  channelTitle: string | null;
  thumbnails: { quality: string; url: string; width: number | null; height: number | null }[];
}

/** An ID missing from the result means the playlist is gone, or is private. */
export async function fetchPlaylistMetadata(playlistId: string): Promise<ChannelPlaylist | null> {
  const { items } = await youtubeRequest({
    endpoint: "playlists",
    params: { part: "snippet,contentDetails", id: playlistId, maxResults: "1" },
    schema: playlistsResponseSchema,
    quotaUnits: 1,
  });
  const resource = items[0];
  return resource ? { ...normalizePlaylist(resource), itemCount: resource.contentDetails?.itemCount ?? null } : null;
}

function normalizePlaylist(resource: z.infer<typeof playlistResourceSchema>): NormalizedPlaylist {
  return {
    youtubePlaylistId: resource.id,
    title: resource.snippet.title,
    description: resource.snippet.description || null,
    channelYoutubeId: resource.snippet.channelId ?? null,
    channelTitle: resource.snippet.channelTitle ?? null,
    thumbnails: Object.entries(resource.snippet.thumbnails ?? {}).map(([quality, thumbnail]) => ({
      quality,
      url: thumbnail.url,
      width: thumbnail.width ?? null,
      height: thumbnail.height ?? null,
    })),
  };
}

export interface ChannelPlaylist extends NormalizedPlaylist {
  /** As YouTube reports it, which counts private and deleted items too. */
  itemCount: number | null;
}

/** One page of a channel's public playlists, 50 for 1 quota unit. Never the search endpoint. */
export async function fetchChannelPlaylistsPage(channelYoutubeId: string, pageToken: string | null): Promise<{ playlists: ChannelPlaylist[]; nextPageToken: string | null }> {
  const page = await youtubeRequest({
    endpoint: "playlists",
    params: { part: "snippet,contentDetails", channelId: channelYoutubeId, maxResults: String(PLAYLISTS_PER_REQUEST), ...(pageToken ? { pageToken } : {}) },
    schema: playlistsResponseSchema,
    quotaUnits: 1,
  });
  return {
    playlists: page.items.map((resource) => ({ ...normalizePlaylist(resource), itemCount: resource.contentDetails?.itemCount ?? null })),
    nextPageToken: page.nextPageToken ?? null,
  };
}

/**
 * Video IDs in YouTube's order, one page per quota unit, stopping at the limit. Private items
 * are skipped because nobody could play them. Deleted ones are noticed later by videos.list.
 */
export async function fetchPlaylistVideoIds(playlistId: string, maxItems: number): Promise<{ videoIds: string[]; isTruncated: boolean }> {
  const videoIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const page = await youtubeRequest({
      endpoint: "playlistItems",
      params: { part: "contentDetails,status", playlistId, maxResults: String(PLAYLISTS_PER_REQUEST), ...(pageToken ? { pageToken } : {}) },
      schema: playlistItemsResponseSchema,
      quotaUnits: 1,
    });
    for (const item of page.items) {
      const videoId = item.contentDetails?.videoId;
      if (videoId && item.status?.privacyStatus !== "private") videoIds.push(videoId);
    }
    pageToken = page.nextPageToken;
  } while (pageToken && videoIds.length < maxItems);

  const unique = [...new Set(videoIds)];
  return { videoIds: unique.slice(0, maxItems), isTruncated: Boolean(pageToken) || unique.length > maxItems };
}
