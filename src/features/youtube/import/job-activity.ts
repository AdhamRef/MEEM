/** Client-safe rules for what an import job is really doing, with no database access. */

export type JobStatus = "DISCOVERING" | "READY_FOR_REVIEW" | "IMPORTING" | "PAUSED" | "COMPLETED" | "CANCELLED" | "FAILED";

export interface JobForRunning {
  id: string;
  channelId: string;
  status: JobStatus;
  /** When the server last saved anything for this job. */
  updatedAt: string;
}

export type JobActivity =
  | "RUNNING_HERE" // This page is working on it right now.
  | "RUNNING_ELSEWHERE" // Moved recently, but not because of this page.
  | "WAITING" // Will run here, after the ones ahead of it.
  | "WAITING_FOR_SAME_CHANNEL" // Another job for this channel goes first.
  | "HALTED" // Unfinished, and nothing is working on it.
  | "FAILED" // The last step failed, and it needs someone to retry.
  | "SETTLED"; // Its status says what it needs: review, resume, or nothing.

/** A step takes seconds, even on a slow connection, so this long without progress means it stopped. */
export const STALE_AFTER_MS = 60_000;

export const canRunUnattended = (status: JobStatus) => status === "DISCOVERING" || status === "IMPORTING";

/**
 * Which job this page should work on next: oldest first, one at a time, so quota use stays
 * easy to follow. Two jobs for one channel would fetch the same videos and spend quota twice,
 * so only the oldest of them runs.
 */
export function nextJobToRun<Job extends JobForRunning>(jobs: Job[], skip: ReadonlySet<string>): Job | null {
  const oldestFirst = [...jobs].reverse();
  const seenChannels = new Set<string>();
  for (const job of oldestFirst) {
    if (!canRunUnattended(job.status)) continue;
    const isSecondForChannel = seenChannels.has(job.channelId);
    seenChannels.add(job.channelId);
    if (!isSecondForChannel && !skip.has(job.id)) return job;
  }
  return null;
}

export function describeActivity(job: JobForRunning, jobs: JobForRunning[], state: { runningId: string | null; failedIds: ReadonlySet<string>; isPaused: boolean; now: number }): JobActivity {
  if (state.runningId === job.id) return "RUNNING_HERE";
  if (state.failedIds.has(job.id)) return "FAILED";
  if (!canRunUnattended(job.status)) return "SETTLED";
  if (state.now - new Date(job.updatedAt).getTime() < STALE_AFTER_MS) return "RUNNING_ELSEWHERE";
  if (state.isPaused) return "HALTED";

  const isBehindSameChannel = [...jobs].reverse().find((other) => other.channelId === job.channelId && canRunUnattended(other.status))?.id !== job.id;
  return isBehindSameChannel ? "WAITING_FOR_SAME_CHANNEL" : "WAITING";
}

/** How long a set of videos runs, for a sense of its size. */
export function formatTotalDuration(totalSeconds: number, hoursMinutes: (hours: number, minutes: number) => string, minutesOnly: (minutes: number) => string): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours > 0 ? hoursMinutes(hours, minutes) : minutesOnly(minutes);
}

/** Whole seconds since the last progress. Never negative, even if clocks differ. */
export const secondsSince = (since: string | number, now: number) => Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));

/**
 * Stops two tabs working on one job, which would spend quota twice. Browsers that can't do this
 * (a plain http address other than localhost) simply run it, because the unique index still
 * prevents duplicates. Returns false if another tab holds the job.
 */
export async function withJobLock(jobId: string, work: () => Promise<void>): Promise<boolean> {
  if (typeof navigator === "undefined" || !("locks" in navigator)) {
    await work();
    return true;
  }
  return navigator.locks.request(`import-job-${jobId}`, { ifAvailable: true }, async (lock) => {
    if (!lock) return false;
    await work();
    return true;
  });
}
