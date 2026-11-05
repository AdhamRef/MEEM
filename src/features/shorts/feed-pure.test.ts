import { describe, expect, it } from "vitest";
import { clearGuestSignals, GUEST_SIGNALS_KEY, readGuestBehaviour, recordGuestSignal } from "@/features/recommendations/guest-signals";
import { DEFAULT_SCORING_CONFIG, type CategoryScore } from "@/features/recommendations/scoring";
import { signalFromWatch } from "@/features/recommendations/watch-rules";
import { allocateCategorySlots, seededRandom, spreadByGroup } from "./allocation";
import { decodeFeedCursor, encodeFeedCursor, newFeedCursor } from "./cursor";

const score = (categoryId: string, value: number): CategoryScore => ({ categoryId, score: value, interestPart: value, behaviourPart: 0 });
const sum = (counts: Map<string, number>) => [...counts.values()].reduce((total, count) => total + count, 0);
const ID_A = "a".repeat(24);
const ID_B = "b".repeat(24);

describe("allocateCategorySlots", () => {
  const ranked = [score("chosen", 10), score("other-1", 0), score("other-2", 0), score("other-3", 0)];

  it("always fills the page exactly", () => {
    for (const pageSize of [1, 2, 3, 8, 20]) {
      expect(sum(allocateCategorySlots({ ranked, pageSize, explorationShare: 0.2, seed: 1 }))).toBe(pageSize);
    }
  });

  it("gives most slots to chosen categories and the configured share to others (§9.4)", () => {
    const counts = allocateCategorySlots({ ranked, pageSize: 10, explorationShare: 0.2, seed: 1 });
    expect(counts.get("chosen")).toBe(8);
    expect(sum(counts) - counts.get("chosen")!).toBe(2);
  });

  it("follows a different configured share", () => {
    expect(allocateCategorySlots({ ranked, pageSize: 10, explorationShare: 0.5, seed: 1 }).get("chosen")).toBe(5);
  });

  it("can turn exploration off", () => {
    const counts = allocateCategorySlots({ ranked, pageSize: 10, explorationShare: 0, seed: 1 });
    expect(counts.get("chosen")).toBe(10);
    expect(counts.size).toBe(1);
  });

  it("still explores on a small page", () => {
    const counts = allocateCategorySlots({ ranked, pageSize: 3, explorationShare: 0.1, seed: 1 });
    expect(sum(counts) - counts.get("chosen")!).toBe(1);
  });

  it("shares the main slots in proportion to score", () => {
    const counts = allocateCategorySlots({ ranked: [score("a", 30), score("b", 10)], pageSize: 8, explorationShare: 0.2, seed: 1 });
    expect(counts.get("a")).toBe(6);
    expect(counts.get("b")).toBe(2);
  });

  it("gives someone with no history an even mix", () => {
    const counts = allocateCategorySlots({ ranked: [score("a", 0), score("b", 0), score("c", 0), score("d", 0)], pageSize: 8, explorationShare: 0.2, seed: 1 });
    expect([...counts.values()]).toEqual([2, 2, 2, 2]);
  });

  it("explores different categories across pages", () => {
    const explored = new Set<string>();
    for (let seed = 0; seed < 30; seed += 1) {
      for (const id of allocateCategorySlots({ ranked, pageSize: 8, explorationShare: 0.2, seed }).keys()) explored.add(id);
    }
    expect(explored).toEqual(new Set(["chosen", "other-1", "other-2", "other-3"]));
  });

  it("doesn't let disliked categories take main slots", () => {
    const counts = allocateCategorySlots({ ranked: [score("liked", 5), score("disliked", -3)], pageSize: 10, explorationShare: 0, seed: 1 });
    expect(counts.get("disliked")).toBeUndefined();
  });

  it("handles no categories at all", () => {
    expect(sum(allocateCategorySlots({ ranked: [], pageSize: 8, explorationShare: 0.2, seed: 1 }))).toBe(0);
  });

  it("gives the same answer for the same seed", () => {
    const run = () => [...allocateCategorySlots({ ranked, pageSize: 8, explorationShare: 0.2, seed: 42 }).entries()];
    expect(run()).toEqual(run());
    expect(seededRandom(1)()).toBe(seededRandom(1)());
  });
});

describe("spreadByGroup", () => {
  const group = (value: string) => value[0]!;

  it("avoids repeats when it can", () => {
    const result = spreadByGroup(["a1", "a2", "a3", "b1", "b2", "c1"], group);
    for (let index = 1; index < result.length; index += 1) expect(group(result[index]!)).not.toBe(group(result[index - 1]!));
  });

  it("keeps every item, once", () => {
    const input = ["a1", "a2", "a3", "b1"];
    expect(spreadByGroup(input, group).sort()).toEqual([...input].sort());
  });

  it("repeats only when nothing else is left", () => {
    expect(spreadByGroup(["a1", "a2"], group)).toEqual(["a1", "a2"]);
    expect(spreadByGroup([], group)).toEqual([]);
  });
});

