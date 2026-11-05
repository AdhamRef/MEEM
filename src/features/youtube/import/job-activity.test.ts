import { describe, expect, it } from "vitest";
import { describeActivity, formatTotalDuration, nextJobToRun, secondsSince, STALE_AFTER_MS, type JobForRunning } from "./job-activity";

const NOW = Date.UTC(2026, 0, 1, 12);
const old = new Date(NOW - STALE_AFTER_MS - 1000).toISOString();
const recent = new Date(NOW - 1000).toISOString();

const job = (id: string, overrides: Partial<JobForRunning> = {}): JobForRunning => ({ id, channelId: `channel-${id}`, status: "DISCOVERING", updatedAt: old, ...overrides });
const state = (overrides: Partial<Parameters<typeof describeActivity>[2]> = {}) => ({ runningId: null, failedIds: new Set<string>(), isPaused: false, now: NOW, ...overrides });

describe("nextJobToRun", () => {
  // Lists arrive newest first, as the page shows them.
  it("takes the oldest unfinished job", () => {
    expect(nextJobToRun([job("new"), job("old")], new Set())?.id).toBe("old");
  });

  it("runs discovery and importing, but nothing that needs a person", () => {
    const jobs = [job("a", { status: "READY_FOR_REVIEW" }), job("b", { status: "PAUSED" }), job("c", { status: "COMPLETED" }), job("d", { status: "CANCELLED" })];
    expect(nextJobToRun(jobs, new Set())).toBeNull();
    expect(nextJobToRun([job("e", { status: "IMPORTING" }), ...jobs], new Set())?.id).toBe("e");
  });

  it("passes over failed jobs, so one bad job doesn't hold up the rest", () => {
    expect(nextJobToRun([job("new"), job("old")], new Set(["old"]))?.id).toBe("new");
  });

  it("runs only one job per channel, so quota isn't spent twice on the same videos", () => {
    const jobs = [job("sync", { channelId: "same" }), job("import", { channelId: "same" })];
    expect(nextJobToRun(jobs, new Set())?.id).toBe("import");
    expect(nextJobToRun(jobs, new Set(["import"]))).toBeNull();
  });

  it("lets the second job run once the first has moved on", () => {
    const jobs = [job("sync", { channelId: "same" }), job("import", { channelId: "same", status: "READY_FOR_REVIEW" })];
    expect(nextJobToRun(jobs, new Set())?.id).toBe("sync");
  });

  it("has nothing to do with no jobs", () => {
    expect(nextJobToRun([], new Set())).toBeNull();
  });
});

describe("describeActivity never claims work that isn't happening", () => {
  it("says running only for the job this page is working on", () => {
    const jobs = [job("a"), job("b")];
    expect(describeActivity(jobs[0]!, jobs, state({ runningId: "a" }))).toBe("RUNNING_HERE");
    expect(describeActivity(jobs[1]!, jobs, state({ runningId: "a" }))).toBe("WAITING");
  });

  it("says stopped, rather than fetching, when paused with no recent progress", () => {
    const jobs = [job("a")];
    expect(describeActivity(jobs[0]!, jobs, state({ isPaused: true }))).toBe("HALTED");
  });

  it("recognises progress made somewhere else", () => {
    const jobs = [job("a", { updatedAt: recent })];
    expect(describeActivity(jobs[0]!, jobs, state())).toBe("RUNNING_ELSEWHERE");
    expect(describeActivity(jobs[0]!, jobs, state({ isPaused: true }))).toBe("RUNNING_ELSEWHERE");
  });

  it("reports a failed step above everything except running it again", () => {
    const jobs = [job("a", { updatedAt: recent })];
    expect(describeActivity(jobs[0]!, jobs, state({ failedIds: new Set(["a"]) }))).toBe("FAILED");
    expect(describeActivity(jobs[0]!, jobs, state({ failedIds: new Set(["a"]), runningId: "a" }))).toBe("RUNNING_HERE");
  });

  it("explains a job held back by another for the same channel", () => {
    const jobs = [job("sync", { channelId: "same" }), job("import", { channelId: "same" })];
    expect(describeActivity(jobs[0]!, jobs, state())).toBe("WAITING_FOR_SAME_CHANNEL");
    expect(describeActivity(jobs[1]!, jobs, state())).toBe("WAITING");
  });

  it("leaves finished and review states to their own labels", () => {
    const jobs = [job("a", { status: "READY_FOR_REVIEW" })];
    expect(describeActivity(jobs[0]!, jobs, state())).toBe("SETTLED");
  });
});

describe("formatTotalDuration", () => {
  const format = (seconds: number) => formatTotalDuration(seconds, (hours, minutes) => `${hours}h ${minutes}m`, (minutes) => `${minutes}m`);
  it("uses hours once there are any", () => {
    expect(format(3 * 3600 + 25 * 60 + 10)).toBe("3h 25m");
    expect(format(45 * 60)).toBe("45m");
    expect(format(0)).toBe("0m");
  });
});

describe("secondsSince", () => {
  it("counts whole seconds, and is never negative", () => {
    expect(secondsSince(NOW - 5500, NOW)).toBe(5);
    expect(secondsSince(NOW + 5000, NOW)).toBe(0);
  });
});
