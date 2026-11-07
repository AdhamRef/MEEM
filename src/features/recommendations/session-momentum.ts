/**
 * What happened during this visit, so the feed answers within a few swipes rather than over days.
 * It only ever concerns a topic or a channel, nothing is concluded about the person, and it's
 * never stored: it lives in the browser until the page closes, and each page request carries it.
 */
export interface SessionMomentum {
  topics: Record<string, number>;
  channels: Record<string, number>;
}

export type MomentumEvent = "completion" | "replay" | "earlySkip" | "save";

/** Watching a video twice says more than finishing it once, and skipping says the opposite. */
const EVENT_WEIGHTS: Record<MomentumEvent, number> = { completion: 1, replay: 2, save: 2, earlySkip: -1 };
/** A burst of swipes moves the feed, but can't take it over. */
export const MAX_SESSION_MOMENTUM = 3;
const MAX_TRACKED = 40;

const emptyRecord = (): Record<string, number> => ({});

export const emptySessionMomentum = (): SessionMomentum => ({ topics: emptyRecord(), channels: emptyRecord() });

function add(record: Record<string, number>, id: string | null | undefined, weight: number): Record<string, number> {
  if (!id || (!(id in record) && Object.keys(record).length >= MAX_TRACKED)) return record;
  return { ...record, [id]: Math.max(-MAX_SESSION_MOMENTUM, Math.min(MAX_SESSION_MOMENTUM, (record[id] ?? 0) + weight)) };
}

export function addSessionMomentum(momentum: SessionMomentum, video: { topics: { id: string }[]; channelId: string | null }, event: MomentumEvent): SessionMomentum {
  const weight = EVENT_WEIGHTS[event];
  // A video belongs to every topic of its channel, so all of them move together.
  return { topics: video.topics.reduce((record, topic) => add(record, topic.id, weight), momentum.topics), channels: add(momentum.channels, video.channelId, weight) };
}

function encode(record: Record<string, number>): string {
  return Object.entries(record)
    .filter(([, value]) => value !== 0)
    .map(([id, value]) => `${id}:${value}`)
    .join(",");
}

export function sessionMomentumParams({ topics, channels }: SessionMomentum): Record<string, string> {
  const params: Record<string, string> = {};
  const encodedTopics = encode(topics);
  const encodedChannels = encode(channels);
  if (encodedTopics) params.momentum = encodedTopics;
  if (encodedChannels) params.channelMomentum = encodedChannels;
  return params;
}
