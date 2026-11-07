import { describe, expect, it } from "vitest";
import { clearGuestSignals, GUEST_SIGNALS_KEY, readGuestBehaviour, recordGuestSignal } from "@/features/recommendations/guest-signals";
import { applySessionMomentum, channelMomentumFactor, DEFAULT_SCORING_CONFIG, scoringConfigSchema, type TopicScore } from "@/features/recommendations/scoring";
import { addSessionMomentum, emptySessionMomentum, MAX_SESSION_MOMENTUM, sessionMomentumParams } from "@/features/recommendations/session-momentum";
import { signalFromWatch } from "@/features/recommendations/watch-rules";
import { allocateTopicSlots, planFeedPage, seededRandom, type PagePick, type VideoPool } from "./allocation";
import { decodeFeedCursor, encodeFeedCursor, newFeedCursor, poolKey } from "./cursor";

const score = (topicId: string, value: number): TopicScore => ({ topicId, score: value, interestPart: value, behaviourPart: 0 });
const sum = (counts: Map<string, number>) => [...counts.values()].reduce((total, count) => total + count, 0);
const ID_A = "a".repeat(24);
const ID_B = "b".repeat(24);

describe("allocateTopicSlots", () => {
  const ranked = [score("chosen", 10), score("other-1", 0), score("other-2", 0), score("other-3", 0)];

  it("always fills the page exactly", () => {
    for (const pageSize of [1, 2, 3, 8, 20]) {
      expect(sum(allocateTopicSlots({ ranked, pageSize, explorationShare: 0.2, seed: 1 }))).toBe(pageSize);
    }
  });

  it("gives most slots to chosen topics and the configured share to others (§9.4)", () => {
    const counts = allocateTopicSlots({ ranked, pageSize: 10, explorationShare: 0.2, seed: 1 });
    expect(counts.get("chosen")).toBe(8);
    expect(sum(counts) - counts.get("chosen")!).toBe(2);
  });

  it("follows a different configured share", () => {
    expect(allocateTopicSlots({ ranked, pageSize: 10, explorationShare: 0.5, seed: 1 }).get("chosen")).toBe(5);
  });

  it("can turn exploration off", () => {
    const counts = allocateTopicSlots({ ranked, pageSize: 10, explorationShare: 0, seed: 1 });
    expect(counts.get("chosen")).toBe(10);
    expect(counts.size).toBe(1);
  });

  it("still explores on a small page", () => {
    const counts = allocateTopicSlots({ ranked, pageSize: 3, explorationShare: 0.1, seed: 1 });
    expect(sum(counts) - counts.get("chosen")!).toBe(1);
  });

  it("shares the main slots in proportion to score", () => {
    const counts = allocateTopicSlots({ ranked: [score("a", 30), score("b", 10)], pageSize: 8, explorationShare: 0.2, seed: 1 });
    expect(counts.get("a")).toBe(6);
    expect(counts.get("b")).toBe(2);
  });

  it("gives someone with no history an even mix", () => {
    const counts = allocateTopicSlots({ ranked: [score("a", 0), score("b", 0), score("c", 0), score("d", 0)], pageSize: 8, explorationShare: 0.2, seed: 1 });
    expect([...counts.values()]).toEqual([2, 2, 2, 2]);
  });

  it("explores different topics across pages", () => {
    const explored = new Set<string>();
    for (let seed = 0; seed < 30; seed += 1) {
      for (const id of allocateTopicSlots({ ranked, pageSize: 8, explorationShare: 0.2, seed }).keys()) explored.add(id);
    }
    expect(explored).toEqual(new Set(["chosen", "other-1", "other-2", "other-3"]));
  });

  it("doesn't let disliked topics take main slots", () => {
    const counts = allocateTopicSlots({ ranked: [score("liked", 5), score("disliked", -3)], pageSize: 10, explorationShare: 0, seed: 1 });
    expect(counts.get("disliked")).toBeUndefined();
  });

  it("handles no topics at all", () => {
    expect(sum(allocateTopicSlots({ ranked: [], pageSize: 8, explorationShare: 0.2, seed: 1 }))).toBe(0);
  });

  it("gives the same answer for the same seed", () => {
    const run = () => [...allocateTopicSlots({ ranked, pageSize: 8, explorationShare: 0.2, seed: 42 }).entries()];
    expect(run()).toEqual(run());
    expect(seededRandom(1)()).toBe(seededRandom(1)());
  });
});

