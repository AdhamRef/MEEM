import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { objectIdSchema } from "@/features/categories/schemas";
import { rankCategories, type CategoryInterest } from "@/features/recommendations/scoring";
import { getScoringConfig } from "@/features/recommendations/settings.service";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { allocateCategorySlots, spreadByGroup } from "./allocation";
import { decodeFeedCursor, encodeFeedCursor, newFeedCursor, type CategoryPosition, type FeedCursor } from "./cursor";
import type { FeedPage, VideoCard } from "./types";
import { publicVideoFilter, toVideoCards, videoCardSelect, type VideoCardRow } from "./video-cards";

export const FEED_PAGE_SIZE = 8;
const MAX_FEED_KEY = 2 ** 31 - 1;

const guestHintsSchema = z.object({
  selectedCategoryIds: z.array(objectIdSchema).max(100),
  behaviour: z.record(objectIdSchema, z.number().finite()),
});

export type GuestFeedHints = z.infer<typeof guestHintsSchema>;

export interface FeedRequest {
  cursor?: string | null;
  categoryId?: string | null;
  /** Used only for guests. Signed-in people's interests always come from their account. */
  guest?: GuestFeedHints;
}

/**
 * Stands for Shorts with no category, so they take part in the feed like a category does.
 * It's shaped like an ID because cursors validate them, and MongoDB never generates this one.
 */
export const UNCATEGORIZED_FEED_ID = "000000000000000000000000";

/**
 * Reads one category from the session's start key to the end, then wraps around to just
 * below the start. Ordering by (feedKey, id) is stable and uses the feed index, and each
 * video is read at most once per session, which is what prevents duplicates.
 */
async function readCategory(categoryId: string, startKey: number, position: CategoryPosition | undefined, take: number) {
  const rows: VideoCardRow[] = [];
  let current = position;
  let isFinished = false;

  const read = async (wrapped: boolean, limit: number) => {
    const after: Prisma.VideoWhereInput[] = current && current.w === wrapped ? [{ feedKey: { gt: current.k } }, { feedKey: current.k, id: { gt: current.i } }] : [];
    return prisma.video.findMany({
      where: {
        ...publicVideoFilter,
        kind: "SHORT",
        // Not set can be null or missing, and those differ in filters.
        ...(categoryId === UNCATEGORIZED_FEED_ID ? { OR: [{ categoryId: null }, { categoryId: { isSet: false } }] } : { categoryId }),
        ...(wrapped ? { feedKey: { lt: startKey } } : { feedKey: { gte: startKey } }),
        ...(after.length ? { AND: [{ OR: after }] } : {}),
      },
      orderBy: [{ feedKey: "asc" }, { id: "asc" }],
      take: limit,
      select: videoCardSelect,
    });
  };

  if (!current?.w) {
    const firstPart = await read(false, take);
    rows.push(...firstPart);
  }
  if (rows.length < take) {
    const secondPart = await read(true, take - rows.length);
    rows.push(...secondPart);
    isFinished = rows.length < take;
  }

  const last = rows.at(-1);
  if (last) current = { k: last.feedKey, i: last.id, w: last.feedKey < startKey };
  return { rows, position: current, isFinished };
}

async function activeCategoryIds(): Promise<string[]> {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
    take: 200,
    select: { id: true },
  });
  return categories.map((category) => category.id);
}

async function loadInterests(actor: Actor | null, guest: GuestFeedHints | undefined, maxBehaviour: number): Promise<CategoryInterest[]> {
  if (actor) {
    const interests = await prisma.userInterest.findMany({
      where: { userId: actor.id },
      select: { categoryId: true, explicitWeight: true, behaviourScore: true, lastSignalAt: true },
    });
    return interests;
  }
  if (!guest) return [];

  // A guest's hints only reorder their own feed, but they're still bounded like any input.
  const ids = new Set([...guest.selectedCategoryIds, ...Object.keys(guest.behaviour)]);
  const selected = new Set(guest.selectedCategoryIds);
  return [...ids].map((categoryId) => ({
    categoryId,
    explicitWeight: selected.has(categoryId) ? 1 : 0,
    behaviourScore: Math.max(-maxBehaviour, Math.min(maxBehaviour, guest.behaviour[categoryId] ?? 0)),
    lastSignalAt: null,
  }));
}

