import type { CategoryScore } from "@/features/recommendations/scoring";

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
function proportionalCounts(known: CategoryScore[], total: number): Map<string, number> {
  const sum = known.reduce((acc, item) => acc + item.score, 0);
  const exact = known.map((item) => ({ id: item.categoryId, value: (item.score / sum) * total }));
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
  ranked: CategoryScore[];
  pageSize: number;
  explorationShare: number;
  seed: number;
}

/**
 * How many videos each category gets on one page (§9.3, §9.4). Categories with a positive
 * score share the main slots in proportion to it, and the exploration share goes to the
 * rest. Someone with no history gets an even mix, since nothing is known about them.
 */
export function allocateCategorySlots({ ranked, pageSize, explorationShare, seed }: AllocationInput): Map<string, number> {
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

  if (known.length === 0) {
    spread(
      others.map((item) => item.categoryId),
      pageSize,
    );
    return counts;
  }

  // At least one slot whenever exploration is on, or small pages would never explore.
  const explorationSlots = others.length === 0 || explorationShare <= 0 ? 0 : Math.max(1, Math.round(pageSize * explorationShare));
  spread(
    others.map((item) => item.categoryId),
    explorationSlots,
  );
  for (const [id, count] of proportionalCounts(known, pageSize - explorationSlots)) {
    if (count > 0) counts.set(id, (counts.get(id) ?? 0) + count);
  }
  return counts;
}

/**
 * Orders items so the same group doesn't appear twice in a row while another is available.
 * Takes the largest remaining group each time, which spreads the big groups evenly.
 */
export function spreadByGroup<T>(items: T[], groupOf: (item: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = groupOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  const result: T[] = [];
  let lastGroup: string | undefined;
  while (result.length < items.length) {
    const candidates = [...groups.entries()].filter(([, group]) => group.length > 0).sort((a, b) => b[1].length - a[1].length);
    const choice = candidates.find(([key]) => key !== lastGroup) ?? candidates[0]!;
    result.push(choice[1].shift()!);
    lastGroup = choice[0];
  }
  return result;
}