describe("allocateTopicSlots with a topic limit", () => {
  it("stops one topic taking over, passing the excess to the others", () => {
    const counts = allocateTopicSlots({ ranked: [score("loved", 10), score("a", 0), score("b", 0), score("c", 0)], pageSize: 8, explorationShare: 0.2, seed: 1, maxCategoryShare: 0.5 });
    expect(counts.get("loved")).toBe(4);
    expect(sum(counts)).toBe(8);
  });

  it("still fills the page when there is only one topic", () => {
    const counts = allocateTopicSlots({ ranked: [score("only", 10)], pageSize: 8, explorationShare: 0.2, seed: 1, maxCategoryShare: 0.5 });
    expect(counts.get("only")).toBe(8);
  });
});

describe("planFeedPage with a channel in several topics", () => {
  const shared: VideoPool = { topicIds: ["x", "y"], channelId: "shared", remaining: 3 };
  const base = { recentChannels: [], channelSpacing: 0, pageSize: 8, channelFactor: () => 1, seed: 1 };

  it("never reads more from a channel than it has, whichever topic asks", () => {
    const picks = planFeedPage({ ...base, topicOrder: ["x", "y"], slots: new Map([["x", 4], ["y", 4]]), pools: [shared] });
    expect(picks).toHaveLength(3);
    expect(picks.every((pick) => pick.channelId === "shared")).toBe(true);
  });

  it("counts each pick towards a topic the channel really has", () => {
    const pools: VideoPool[] = [shared, { topicIds: ["y"], channelId: "other", remaining: 5 }];
    for (const pick of planFeedPage({ ...base, topicOrder: ["x", "y"], slots: new Map([["x", 2], ["y", 6]]), pools })) {
      expect(pools.find((pool) => pool.channelId === pick.channelId)!.topicIds).toContain(pick.topicId);
    }
  });

  it("serves a topic's slots from a channel it shares with another topic", () => {
    const picks = planFeedPage({ ...base, pageSize: 2, topicOrder: ["x", "y"], slots: new Map([["x", 1], ["y", 1]]), pools: [shared] });
    expect(picks.map((pick) => pick.topicId).sort()).toEqual(["x", "y"]);
  });
});

