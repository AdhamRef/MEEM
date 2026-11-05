import type { RecommendationSignal } from "./scoring";

export interface WatchSummary {
  /** The player really reported playing. Scrolling past a video that never started means nothing. */
  didStartPlaying: boolean;
  didEnd: boolean;
  watchedSeconds: number;
  durationSeconds: number | null;
}

const COMPLETED_SHARE = 0.9;
const EARLY_SKIP_SECONDS = 3;
const EARLY_SKIP_SHARE = 0.2;

/** Turns what was observed into a signal, or none. Everything between the extremes says nothing. */
export function signalFromWatch({ didStartPlaying, didEnd, watchedSeconds, durationSeconds }: WatchSummary): Extract<RecommendationSignal, "completion" | "earlySkip"> | null {
  if (!didStartPlaying) return null;
  if (didEnd) return "completion";

  if (durationSeconds && durationSeconds > 0) {
    if (watchedSeconds >= durationSeconds * COMPLETED_SHARE) return "completion";
    if (watchedSeconds < Math.min(EARLY_SKIP_SECONDS, durationSeconds * EARLY_SKIP_SHARE)) return "earlySkip";
    return null;
  }
  return watchedSeconds < EARLY_SKIP_SECONDS ? "earlySkip" : null;
}
