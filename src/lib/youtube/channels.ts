import { z } from "zod";
import { youtubeRequest } from "./client";

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE = /^@[\p{L}\p{N}._-]{3,60}$/u;
const USERNAME = /^[A-Za-z0-9]{1,60}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

export type ChannelReference =
  | { kind: "id"; value: string }
  | { kind: "handle"; value: string }
  | { kind: "username"; value: string }
  /** A /c/ address. The API can't resolve these, so the person is asked for the handle (limit L8). */
  | { kind: "legacy" };

/** Only a validated reference ever reaches YouTube, never the text that was pasted (§21). */
export function parseChannelInput(input: string): ChannelReference | null {
  const value = input.trim();
  if (CHANNEL_ID.test(value)) return { kind: "id", value };
  if (HANDLE.test(value)) return { kind: "handle", value };
  if (!value.includes("/") && !value.includes(":")) {
    const asHandle = `@${value}`;
    return HANDLE.test(asHandle) ? { kind: "handle", value: asHandle } : null;
  }

  let url: URL;
  try {
    url = new URL(value.startsWith("http") ? value : `https://${value}`);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !HOSTS.has(url.hostname.toLowerCase())) return null;

  const [first, second] = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return "";
      }
    });
  if (!first) return null;
  if (HANDLE.test(first)) return { kind: "handle", value: first };
  if (first === "channel" && second && CHANNEL_ID.test(second)) return { kind: "id", value: second };
  if (first === "user" && second && USERNAME.test(second)) return { kind: "username", value: second };
  if (first === "c" && second) return { kind: "legacy" };
  return null;
}

const channelsResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({
          title: z.string(),
          description: z.string().optional(),
          customUrl: z.string().optional(),
          thumbnails: z.record(z.string(), z.object({ url: z.url() })).optional(),
        }),
        contentDetails: z.object({ relatedPlaylists: z.object({ uploads: z.string().optional() }).optional() }).optional(),
      }),
    )
    .default([]),
});

export interface NormalizedChannel {
  youtubeChannelId: string;
  title: string;
  description: string | null;
  handle: string | null;
  thumbnailUrl: string | null;
  uploadsPlaylistId: string | null;
}

type ChannelResource = z.infer<typeof channelsResponseSchema>["items"][number];

function normalizeChannel(resource: ChannelResource): NormalizedChannel {
  const thumbnails = resource.snippet.thumbnails;
  return {
    youtubeChannelId: resource.id,
    title: resource.snippet.title,
    description: resource.snippet.description || null,
    handle: resource.snippet.customUrl ?? null,
    thumbnailUrl: thumbnails?.medium?.url ?? thumbnails?.high?.url ?? thumbnails?.default?.url ?? null,
    uploadsPlaylistId: resource.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

const PARTS = "snippet,contentDetails";

export async function resolveChannel(reference: Exclude<ChannelReference, { kind: "legacy" }>): Promise<NormalizedChannel | null> {
  const lookup: Record<string, string> = reference.kind === "id" ? { id: reference.value } : reference.kind === "handle" ? { forHandle: reference.value } : { forUsername: reference.value };
  const { items } = await youtubeRequest({ endpoint: "channels", params: { part: PARTS, ...lookup }, schema: channelsResponseSchema, quotaUnits: 1 });
  return items[0] ? normalizeChannel(items[0]) : null;
}

/** Up to 50 IDs. An ID missing from the result means the channel is gone. */
export async function fetchChannelBatch(channelIds: string[]): Promise<NormalizedChannel[]> {
  if (channelIds.length === 0) return [];
  const { items } = await youtubeRequest({ endpoint: "channels", params: { part: PARTS, id: channelIds.join(","), maxResults: "50" }, schema: channelsResponseSchema, quotaUnits: 1 });
  return items.map(normalizeChannel);
}

const uploadsPageSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z.array(z.object({ contentDetails: z.object({ videoId: z.string().optional() }).optional(), status: z.object({ privacyStatus: z.string().optional() }).optional() })).default([]),
});

/** One page of a channel's uploads, newest first, for 1 quota unit. Never the search endpoint. */
export async function fetchUploadsPage(uploadsPlaylistId: string, pageToken: string | null): Promise<{ videoIds: string[]; nextPageToken: string | null }> {
  const page = await youtubeRequest({
    endpoint: "playlistItems",
    params: { part: "contentDetails,status", playlistId: uploadsPlaylistId, maxResults: "50", ...(pageToken ? { pageToken } : {}) },
    schema: uploadsPageSchema,
    quotaUnits: 1,
  });
  const videoIds = page.items.flatMap((item) => (item.contentDetails?.videoId && item.status?.privacyStatus !== "private" ? [item.contentDetails.videoId] : []));
  return { videoIds, nextPageToken: page.nextPageToken ?? null };
}