describe("planFeedPage", () => {
  const plan = (pools: VideoPool[], overrides: Partial<Parameters<typeof planFeedPage>[0]> = {}) =>
    planFeedPage({
      topicOrder: [...new Set(pools.flatMap((pool) => pool.topicIds))],
      slots: new Map([...new Set(pools.flatMap((pool) => pool.topicIds))].map((id) => [id, 8])),
      pools,
      recentChannels: [],
      channelSpacing: 6,
      pageSize: 8,
      channelFactor: () => 1,
      seed: 7,
      ...overrides,
    });
  const channels = (picks: PagePick[]) => picks.map((pick) => pick.channelId);
  const pool = (topicId: string, channelId: string | null, remaining: number): VideoPool => ({ topicIds: [topicId], channelId, remaining });

  it("doesn't let a channel with most of the videos fill the page", () => {
    const picks = plan([pool("c", "huge", 500), ...["a", "b", "d", "e", "f", "g", "h"].map((id) => pool("c", id, 5))]);
    expect(channels(picks).filter((channel) => channel === "huge").length).toBeLessThanOrEqual(2);
    expect(new Set(channels(picks)).size).toBeGreaterThanOrEqual(7);
  });

  it("keeps the spacing across a long simulated session, including across pages", () => {
    // A library like the one reported: one channel with far more than the rest.
    const remaining = new Map<string, number>([["huge", 800], ["a", 40], ["b", 40], ["d", 30], ["e", 20], ["f", 20], ["g", 10], ["h", 10], ["i", 10], ["j", 10]]);
    const shown: string[] = [];
    for (let page = 0; page < 12; page += 1) {
      const picks = plan([...remaining].map(([id, count]) => pool("c", id, count)), { recentChannels: shown.slice(-6), seed: page });
      for (const pick of picks) {
        shown.push(pick.channelId!);
        remaining.set(pick.channelId!, remaining.get(pick.channelId!)! - 1);
      }
    }
    expect(shown).toHaveLength(96);
    for (let index = 0; index < shown.length; index += 1) {
      expect(shown.slice(Math.max(0, index - 6), index)).not.toContain(shown[index]);
    }
  });

  it("borrows from another topic before repeating a channel", () => {
    const picks = plan([pool("first", "one", 50), pool("second", "other", 50)], { slots: new Map([["first", 8]]), topicOrder: ["first", "second"], channelSpacing: 1 });
    expect(channels(picks)).toEqual(["one", "other", "one", "other", "one", "other", "one", "other"]);
  });

  it("repeats a channel only when nothing else is left, choosing the one seen longest ago", () => {
    expect(channels(plan([pool("c", "a", 4), pool("c", "b", 4)]))).toEqual(["a", "b", "a", "b", "a", "b", "a", "b"]);
    expect(channels(plan([pool("c", "only", 3)]))).toEqual(["only", "only", "only"]);
  });

  it("doesn't repeat a channel from just before this page", () => {
    const picks = plan([pool("c", "a", 10), pool("c", "b", 10)], { recentChannels: ["a"], channelSpacing: 1, pageSize: 1 });
    expect(picks[0]!.channelId).toBe("b");
  });

  it("avoids the same topic twice in a row while another has slots", () => {
    const pools = [pool("x", "a", 10), pool("x", "b", 10), pool("y", "c", 10), pool("y", "d", 10)];
    const picks = plan(pools, { slots: new Map([["x", 4], ["y", 4]]), channelSpacing: 0 });
    for (let index = 1; index < picks.length; index += 1) expect(picks[index]!.topicId).not.toBe(picks[index - 1]!.topicId);
  });

  it("follows the slots a topic was given", () => {
    const pools = ["a", "b", "d", "e", "f", "g", "h", "i", "j", "k"].flatMap((id, index) => [pool(index % 2 ? "main" : "side", id, 20)]);
    const picks = plan(pools, { slots: new Map([["main", 6], ["side", 2]]), topicOrder: ["main", "side"] });
    expect(picks.filter((pick) => pick.topicId === "main")).toHaveLength(6);
  });

  it("never picks past what's there, and gives what it can", () => {
    expect(plan([pool("c", "a", 1), pool("c", "b", 1)])).toHaveLength(2);
    expect(plan([])).toEqual([]);
  });

  it("treats videos with no recorded channel as never repeating", () => {
    expect(channels(plan([pool("c", null, 3)]))).toEqual([null, null, null]);
  });

  it("makes a finished channel likelier and a skipped one rarer, without removing it", () => {
    const count = (factor: (id: string) => number) => {
      let liked = 0;
      for (let seed = 0; seed < 300; seed += 1) {
        const [pick] = plan([pool("c", "liked", 20), pool("c", "other", 20)], { pageSize: 1, seed, channelFactor: factor });
        if (pick!.channelId === "liked") liked += 1;
      }
      return liked;
    };
    expect(count(() => 1)).toBeGreaterThan(110);
    expect(count((id) => (id === "liked" ? 2.5 : 1))).toBeGreaterThan(180);
    const whenSkipped = count((id) => (id === "liked" ? 0.2 : 1));
    expect(whenSkipped).toBeLessThan(90);
    expect(whenSkipped).toBeGreaterThan(0);
  });

  it("gives the same answer for the same seed", () => {
    const pools = [pool("c", "a", 9), pool("c", "b", 9), pool("c", "d", 9)];
    expect(plan(pools)).toEqual(plan(pools));
  });
});

