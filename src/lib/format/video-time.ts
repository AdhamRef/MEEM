const UNITS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: "year", seconds: 31_536_000 },
  { unit: "month", seconds: 2_592_000 },
  { unit: "week", seconds: 604_800 },
  { unit: "day", seconds: 86_400 },
  { unit: "hour", seconds: 3600 },
  { unit: "minute", seconds: 60 },
];

/** A count as people read it at a glance: 1.2K, in Arabic. */
export function formatCount(count: number): string {
  return new Intl.NumberFormat("ar", { notation: "compact", maximumFractionDigits: 1 }).format(count);
}

/** The badge on a video's thumbnail: 0:45, 12:05, or 1:02:03. Null when the length isn't known. */
export function formatDuration(totalSeconds: number | null): string | null {
  if (totalSeconds === null || !Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;
  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** "3 days ago" in Arabic, in the largest unit that fits. Null when the date is missing or invalid. */
export function formatTimeAgo(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const elapsed = Math.max(0, (now.getTime() - then) / 1000);
  const format = new Intl.RelativeTimeFormat("ar", { numeric: "always" });
  for (const { unit, seconds } of UNITS) {
    if (elapsed >= seconds) return format.format(-Math.floor(elapsed / seconds), unit);
  }
  return format.format(-1, "minute");
}