function parseCursor(raw: string | null | undefined): FeedCursor {
  if (!raw) return newFeedCursor(randomInt(MAX_FEED_KEY));
  const cursor = decodeFeedCursor(raw);
  if (!cursor) throw new AppError("VALIDATION");
  return cursor;
}

/**
 * One feed page, from stored data only: this never calls the YouTube API. Each category's
 * slots come from the transparent score, and unused slots pass to categories with videos
 * left, so a page is only short when the whole feed is nearly finished.
 */
export async function getFeedPage(actor: Actor | null, request: FeedRequest, pageSize = FEED_PAGE_SIZE): Promise<FeedPage> {
  const cursor = parseCursor(request.cursor);
  const config = await getScoringConfig();

  let categoryIds = await activeCategoryIds();
  if (request.categoryId) {
    const parsed = objectIdSchema.safeParse(request.categoryId);
    if (!parsed.success) throw new AppError("VALIDATION");
    if (!categoryIds.includes(parsed.data)) throw new AppError("NOT_FOUND");
    categoryIds = [parsed.data];
  } else if (await prisma.video.findFirst({ where: { ...publicVideoFilter, kind: "SHORT", OR: [{ categoryId: null }, { categoryId: { isSet: false } }] }, select: { id: true } })) {
    // Only when there's something in it, or an empty group would take up exploration slots.
    categoryIds = [...categoryIds, UNCATEGORIZED_FEED_ID];
  }

  const guest = request.guest ? guestHintsSchema.safeParse(request.guest) : undefined;
  if (guest && !guest.success) throw new AppError("VALIDATION");

  const finished = new Set(cursor.d);
  const open = categoryIds.filter((id) => !finished.has(id));

  const interests = await loadInterests(actor, guest?.data, config.maxBehaviourScore);
  const ranked = rankCategories(open, interests, new Date(), config);
  const slots = allocateCategorySlots({
    ranked,
    pageSize,
    explorationShare: request.categoryId ? 0 : config.explorationShare,
    seed: cursor.s + cursor.n,
  });

  const rows: VideoCardRow[] = [];
  const positions = { ...cursor.p };

  const take = async (categoryId: string, count: number) => {
    const result = await readCategory(categoryId, cursor.s, positions[categoryId], count);
    rows.push(...result.rows);
    if (result.position) positions[categoryId] = result.position;
    if (result.isFinished) finished.add(categoryId);
  };

  for (const [categoryId, count] of slots) await take(categoryId, count);

  // Second pass: slots a small category couldn't fill go to the highest-ranked with videos left.
  for (const { categoryId } of ranked) {
    const missing = pageSize - rows.length;
    if (missing <= 0) break;
    if (!finished.has(categoryId)) await take(categoryId, missing);
  }

  // Spread by category, then keep one channel from running on when it can be avoided.
  const byCategory = spreadByGroup(rows, (row) => row.categoryId ?? "");
  const ordered = spreadByGroup(byCategory, (row) => row.channelId ?? row.id);
  const cards: VideoCard[] = await toVideoCards(ordered);

  const hasMore = categoryIds.some((id) => !finished.has(id));
  return {
    items: cards,
    nextCursor: hasMore ? encodeFeedCursor({ s: cursor.s, n: cursor.n + 1, p: positions, d: [...finished] }) : null,
  };
}

/** A public video for its own page, in any kind. Null when it can't be shown. */
export async function getPublicVideo(rawId: string): Promise<VideoCard | null> {
  const id = objectIdSchema.safeParse(rawId);
  if (!id.success) return null;
  const row = await prisma.video.findFirst({ where: { id: id.data, ...publicVideoFilter }, select: videoCardSelect });
  if (!row) return null;
  const [card] = await toVideoCards([row]);
  return card ?? null;
}
