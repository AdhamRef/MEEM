/**
 * Reads a YouTube description as it's stored, to make timestamps seekable and links clickable.
 * It never changes the text: every segment joins back to exactly the original.
 */

export type DescriptionSegment = { type: "text"; text: string } | { type: "link"; text: string; href: string } | { type: "time"; text: string; seconds: number };

export interface Chapter {
  seconds: number;
  title: string;
}

// h:mm:ss or m:ss, standing on its own rather than inside a longer number such as a ratio.
const TIMESTAMP = /(?<![\d:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?![\d:])/;
const URL_PATTERN = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}،؛]/;
const TOKEN = new RegExp(`${URL_PATTERN.source}|${TIMESTAMP.source}`, "g");
const MIN_CHAPTERS = 3;

/** Seconds for "1:02:03" or "2:03", or null when it isn't a valid time. */
export function parseTimestamp(text: string): number | null {
  const match = new RegExp(`^${TIMESTAMP.source}$`).exec(text.trim());
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  const m = Number(minutes);
  const s = Number(seconds);
  if (s > 59 || (hours !== undefined && m > 59)) return null;
  return Number(hours ?? 0) * 3600 + m * 60 + s;
}

function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Splits a description into plain text, links, and timestamps. Times past the video's length stay text. */
export function splitDescription(text: string, durationSeconds: number | null = null): DescriptionSegment[] {
  const segments: DescriptionSegment[] = [];
  let last = 0;
  const push = (segment: DescriptionSegment) => {
    const previous = segments.at(-1);
    if (segment.type === "text" && previous?.type === "text") previous.text += segment.text;
    else segments.push(segment);
  };

  for (const match of text.matchAll(TOKEN)) {
    const value = match[0];
    const index = match.index;
    if (index > last) push({ type: "text", text: text.slice(last, index) });
    last = index + value.length;

    if (value.startsWith("http")) {
      const href = safeHref(value);
      push(href ? { type: "link", text: value, href } : { type: "text", text: value });
      continue;
    }
    const seconds = parseTimestamp(value);
    const fits = seconds !== null && (durationSeconds === null || seconds <= durationSeconds);
    push(fits ? { type: "time", text: value, seconds } : { type: "text", text: value });
  }
  if (last < text.length) push({ type: "text", text: text.slice(last) });
  return segments;
}

/**
 * Chapters the way YouTube reads them: lines starting with a timestamp, the first at 0:00, at
 * least three, and in increasing order. Anything else isn't treated as chapters.
 */
export function extractChapters(text: string | null, durationSeconds: number | null = null): Chapter[] {
  if (!text) return [];
  const chapters: Chapter[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*[-–•▶►]?\s*\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–—:|.]?\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const seconds = parseTimestamp(match[1]!);
    const title = match[2]!.trim();
    if (seconds === null || !title) continue;
    if (durationSeconds !== null && seconds > durationSeconds) continue;
    if (chapters.length && seconds <= chapters.at(-1)!.seconds) return [];
    chapters.push({ seconds, title });
  }
  if (chapters.length < MIN_CHAPTERS || chapters[0]!.seconds !== 0) return [];
  return chapters;
}

/** The chapter playing at a position, for highlighting it. */
export function chapterAt(chapters: Chapter[], positionSeconds: number): number {
  let current = -1;
  for (const [index, chapter] of chapters.entries()) if (chapter.seconds <= positionSeconds) current = index;
  return current;
}