describe("session momentum", () => {
  const video = { topics: [{ id: ID_A }], channelId: ID_B };

  it("counts each event on the topic and the channel", () => {
    const after = addSessionMomentum(addSessionMomentum(emptySessionMomentum(), video, "completion"), video, "replay");
    expect(after).toEqual({ topics: { [ID_A]: 3 }, channels: { [ID_B]: 3 } });
  });

  it("goes down on a skip, and stays within the limit both ways", () => {
    let momentum = emptySessionMomentum();
    for (let index = 0; index < 20; index += 1) momentum = addSessionMomentum(momentum, video, "earlySkip");
    expect(momentum.topics[ID_A]).toBe(-MAX_SESSION_MOMENTUM);
    for (let index = 0; index < 20; index += 1) momentum = addSessionMomentum(momentum, video, "save");
    expect(momentum.channels[ID_B]).toBe(MAX_SESSION_MOMENTUM);
  });

  it("moves every topic of the video's channel together", () => {
    const after = addSessionMomentum(emptySessionMomentum(), { topics: [{ id: ID_A }, { id: ID_B }], channelId: null }, "completion");
    expect(after.topics).toEqual({ [ID_A]: 1, [ID_B]: 1 });
  });

  it("ignores what a video doesn't have", () => {
    expect(addSessionMomentum(emptySessionMomentum(), { topics: [], channelId: null }, "completion")).toEqual(emptySessionMomentum());
  });

  it("sends nothing until something happened, and leaves out what cancelled out", () => {
    expect(sessionMomentumParams(emptySessionMomentum())).toEqual({});
    let momentum = addSessionMomentum(emptySessionMomentum(), video, "completion");
    expect(sessionMomentumParams(momentum)).toEqual({ momentum: `${ID_A}:1`, channelMomentum: `${ID_B}:1` });
    momentum = addSessionMomentum(momentum, video, "earlySkip");
    expect(sessionMomentumParams(momentum)).toEqual({});
  });

  it("moves a topic's rank within a visit", () => {
    const ranked = [score("first", 10), score("second", 0)];
    expect(applySessionMomentum(ranked, { second: 3 }, DEFAULT_SCORING_CONFIG).map((item) => item.topicId)).toEqual(["second", "first"]);
    expect(applySessionMomentum(ranked, { first: -3 }, DEFAULT_SCORING_CONFIG)[0]!.score).toBe(0);
    expect(applySessionMomentum(ranked, {}, DEFAULT_SCORING_CONFIG)).toEqual(ranked);
  });

  it("never takes a channel's chance down to nothing", () => {
    expect(channelMomentumFactor(0, DEFAULT_SCORING_CONFIG)).toBe(1);
    expect(channelMomentumFactor(3, DEFAULT_SCORING_CONFIG)).toBe(2.5);
    expect(channelMomentumFactor(-3, DEFAULT_SCORING_CONFIG)).toBe(0.2);
  });

  it("keeps settings saved before these existed working", () => {
    const { channelSpacing, maxCategoryShare, sessionMomentumWeight, channelMomentumWeight, ...older } = DEFAULT_SCORING_CONFIG;
    void [channelSpacing, maxCategoryShare, sessionMomentumWeight, channelMomentumWeight];
    expect(scoringConfigSchema.parse(older)).toEqual(DEFAULT_SCORING_CONFIG);
  });
});

describe("feed cursor", () => {
  const cursor = { s: 123, n: 2, o: { [poolKey(ID_A)]: 4 }, r: [ID_B] };

  it("round-trips", () => {
    expect(decodeFeedCursor(encodeFeedCursor(cursor))).toEqual(cursor);
    expect(decodeFeedCursor(encodeFeedCursor(newFeedCursor(9)))).toEqual({ s: 9, n: 0, o: {}, r: [] });
  });

  it("keys a pool with no channel too", () => {
    expect(poolKey(ID_A)).toMatch(/^[0-9a-f]{16}$/);
    expect(poolKey(null)).toMatch(/^[0-9a-f]{16}$/);
  });

  it.each([
    ["not base64 JSON", "@@@"],
    ["the wrong shape", Buffer.from(JSON.stringify({ a: 1 })).toString("base64url")],
    ["a query operator instead of an ID", Buffer.from(JSON.stringify({ ...cursor, r: [{ $ne: null }] })).toString("base64url")],
    ["a bad position", Buffer.from(JSON.stringify({ ...cursor, o: { [poolKey(ID_A)]: -1 } })).toString("base64url")],
    ["a bad pool key", Buffer.from(JSON.stringify({ ...cursor, o: { $where: 1 } })).toString("base64url")],
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

  it("builds a score per topic, in the browser only", () => {
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