describe("feed cursor", () => {
  const cursor = { s: 123, n: 2, p: { [ID_A]: { k: 500, i: ID_B, w: false } }, d: [ID_B] };

  it("round-trips", () => {
    expect(decodeFeedCursor(encodeFeedCursor(cursor))).toEqual(cursor);
    expect(decodeFeedCursor(encodeFeedCursor(newFeedCursor(9)))).toEqual({ s: 9, n: 0, p: {}, d: [] });
  });

  it.each([
    ["not base64 JSON", "@@@"],
    ["the wrong shape", Buffer.from(JSON.stringify({ a: 1 })).toString("base64url")],
    ["a query operator instead of an ID", Buffer.from(JSON.stringify({ ...cursor, d: [{ $ne: null }] })).toString("base64url")],
    ["a bad position", Buffer.from(JSON.stringify({ ...cursor, p: { [ID_A]: { k: -1, i: ID_B, w: false } } })).toString("base64url")],
    ["an extra field", Buffer.from(JSON.stringify({ ...cursor, role: "ADMIN" })).toString("base64url")],
    ["an oversized value", "a".repeat(20_000)],
  ])("rejects %s", (_name, raw) => {
    expect(decodeFeedCursor(raw)).toBeNull();
  });
});

describe("signalFromWatch", () => {
  const watch = { didStartPlaying: true, didEnd: false, watchedSeconds: 10, durationSeconds: 60 };

  it("counts nothing if playback never really started", () => {
    expect(signalFromWatch({ ...watch, didStartPlaying: false, watchedSeconds: 0 })).toBeNull();
  });

  it("counts a finished video, however it's known", () => {
    expect(signalFromWatch({ ...watch, didEnd: true })).toBe("completion");
    expect(signalFromWatch({ ...watch, watchedSeconds: 55 })).toBe("completion");
  });

  it("counts leaving right away as an early skip", () => {
    expect(signalFromWatch({ ...watch, watchedSeconds: 1 })).toBe("earlySkip");
  });

  it("says nothing about the wide middle", () => {
    expect(signalFromWatch({ ...watch, watchedSeconds: 20 })).toBeNull();
  });

  it("doesn't treat a few seconds of a very short video as a skip", () => {
    expect(signalFromWatch({ ...watch, durationSeconds: 5, watchedSeconds: 1.5 })).toBeNull();
  });

  it("still works without a known duration", () => {
    expect(signalFromWatch({ ...watch, durationSeconds: null, watchedSeconds: 1 })).toBe("earlySkip");
    expect(signalFromWatch({ ...watch, durationSeconds: null, watchedSeconds: 500 })).toBeNull();
  });
});

describe("guest signals", () => {
  const NOW = new Date("2026-06-01T00:00:00Z");

  function memoryStorage(initial?: string) {
    const values = new Map<string, string>(initial === undefined ? [] : [[GUEST_SIGNALS_KEY, initial]]);
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
  }

  it("builds a score per category, in the browser only", () => {
    const storage = memoryStorage();
    recordGuestSignal(storage, ID_A, "completion", NOW);
    recordGuestSignal(storage, ID_A, "completion", NOW);
    recordGuestSignal(storage, ID_B, "earlySkip", NOW);
    expect(readGuestBehaviour(storage, NOW)).toEqual({ [ID_A]: 1, [ID_B]: -0.5 });
  });

  it("fades over time", () => {
    const storage = memoryStorage();
    recordGuestSignal(storage, ID_A, "save", NOW);
    const later = new Date(NOW.getTime() + DEFAULT_SCORING_CONFIG.decayHalfLifeDays * 86_400_000);
    expect(readGuestBehaviour(storage, later)[ID_A]).toBeCloseTo(0.5);
  });

  it("stays within the limit", () => {
    const storage = memoryStorage();
    for (let index = 0; index < 100; index += 1) recordGuestSignal(storage, ID_A, "save", NOW);
    expect(readGuestBehaviour(storage, NOW)[ID_A]).toBe(DEFAULT_SCORING_CONFIG.maxBehaviourScore);
  });

  it("ignores damaged or edited storage", () => {
    expect(readGuestBehaviour(memoryStorage("{broken"), NOW)).toEqual({});
    expect(readGuestBehaviour(memoryStorage(JSON.stringify({ "not-an-id": { score: 1, at: 1 } })), NOW)).toEqual({});
  });

  it("survives blocked storage", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => recordGuestSignal(blocked, ID_A, "save", NOW)).not.toThrow();
    expect(readGuestBehaviour(blocked, NOW)).toEqual({});
    expect(() => clearGuestSignals(blocked)).not.toThrow();
  });
});
