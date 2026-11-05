const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

const VIDEO_PATH_PREFIXES = new Set(["shorts", "embed", "live", "v"]);

export function isValidVideoId(value: string): boolean {
  return VIDEO_ID.test(value);
}

/**
 * Resolves a pasted ID or URL to a video ID, or null. Only known YouTube hosts count, so
 * a lookalike address is never trusted just because it contains something ID-shaped.
 */
export function parseYouTubeVideoId(input: string): string | null {
  const value = input.trim();
  if (isValidVideoId(value)) return value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  let candidate: string | null | undefined;
  if (host === "youtu.be") {
    candidate = segments[0];
  } else if (YOUTUBE_HOSTS.has(host)) {
    candidate = segments[0] === "watch" ? url.searchParams.get("v") : VIDEO_PATH_PREFIXES.has(segments[0] ?? "") ? segments[1] : null;
  }

  return candidate && isValidVideoId(candidate) ? candidate : null;
}

/**
 * Regular playlists and channel upload lists. Mixes (RD), Watch Later (WL), and Liked (LL) are
 * refused, because they belong to one viewer or are generated, and the API can't list them.
 */
const PLAYLIST_ID = /^(PL|UU|OL|FL)[A-Za-z0-9_-]{10,62}$/;

export function isValidPlaylistId(value: string): boolean {
  return PLAYLIST_ID.test(value);
}

/** Resolves a pasted ID or URL to a playlist ID, or null. Only known YouTube hosts count. */
export function parseYouTubePlaylistId(input: string): string | null {
  const value = input.trim();
  if (isValidPlaylistId(value)) return value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;

  const candidate = url.searchParams.get("list");
  return candidate && isValidPlaylistId(candidate) ? candidate : null;
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}
