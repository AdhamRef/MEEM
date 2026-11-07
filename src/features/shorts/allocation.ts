import type { TopicScore } from "@/features/recommendations/scoring";

/** A small seeded generator, so one page's choices are repeatable in tests. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

/** Share of `total` per score, keeping the sum exact by giving spare slots to the largest remainders. */
function proportionalCounts(known: TopicScore[], total: number): Map<string, number> {
  const sum = known.reduce((acc, item) => acc + item.score, 0);
  const exact = known.map((item) => ({ id: item.topicId, value: (item.score / sum) * total }));
  const counts = new Map(exact.map((item) => [item.id, Math.floor(item.value)]));

  let spare = total - [...counts.values()].reduce((acc, count) => acc + count, 0);
  const byRemainder = [...exact].sort((a, b) => b.value - Math.floor(b.value) - (a.value - Math.floor(a.value)));
  for (const item of byRemainder) {
    if (spare <= 0) break;
    counts.set(item.id, counts.get(item.id)! + 1);
    spare -= 1;
  }
  return counts;
}

export interface AllocationInput {
  ranked: TopicScore[];
  pageSize: number;
  explorationShare: number;
  seed: number;
  /** The most of the page one topic may take. Anything above it passes to the others. */
  maxCategoryShare?: number;
}

/**
 * How many videos each topic gets on one page (§9.3, §9.4). Topics with a positive
 * score share the main slots in proportion to it, and the exploration share goes to the
 * rest. Someone with no history gets an even mix, since nothing is known about them.
 */
export function allocateTopicSlots({ ranked, pageSize, explorationShare, seed, maxCategoryShare = 1 }: AllocationInput): Map<string, number> {
  const random = seededRandom(seed);
  const known = ranked.filter((item) => item.score > 0);
  const others = shuffled(
    ranked.filter((item) => item.score <= 0),
    random,
  );

  const counts = new Map<string, number>();
  const spread = (ids: string[], slots: number) => {
    for (let slot = 0; slot < slots && ids.length > 0; slot += 1) {
      const id = ids[slot % ids.length]!;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  };

  // Repeatedly hands a capped topic's excess to whichever topic has the fewest.
  const limitShare = () => {
    const limit = Math.max(1, Math.ceil(pageSize * maxCategoryShare));
    const order = [...known, ...others].map((item) => item.topicId);
    for (const id of order) {
      while ((counts.get(id) ?? 0) > limit) {
        const receiver = order.filter((other) => (counts.get(other) ?? 0) < limit).sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0))[0];
        if (!receiver) return;
        counts.set(id, counts.get(id)! - 1);
        counts.set(receiver, (counts.get(receiver) ?? 0) + 1);
      }
    }
  };

  if (known.length === 0) {
    spread(
      others.map((item) => item.topicId),
      pageSize,
    );
    limitShare();
    return counts;
  }

  // At least one slot whenever exploration is on, or small pages would never explore.
  const explorationSlots = others.length === 0 || explorationShare <= 0 ? 0 : Math.max(1, Math.round(pageSize * explorationShare));
  spread(
    others.map((item) => item.topicId),
    explorationSlots,
  );
  for (const [id, count] of proportionalCounts(known, pageSize - explorationSlots)) {
    if (count > 0) counts.set(id, (counts.get(id) ?? 0) + count);
  }
  limitShare();
  return counts;
}

/**
 * One channel's unread videos, and the topics they count towards. A channel can have several
 * topics, which all share this one pool, so a video can't appear twice. A channel of null means
 * none is recorded.
 */
export interface VideoPool {
  topicIds: string[];
  channelId: string | null;
  remaining: number;
}

export interface PagePlanInput {
  /** Every topic, best first, since any of them can step in to keep channels apart. */
  topicOrder: string[];
  slots: Map<string, number>;
  pools: VideoPool[];
  /** Channels already shown, oldest first. */
  recentChannels: string[];
  channelSpacing: number;
  pageSize: number;
  /** Above 1 makes a channel likelier this visit, and below 1 less likely. */
  channelFactor: (channelId: string) => number;
  seed: number;
}

export interface PagePick {
  topicId: string;
  channelId: string | null;
}

/**
 * Decides who appears on a page, one card at a time. Picking channels first, then reading from
 * them, is what stops a channel with hundreds of videos from filling the feed: a big channel
 * is only somewhat likelier than a small one, and never returns within the spacing if any other
 * channel is available. When none is, the one seen longest ago comes next.
 */
export function planFeedPage({ topicOrder, slots, pools, recentChannels, channelSpacing, pageSize, channelFactor, seed }: PagePlanInput): PagePick[] {
  const random = seededRandom(seed);
  const left = pools.map((pool) => ({ ...pool }));
  const slotsLeft = new Map(slots);
  const recent = [...recentChannels];
  const picks: PagePick[] = [];
  let lastTopic: string | null = null;

  const open = (topicId: string) => left.filter((pool) => pool.topicIds.includes(topicId) && pool.remaining > 0);
  const isSpaced = (pool: VideoPool) => pool.channelId === null || !recent.slice(channelSpacing === 0 ? recent.length : -channelSpacing).includes(pool.channelId);

  while (picks.length < pageSize) {
    // Topics with slots come first, most slots first, avoiding the one just used. Then the rest.
    const withSlots = topicOrder
      .filter((id) => (slotsLeft.get(id) ?? 0) > 0)
      .sort((a, b) => Number(a === lastTopic) - Number(b === lastTopic) || slotsLeft.get(b)! - slotsLeft.get(a)!);
    const order = [...withSlots, ...topicOrder.filter((id) => !withSlots.includes(id))];

    let chosen: (typeof left)[number] | undefined;
    let chosenTopic: string | undefined;
    for (const topicId of order) {
      const eligible = open(topicId).filter(isSpaced);
      if (eligible.length === 0) continue;
      // Square root, so a channel with 100 videos is 10 times likelier than one with 1, not 100.
      const weightOf = (pool: VideoPool) => Math.sqrt(pool.remaining) * (pool.channelId ? channelFactor(pool.channelId) : 1);
      let point = random() * eligible.reduce((total, pool) => total + weightOf(pool), 0);
      chosen = eligible.find((pool) => (point -= weightOf(pool)) < 0) ?? eligible.at(-1);
      chosenTopic = topicId;
      break;
    }
    if (!chosen) {
      const lastSeen = (pool: VideoPool) => (pool.channelId ? recent.lastIndexOf(pool.channelId) : -1);
      const candidates: typeof left = order.flatMap(open);
      chosen = candidates.reduce<(typeof left)[number] | undefined>((best, pool) => (!best || lastSeen(pool) < lastSeen(best) ? pool : best), undefined);
      chosenTopic = chosen && order.find((topicId) => chosen!.topicIds.includes(topicId));
    }
    if (!chosen || !chosenTopic) break;

    chosen.remaining -= 1;
    slotsLeft.set(chosenTopic, (slotsLeft.get(chosenTopic) ?? 0) - 1);
    if (chosen.channelId) recent.push(chosen.channelId);
    lastTopic = chosenTopic;
    picks.push({ topicId: chosenTopic, channelId: chosen.channelId });
  }
  return picks;
}
