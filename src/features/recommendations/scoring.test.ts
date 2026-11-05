import { describe, expect, it } from "vitest";
import {
  applySignal,
  decayedBehaviourScore,
  DEFAULT_SCORING_CONFIG as config,
  rankCategories,
  scoreCategory,
  scoringConfigSchema,
  type CategoryInterest,
} from "./scoring";

const NOW = new Date("2026-06-01T00:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

const interest = (categoryId: string, overrides: Partial<CategoryInterest> = {}): CategoryInterest => ({
  categoryId,
  explicitWeight: 0,
  behaviourScore: 0,
  lastSignalAt: null,
  ...overrides,
});

describe("decayedBehaviourScore", () => {
  it("halves after one half-life", () => {
    const state = { behaviourScore: 4, lastSignalAt: daysAgo(config.decayHalfLifeDays) };
    expect(decayedBehaviourScore(state, NOW, config)).toBeCloseTo(2);
  });

  it("leaves a score with no date, or a future date, unchanged", () => {
    expect(decayedBehaviourScore({ behaviourScore: 3, lastSignalAt: null }, NOW, config)).toBe(3);
    expect(decayedBehaviourScore({ behaviourScore: 3, lastSignalAt: daysAgo(-5) }, NOW, config)).toBe(3);
  });

  it("fades negative scores toward zero too", () => {
    const state = { behaviourScore: -4, lastSignalAt: daysAgo(config.decayHalfLifeDays) };
    expect(decayedBehaviourScore(state, NOW, config)).toBeCloseTo(-2);
  });
});

describe("applySignal", () => {
  const empty = { behaviourScore: 0, lastSignalAt: null };

  it("raises the score for positive signals and lowers it for an early skip", () => {
    expect(applySignal(empty, "save", NOW, config).behaviourScore).toBe(config.signalWeights.save);
    expect(applySignal(empty, "completion", NOW, config).behaviourScore).toBe(config.signalWeights.completion);
    expect(applySignal(empty, "earlySkip", NOW, config).behaviourScore).toBe(config.signalWeights.earlySkip);
  });

  it("can't make one watch outweigh a chosen interest (§9.2)", () => {
    const after = applySignal(empty, "completion", NOW, config);
    expect(after.behaviourScore).toBeLessThan(config.selectedInterestWeight / 4);
  });

  it("stays within the limit in both directions, however many signals arrive", () => {
    let up = empty as ReturnType<typeof applySignal>;
    let down = empty as ReturnType<typeof applySignal>;
    for (let i = 0; i < 100; i += 1) {
      up = applySignal(up, "save", NOW, config);
      down = applySignal(down, "earlySkip", NOW, config);
    }
    expect(up.behaviourScore).toBe(config.maxBehaviourScore);
    expect(down.behaviourScore).toBe(-config.maxBehaviourScore);
  });

  it("decays the old score before adding, and records the time", () => {
    const after = applySignal({ behaviourScore: 4, lastSignalAt: daysAgo(config.decayHalfLifeDays) }, "save", NOW, config);
    expect(after.behaviourScore).toBeCloseTo(2 + config.signalWeights.save);
    expect(after.lastSignalAt).toBe(NOW);
  });
});

describe("scoreCategory", () => {
  it("returns each part, so a score can be explained", () => {
    const score = scoreCategory(interest("a", { explicitWeight: 1, behaviourScore: 2, lastSignalAt: NOW }), NOW, config);
    expect(score).toEqual({ categoryId: "a", score: 12, interestPart: 10, behaviourPart: 2 });
  });

  it("uses the configured weight rather than a fixed one", () => {
    const score = scoreCategory(interest("a", { explicitWeight: 1 }), NOW, { ...config, selectedInterestWeight: 3 });
    expect(score.score).toBe(3);
  });
});

describe("rankCategories", () => {
  it("puts selected categories first", () => {
    const ranked = rankCategories(["a", "b", "c"], [interest("c", { explicitWeight: 1 })], NOW, config);
    expect(ranked.map((item) => item.categoryId)).toEqual(["c", "a", "b"]);
  });

  it("lets behaviour order categories with the same selection state", () => {
    const interests = [interest("a", { behaviourScore: 1, lastSignalAt: NOW }), interest("b", { behaviourScore: 3, lastSignalAt: NOW })];
    expect(rankCategories(["a", "b"], interests, NOW, config).map((item) => item.categoryId)).toEqual(["b", "a"]);
  });

  it("keeps a selected category above any behaviour at the default settings", () => {
    const interests = [interest("chosen", { explicitWeight: 1 }), interest("watched", { behaviourScore: config.maxBehaviourScore, lastSignalAt: NOW })];
    expect(rankCategories(["watched", "chosen"], interests, NOW, config)[0]!.categoryId).toBe("chosen");
  });

  it("includes categories with no history, in display order, and ignores unknown ones", () => {
    const ranked = rankCategories(["b", "a"], [interest("not-active", { explicitWeight: 1 })], NOW, config);
    expect(ranked.map((item) => item.categoryId)).toEqual(["b", "a"]);
    expect(ranked.every((item) => item.score === 0)).toBe(true);
  });

  it("gives the same order every time", () => {
    const interests = [interest("a", { explicitWeight: 1 }), interest("b", { explicitWeight: 1 })];
    const first = rankCategories(["a", "b", "c"], interests, NOW, config);
    expect(rankCategories(["a", "b", "c"], interests, NOW, config)).toEqual(first);
  });
});

describe("scoringConfigSchema", () => {
  it("accepts the defaults", () => {
    expect(scoringConfigSchema.safeParse(config).success).toBe(true);
  });

  it.each([
    ["an exploration share above the limit", { ...config, explorationShare: 0.95 }],
    ["a negative exploration share", { ...config, explorationShare: -0.1 }],
    ["a positive early skip", { ...config, signalWeights: { ...config.signalWeights, earlySkip: 1 } }],
    ["a zero half-life", { ...config, decayHalfLifeDays: 0 }],
    ["an unknown field", { ...config, userReligiousProfile: true }],
  ])("rejects %s", (_name, value) => {
    expect(scoringConfigSchema.safeParse(value).success).toBe(false);
  });
});
