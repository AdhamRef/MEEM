import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { objectIdSchema } from "@/features/categories/schemas";
import { applySessionMomentum, channelMomentumFactor, rankCategories, type CategoryInterest } from "@/features/recommendations/scoring";
import { MAX_SESSION_MOMENTUM } from "@/features/recommendations/session-momentum";
import { getScoringConfig } from "@/features/recommendations/settings.service";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { allocateCategorySlots, planFeedPage, type VideoPool } from "./allocation";
import { decodeFeedCursor, encodeFeedCursor, newFeedCursor, poolKey, type FeedCursor } from "./cursor";
import type { FeedPage, VideoCard } from "./types";
import { publicVideoFilter, toVideoCards, videoCardSelect, type VideoCardRow } from "./video-cards";

export const FEED_PAGE_SIZE = 8;
const MAX_FEED_KEY = 2 ** 31 - 1;
/** A cursor travels in a URL. Past this, a very long session starts a new round rather than fail. */
const MAX_CURSOR_LENGTH = 8000;

const guestHintsSchema = z.object({
  selectedCategoryIds: z.array(objectIdSchema).max(100),
  behaviour: z.record(objectIdSchema, z.number().finite()),
});

export type GuestFeedHints = z.infer<typeof guestHintsSchema>;

const sessionHintsSchema = z.object({
  categories: z.record(objectIdSchema, z.number().finite()),
  channels: z.record(objectIdSchema, z.number().finite()),
});

export type SessionFeedHints = z.infer<typeof sessionHintsSchema>;

export interface FeedRequest {
  cursor?: string | null;
  categoryId?: string | null;
  /** Shorts unless asked otherwise. */
  kind?: "SHORT" | "LONG_FORM";
  /** Used only for guests. Signed-in people's interests always come from their account. */
  guest?: GuestFeedHints;
  /** What happened during this visit, for anyone. It only reorders their own feed, and isn't stored. */
  session?: SessionFeedHints;
}

/**
 * Stands for Shorts with no category, so they take part in the feed like a category does.
 * It's shaped like an ID because cursors validate them, and MongoDB never generates this one.
 */
export const UNCATEGORIZED_FEED_ID = "000000000000000000000000";

const rawIdSchema = z.object({ $oid: objectIdSchema }).nullish();
const poolGroupsSchema = z.array(z.object({ _id: z.object({ category: rawIdSchema, channel: rawIdSchema }), count: z.number().int() }));

const NO_VALUE = (field: "categoryId" | "channelId") => ({ OR: [{ [field]: null }, { [field]: { isSet: false } }] });

/**
 * Reads the next videos of one pool, from the session's start key to the end, then wrapping
 * around to just below it. A count of what's been read is enough, since (feedKey, id) is a
 * stable order, and it keeps the cursor small however long the session runs.
 */
async function readPool(pool: VideoPool, kind: "SHORT" | "LONG_FORM", startKey: number, alreadyRead: number, take: number): Promise<VideoCardRow[]> {
  const where: Prisma.VideoWhereInput = {
    ...publicVideoFilter,
    kind,
    AND: [pool.categoryId === UNCATEGORIZED_FEED_ID ? NO_VALUE("categoryId") : { categoryId: pool.categoryId }, pool.channelId === null ? NO_VALUE("channelId") : { channelId: pool.channelId }],
  };
  const order: Prisma.VideoOrderByWithRelationInput[] = [{ feedKey: "asc" }, { id: "asc" }];

  const above = await prisma.video.findMany({ where: { ...where, feedKey: { gte: startKey } }, orderBy: order, skip: alreadyRead, take, select: videoCardSelect });
  if (above.length === take) return above;

  const countAbove = await prisma.video.count({ where: { ...where, feedKey: { gte: startKey } } });
  const below = await prisma.video.findMany({ where: { ...where, feedKey: { lt: startKey } }, orderBy: order, skip: Math.max(0, alreadyRead - countAbove), take: take - above.length, select: videoCardSelect });
  return [...above, ...below];
}

