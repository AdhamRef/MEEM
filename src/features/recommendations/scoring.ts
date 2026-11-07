import { z } from "zod";

/**
 * Transparent topic scoring (§9.3). There is no model and nothing is inferred about a
 * person: a score is only arithmetic on what they chose and did, and each part is returned
 * so it can be explained.
 *
 *   score = selected interest weight + behaviour score (decayed over time)
 *           + this visit's momentum, which is never stored
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
  /** Limits how far behaviour can move a topic in either direction. */
  maxBehaviourScore: z.number().positive().max(100),
  decayHalfLifeDays: z.number().positive().max(3650),
  /** The share of feed slots reserved for topics outside known interests (§9.4). */
  explorationShare: z.number().min(0).max(0.9),
  /** How many other videos must pass before a channel returns, whenever another channel is available. */
  channelSpacing: z.number().int().min(0).max(50).default(6),
  /** The most of one page a single topic can take, so no one topic takes over (§9.3). */
  // Named before topics replaced categories. Stored settings use this key, so it stays.
  maxCategoryShare: z.number().min(0.1).max(1).default(0.75),
  /** How strongly this visit's completions and skips move a topic. Never stored. */
  sessionMomentumWeight: z.number().min(0).max(20).default(4),
  /** How much this visit's completions and skips change how often a channel is picked. Never stored. */
  channelMomentumWeight: z.number().min(0).max(5).default(0.5),
});

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  selectedInterestWeight: 10,
  // All small on purpose: §9.2 says a single long watch must not signal strong interest.
  signalWeights: { completion: 0.5, save: 1, repeatedEngagement: 0.25, earlySkip: -0.5 },
  maxBehaviourScore: 8,
  decayHalfLifeDays: 30,
  explorationShare: 0.2,
  channelSpacing: 6,
  maxCategoryShare: 0.75,
  sessionMomentumWeight: 4,
  channelMomentumWeight: 0.5,
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

export interface TopicInterest extends BehaviourState {
  topicId: string;
  /** 1 when chosen by the person, 0 otherwise. The weight it multiplies stays configurable. */
  explicitWeight: number;
}

export interface TopicScore {
  topicId: string;
  score: number;
  interestPart: number;
  behaviourPart: number;
}

export function scoreTopic(interest: TopicInterest, now: Date, config: ScoringConfig): TopicScore {
  const interestPart = interest.explicitWeight * config.selectedInterestWeight;
  const behaviourPart = decayedBehaviourScore(interest, now, config);
  return { topicId: interest.topicId, score: interestPart + behaviourPart, interestPart, behaviourPart };
}

/**
 * Orders every active topic, highest score first. Topics with no history score 0.
 * Ties keep the editorial display order given in topicIds, so results are repeatable.
 */
export function rankTopics(topicIds: string[], interests: TopicInterest[], now: Date, config: ScoringConfig): TopicScore[] {
  const byTopic = new Map(interests.map((interest) => [interest.topicId, interest]));

  return topicIds
    .map((topicId, displayIndex) => {
      const interest = byTopic.get(topicId) ?? { topicId, explicitWeight: 0, behaviourScore: 0, lastSignalAt: null };
      return { displayIndex, score: scoreTopic(interest, now, config) };
    })
    .sort((a, b) => b.score.score - a.score.score || a.displayIndex - b.displayIndex)
    .map(({ score }) => score);
}

/** Adds this visit's momentum to each score and orders them again. Unknown topics are ignored. */
export function applySessionMomentum(ranked: TopicScore[], momentum: Record<string, number>, config: ScoringConfig): TopicScore[] {
  return ranked
    .map((item, order) => ({ order, item: { ...item, score: item.score + (momentum[item.topicId] ?? 0) * config.sessionMomentumWeight } }))
    .sort((a, b) => b.item.score - a.item.score || a.order - b.order)
    .map(({ item }) => item);
}

/** How likely a channel is to be picked this visit: more after completions, less after skips, never zero. */
export function channelMomentumFactor(momentum: number, config: ScoringConfig): number {
  return Math.max(0.2, 1 + momentum * config.channelMomentumWeight);
}
