/** Null unless the new order holds exactly the current items, so a stale screen can't lose or repeat one. */
export function validateReorder(currentIds: string[], orderedIds: string[]): string[] | null {
  if (currentIds.length !== orderedIds.length) return null;
  const current = new Set(currentIds);
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (!current.has(id) || seen.has(id)) return null;
    seen.add(id);
  }
  return orderedIds;
}

export function moveItem<Item>(items: Item[], from: number, to: number): Item[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as Item);
  return next;
}

/** A person who reached nearly the end has finished, since credits rarely get watched. */
const COMPLETION_RATIO = 0.95;

export function isWatchComplete(positionSeconds: number, durationSeconds: number | null, didEnd: boolean): boolean {
  if (didEnd) return true;
  return durationSeconds !== null && durationSeconds > 0 && positionSeconds / durationSeconds >= COMPLETION_RATIO;
}

/** Resuming within the first moments, or at the very end, would help nobody. */
export function resumePosition(progress: { positionSeconds: number; isCompleted: boolean } | null | undefined): number | null {
  if (!progress || progress.isCompleted || progress.positionSeconds < 5) return null;
  return progress.positionSeconds;
}

export function formatDuration(totalSeconds: number | null): string | null {
  if (totalSeconds === null || totalSeconds <= 0) return null;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
