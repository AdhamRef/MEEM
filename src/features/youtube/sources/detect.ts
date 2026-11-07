import { parseChannelInput, type ChannelReference } from "@/lib/youtube/channels";
import { parseYouTubePlaylistId, parseYouTubeVideoId } from "@/lib/youtube/ids";

export type SourceInput =
  | { kind: "channel"; reference: Exclude<ChannelReference, { kind: "legacy" }> }
  | { kind: "legacyChannel" }
  | { kind: "playlist"; youtubePlaylistId: string }
  | { kind: "videos"; youtubeVideoIds: string[] }
  | { kind: "invalid" };

/** One paste can hold several video links, but a channel or playlist is added on its own. */
export const MAX_VIDEOS_PER_PASTE = 50;

function detectOne(value: string): SourceInput {
  // A handle or a channel address is unambiguous, so it's checked before anything ID-shaped.
  if (value.startsWith("@") || /\/(channel|user|c)\/|\/@/.test(value)) {
    const reference = parseChannelInput(value);
    if (!reference) return { kind: "invalid" };
    return reference.kind === "legacy" ? { kind: "legacyChannel" } : { kind: "channel", reference };
  }

  // A watch link inside a playlist means the video. Only a playlist page or a bare ID means the list.
  const isPlaylistPage = /\/playlist(\?|$)/.test(value) || !value.includes("/");
  const playlistId = isPlaylistPage ? parseYouTubePlaylistId(value) : null;
  if (playlistId) return { kind: "playlist", youtubePlaylistId: playlistId };

  const videoId = parseYouTubeVideoId(value);
  if (videoId) return { kind: "videos", youtubeVideoIds: [videoId] };

  const reference = parseChannelInput(value);
  if (reference) return reference.kind === "legacy" ? { kind: "legacyChannel" } : { kind: "channel", reference };
  return { kind: "invalid" };
}

/**
 * Works out what a pasted link is: a channel, a playlist, or one or more videos. Only the IDs
 * found here ever reach YouTube, never the pasted text (§21).
 */
export function detectSourceInput(raw: string): SourceInput {
  const lines = raw
    .split(/[\s,]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { kind: "invalid" };
  if (lines.length === 1) return detectOne(lines[0]!);

  // Several at once only make sense as videos.
  if (lines.length > MAX_VIDEOS_PER_PASTE) return { kind: "invalid" };
  const ids = new Set<string>();
  for (const line of lines) {
    const detected = detectOne(line);
    if (detected.kind !== "videos") return { kind: "invalid" };
    for (const id of detected.youtubeVideoIds) ids.add(id);
  }
  return { kind: "videos", youtubeVideoIds: [...ids] };
}