/** What's published, by category and channel. It reads only these counts, never the videos. */
async function loadPools(categoryIds: string[], onlyCategoryId: string | null, kind: "SHORT" | "LONG_FORM"): Promise<VideoPool[]> {
  // Raw, because Prisma's groupBy panics on MongoDB when a grouped field is missing from a document.
  const raw = await prisma.video.aggregateRaw({
    pipeline: [
      { $match: { ...publicVideoFilter, kind, ...(onlyCategoryId ? { categoryId: { $oid: onlyCategoryId } } : {}) } },
      { $group: { _id: { category: "$categoryId", channel: "$channelId" }, count: { $sum: 1 } } },
    ],
  });
  const groups = poolGroupsSchema.parse(raw);
  const active = new Set(categoryIds);
  return groups.flatMap(({ _id, count }) => {
    const categoryId = _id.category?.$oid ?? null;
    if (categoryId && !active.has(categoryId)) return [];
    return [{ categoryId: categoryId ?? UNCATEGORIZED_FEED_ID, channelId: _id.channel?.$oid ?? null, remaining: count }];
  });
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

const clampMomentum = (record: Record<string, number>) => Object.fromEntries(Object.entries(record).map(([id, value]) => [id, Math.max(-MAX_SESSION_MOMENTUM, Math.min(MAX_SESSION_MOMENTUM, value))]));

/**
 * One feed page, from stored data only: this never calls the YouTube API. Each category's share
 * comes from the transparent score, plus what happened this visit. Then channels are chosen for
 * each card, so variety holds across pages and however uneven the library is. No video is read
 * twice in a round, and nextCursor is null once all of them have been.
 */
export async function getFeedPage(actor: Actor | null, request: FeedRequest, pageSize = FEED_PAGE_SIZE): Promise<FeedPage> {
  const cursor = parseCursor(request.cursor);
  const config = await getScoringConfig();

  let categoryIds = await activeCategoryIds();
  let onlyCategoryId: string | null = null;
  if (request.categoryId) {
    const parsed = objectIdSchema.safeParse(request.categoryId);
    if (!parsed.success) throw new AppError("VALIDATION");
    if (!categoryIds.includes(parsed.data)) throw new AppError("NOT_FOUND");
    onlyCategoryId = parsed.data;
    categoryIds = [parsed.data];
  }

  const guest = request.guest ? guestHintsSchema.safeParse(request.guest) : undefined;
  if (guest && !guest.success) throw new AppError("VALIDATION");
  const session = request.session ? sessionHintsSchema.safeParse(request.session) : undefined;
  if (session && !session.success) throw new AppError("VALIDATION");
  const categoryMomentum = clampMomentum(session?.data.categories ?? {});
  const channelMomentum = clampMomentum(session?.data.channels ?? {});

  const kind = request.kind ?? "SHORT";
  const allPools = await loadPools(categoryIds, onlyCategoryId, kind);
  const readCount = (pool: VideoPool) => cursor.o[poolKey(pool.categoryId, pool.channelId)] ?? 0;
  const pools = allPools.map((pool) => ({ ...pool, remaining: Math.max(0, pool.remaining - readCount(pool)) })).filter((pool) => pool.remaining > 0);

  // Only categories with something left, so an empty one can't take up exploration slots.
  const withVideos = new Set(pools.map((pool) => pool.categoryId));
  const open = [...categoryIds, UNCATEGORIZED_FEED_ID].filter((id) => withVideos.has(id));

  const interests = await loadInterests(actor, guest?.data, config.maxBehaviourScore);
  const ranked = applySessionMomentum(rankCategories(open, interests, new Date(), config), categoryMomentum, config);
  const seed = cursor.s + cursor.n;
  const picks = planFeedPage({
    categoryOrder: ranked.map((item) => item.categoryId),
    slots: allocateCategorySlots({ ranked, pageSize, explorationShare: onlyCategoryId ? 0 : config.explorationShare, seed, maxCategoryShare: onlyCategoryId ? 1 : config.maxCategoryShare }),
    pools,
    recentChannels: cursor.r,
    channelSpacing: config.channelSpacing,
    pageSize,
    channelFactor: (channelId) => channelMomentumFactor(channelMomentum[channelId] ?? 0, config),
    seed,
  });

  const wanted = new Map<string, { pool: VideoPool; count: number }>();
  for (const pick of picks) {
    const key = poolKey(pick.categoryId, pick.channelId);
    const entry = wanted.get(key);
    if (entry) entry.count += 1;
    else wanted.set(key, { pool: pools.find((pool) => pool.categoryId === pick.categoryId && pool.channelId === pick.channelId)!, count: 1 });
  }

  const positions = { ...cursor.o };
  const readRows = new Map<string, VideoCardRow[]>();
  await Promise.all(
    [...wanted].map(async ([key, { pool, count }]) => {
      readRows.set(key, await readPool(pool, kind, cursor.s, positions[key] ?? 0, count));
    }),
  );
  for (const [key, { count }] of wanted) positions[key] = (positions[key] ?? 0) + count;

  const ordered = picks.flatMap((pick) => {
    const row = readRows.get(poolKey(pick.categoryId, pick.channelId))?.shift();
    return row ? [row] : [];
  });
  const cards: VideoCard[] = await toVideoCards(ordered);

  const leftOver = pools.reduce((total, pool) => total + pool.remaining, 0) - picks.length;
  if (leftOver <= 0) return { items: cards, nextCursor: null };

  const shown = [...cursor.r, ...ordered.flatMap((row) => (row.channelId ? [row.channelId] : []))];
  const next: FeedCursor = { s: cursor.s, n: cursor.n + 1, o: positions, r: config.channelSpacing === 0 ? [] : shown.slice(-config.channelSpacing) };
  const encoded = encodeFeedCursor(next);
  return { items: cards, nextCursor: encoded.length <= MAX_CURSOR_LENGTH ? encoded : encodeFeedCursor({ ...newFeedCursor(randomInt(MAX_FEED_KEY)), r: next.r }) };
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
