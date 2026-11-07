import { z } from "zod";
import { objectIdSchema } from "@/features/topics/schemas";
import { applySignal, decayedBehaviourScore, DEFAULT_SCORING_CONFIG, type RecommendationSignal } from "./scoring";

// v2: scores belong to topics now. What v1 held belonged to categories, so it's left behind.
export const GUEST_SIGNALS_KEY = "signals.v2";

const MAX_TRACKED_TOPICS = 100;

const storedSignalsSchema = z
  .record(objectIdSchema, z.strictObject({ score: z.number().finite(), at: z.number().finite() }))
  .refine((value) => Object.keys(value).length <= MAX_TRACKED_TOPICS);

type StoredSignals = z.infer<typeof storedSignalsSchema>;

function read(storage: Pick<Storage, "getItem">): StoredSignals {
  try {
    const parsed = storedSignalsSchema.safeParse(JSON.parse(storage.getItem(GUEST_SIGNALS_KEY) ?? "{}"));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** A guest's behaviour stays in their browser. Nothing about it reaches the server until the feed asks. */
export function recordGuestSignal(storage: Pick<Storage, "getItem" | "setItem">, topicId: string, signal: RecommendationSignal, now: Date): void {
  const signals = read(storage);
  const current = signals[topicId];
  const next = applySignal({ behaviourScore: current?.score ?? 0, lastSignalAt: current ? new Date(current.at) : null }, signal, now, DEFAULT_SCORING_CONFIG);
  signals[topicId] = { score: next.behaviourScore, at: now.getTime() };
  try {
    storage.setItem(GUEST_SIGNALS_KEY, JSON.stringify(signals));
  } catch {
    // Storage is blocked or full. The feed just stays less personal, which is harmless.
  }
}

/** Current scores, faded by time, keeping only what still matters. */
export function readGuestBehaviour(storage: Pick<Storage, "getItem">, now: Date): Record<string, number> {
  const behaviour: Record<string, number> = {};
  for (const [topicId, { score, at }] of Object.entries(read(storage))) {
    const decayed = decayedBehaviourScore({ behaviourScore: score, lastSignalAt: new Date(at) }, now, DEFAULT_SCORING_CONFIG);
    if (Math.abs(decayed) >= 0.01) behaviour[topicId] = Math.round(decayed * 100) / 100;
  }
  return behaviour;
}

export function clearGuestSignals(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(GUEST_SIGNALS_KEY);
  } catch {
    // The merge is capped and repeats safely, so a leftover copy does no harm.
  }
}
