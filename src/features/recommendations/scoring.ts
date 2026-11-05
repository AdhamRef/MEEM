import { z } from "zod";

/**
 * Transparent category scoring (§9.3). There is no model and nothing is inferred about a
 * person: a score is only arithmetic on what they chose and did, and each part is returned
 * so it can be explained.
 *
 *   score = selected interest weight + behaviour score (decayed over time)
 *
 * The exploration share is applied by the feed when it allocates slots.
 */
export const scoringConfigSchema = z.strictObject({
  selectedInterestWeight: z.number().min(0).max(100),
  signalWeights: z.strictObject({
    completion: z.number().min(0).max(10),
    save: z.number().min(0).max(10),
    repeatedEngagement: z.number().min(0).max(10),
    earlySkip: z.number().min(-10).max(0),
  }),
  /** Limits how far behaviour can move a category in either direction. */
  maxBehaviourScore: z.number().positive().max(100),
  decayHalfLifeDays: z.number().positive().max(3650),
  /** The share of feed slots reserved for categories outside known interests (§9.4). */
  explorationShare: z.number().min(0).max(0.9),
});

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  selectedInterestWeight: 10,
  // All small on purpose: §9.2 says a single long watch must not signal strong interest.
  signalWeights: { completion: 0.5, save: 1, repeatedEngagement: 0.25, earlySkip: -0.5 },
  maxBehaviourScore: 8,
  decayHalfLifeDays: 30,
  explorationShare: 0.2,
};

export type RecommendationSignal = keyof ScoringConfig["signalWeights"];

const MS_PER_DAY = 86_400_000;

export interface BehaviourState {
  behaviourScore: number;
  lastSignalAt: Date | null;
}

export function decayedBehaviourScore(state: BehaviourState, now: Date, config: ScoringConfig): number {
  if (!state.lastSignalAt) return state.behaviourScore;
  const ageDays = (now.getTime() - state.lastSignalAt.getTime()) / MS_PER_DAY;
  if (ageDays <= 0) return state.behaviourScore;
  return state.behaviourScore * 0.5 ** (ageDays / config.decayHalfLifeDays);
}

export function applySignal(state: BehaviourState, signal: RecommendationSignal, now: Date, config: ScoringConfig): BehaviourState {
  const limit = config.maxBehaviourScore;
  const next = decayedBehaviourScore(state, now, config) + config.signalWeights[signal];
  return { behaviourScore: Math.min(limit, Math.max(-limit, next)), lastSignalAt: now };
}

export interface CategoryInterest extends BehaviourState {
  categoryId: string;
  /** 1 when chosen by the person, 0 otherwise. The weight it multiplies stays configurable. */
  explicitWeight: number;
}

export interface CategoryScore {
  categoryId: string;
  score: number;
  interestPart: number;
  behaviourPart: number;
}

export function scoreCategory(interest: CategoryInterest, now: Date, config: ScoringConfig): CategoryScore {
  const interestPart = interest.explicitWeight * config.selectedInterestWeight;
  const behaviourPart = decayedBehaviourScore(interest, now, config);
  return { categoryId: interest.categoryId, score: interestPart + behaviourPart, interestPart, behaviourPart };
}

/**
 * Orders every active category, highest score first. Categories with no history score 0.
 * Ties keep the editorial display order given in categoryIds, so results are repeatable.
 */
export function rankCategories(categoryIds: string[], interests: CategoryInterest[], now: Date, config: ScoringConfig): CategoryScore[] {
  const byCategory = new Map(interests.map((interest) => [interest.categoryId, interest]));

  return categoryIds
    .map((categoryId, displayIndex) => {
      const interest = byCategory.get(categoryId) ?? { categoryId, explicitWeight: 0, behaviourScore: 0, lastSignalAt: null };
      return { displayIndex, score: scoreCategory(interest, now, config) };
    })
    .sort((a, b) => b.score.score - a.score.score || a.displayIndex - b.displayIndex)
    .map(({ score }) => score);
}
