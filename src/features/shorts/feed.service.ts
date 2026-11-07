import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { publicContentFilter } from "@/features/content/common";
import { isChannelOn, type ChannelChoices } from "@/features/preferences/channel-choices";
import { channelChoicesSchema } from "@/features/preferences/schemas";
import { applySessionMomentum, channelMomentumFactor, rankTopics, type TopicInterest } from "@/features/recommendations/scoring";
import { MAX_SESSION_MOMENTUM } from "@/features/recommendations/session-momentum";
import { getScoringConfig } from "@/features/recommendations/settings.service";
import { objectIdSchema } from "@/features/topics/schemas";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { allocateTopicSlots, planFeedPage, type VideoPool } from "./allocation";
import { decodeFeedCursor, encodeFeedCursor, newFeedCursor, poolKey, type FeedCursor } from "./cursor";
import type { FeedPage, VideoCard } from "./types";
import { publicVideoFilter, toVideoCards, videoCardSelect, type VideoCardRow } from "./video-cards";

export const FEED_PAGE_SIZE = 8;
const MAX_FEED_KEY = 2 ** 31 - 1;
/** A cursor travels in a URL. Past this, a very long session starts a new round rather than fail. */
const MAX_CURSOR_LENGTH = 8000;
/** Well above any realistic library. It only exists so a query is never unbounded. */
const MAX_CHANNEL_TOPIC_LINKS = 10_000;

const guestHintsSchema = z.object({
  selectedTopicIds: z.array(objectIdSchema).max(100),
  channelChoices: channelChoicesSchema,
  behaviour: z.record(objectIdSchema, z.number().finite()),
});

export type GuestFeedHints = z.infer<typeof guestHintsSchema>;

const sessionHintsSchema = z.object({
  topics: z.record(objectIdSchema, z.number().finite()),
  channels: z.record(objectIdSchema, z.number().finite()),
});

export type SessionFeedHints = z.infer<typeof sessionHintsSchema>;

export interface FeedRequest {
  cursor?: string | null;
  topicId?: string | null;
  /** Shorts unless asked otherwise. */
  kind?: "SHORT" | "LONG_FORM";
  /** Used only for guests. Signed-in people's choices always come from their account. */
  guest?: GuestFeedHints;
  /** What happened during this visit, for anyone. It only reorders their own feed, and isn't stored. */
  session?: SessionFeedHints;
}

/**
 * Stands for channels with no published topic, so their videos take part in the feed like a topic
 * does. It's shaped like an ID because cursors validate them, and MongoDB never generates this one.
 */
export const UNASSIGNED_TOPIC_ID = "000000000000000000000000";

const rawIdSchema = z.object({ $oid: objectIdSchema }).nullish();
const channelCountsSchema = z.array(z.object({ _id: rawIdSchema, count: z.number().int() }));

const NO_CHANNEL = { OR: [{ channelId: null }, { channelId: { isSet: false } }] };

/**
 * Reads the next videos of one channel, from the session's start key to the end, then wrapping
 * around to just below it. A count of what's been read is enough, since (feedKey, id) is a
 * stable order, and it keeps the cursor small however long the session runs.
 */
async function readPool(pool: VideoPool, kind: "SHORT" | "LONG_FORM", startKey: number, alreadyRead: number, take: number): Promise<VideoCardRow[]> {
  const where: Prisma.VideoWhereInput = { ...publicVideoFilter, kind, ...(pool.channelId === null ? NO_CHANNEL : { channelId: pool.channelId }) };
  const order: Prisma.VideoOrderByWithRelationInput[] = [{ feedKey: "asc" }, { id: "asc" }];

  const above = await prisma.video.findMany({ where: { ...where, feedKey: { gte: startKey } }, orderBy: order, skip: alreadyRead, take, select: videoCardSelect });
  if (above.length === take) return above;

  const countAbove = await prisma.video.count({ where: { ...where, feedKey: { gte: startKey } } });
  const below = await prisma.video.findMany({ where: { ...where, feedKey: { lt: startKey } }, orderBy: order, skip: Math.max(0, alreadyRead - countAbove), take: take - above.length, select: videoCardSelect });
  return [...above, ...below];
}

/** What's published, per channel, with each channel's public topics. It reads only counts, never the videos. */
async function loadPools(publicTopicIds: ReadonlySet<string>, kind: "SHORT" | "LONG_FORM"): Promise<VideoPool[]> {
  const [raw, links] = await Promise.all([
    // Raw, because Prisma's groupBy panics on MongoDB when a grouped field is missing from a document.
    prisma.video.aggregateRaw({ pipeline: [{ $match: { ...publicVideoFilter, kind } }, { $group: { _id: "$channelId", count: { $sum: 1 } } }] }),
    prisma.channelTopic.findMany({ take: MAX_CHANNEL_TOPIC_LINKS, select: { channelId: true, topicId: true } }),
  ]);

  const topicsByChannel = new Map<string, string[]>();
  for (const { channelId, topicId } of links) {
    if (publicTopicIds.has(topicId)) topicsByChannel.set(channelId, [...(topicsByChannel.get(channelId) ?? []), topicId]);
  }

  return channelCountsSchema.parse(raw).map(({ _id, count }) => {
    const channelId = _id?.$oid ?? null;
    const topicIds = channelId ? topicsByChannel.get(channelId) : undefined;
    return { topicIds: topicIds ?? [UNASSIGNED_TOPIC_ID], channelId, remaining: count };
  });
}

async function listPublicTopicIds(): Promise<string[]> {
  const topics = await prisma.topic.findMany({
    where: publicContentFilter,
    orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
    take: 200,
    select: { id: true },
  });
  return topics.map((topic) => topic.id);
}

interface Personalisation {
  interests: TopicInterest[];
  selectedTopicIds: string[];
  channelChoices: ChannelChoices;
}

async function loadPersonalisation(actor: Actor | null, guest: GuestFeedHints | undefined, maxBehaviour: number): Promise<Personalisation> {
  if (actor) {
    const [interests, choices] = await Promise.all([
      prisma.userInterest.findMany({ where: { userId: actor.id }, select: { topicId: true, isSelected: true, explicitWeight: true, behaviourScore: true, lastSignalAt: true } }),
      prisma.userChannelChoice.findMany({ where: { userId: actor.id }, select: { channelId: true, isEnabled: true } }),
    ]);
    return {
      interests,
      selectedTopicIds: interests.filter((interest) => interest.isSelected).map((interest) => interest.topicId),
      channelChoices: Object.fromEntries(choices.map((choice) => [choice.channelId, choice.isEnabled])),
    };
  }
  if (!guest) return { interests: [], selectedTopicIds: [], channelChoices: {} };

  // A guest's hints only reorder their own feed, but they're still bounded like any input.
  const ids = new Set([...guest.selectedTopicIds, ...Object.keys(guest.behaviour)]);
  const selected = new Set(guest.selectedTopicIds);
  return {
    interests: [...ids].map((topicId) => ({
      topicId,
      explicitWeight: selected.has(topicId) ? 1 : 0,
      behaviourScore: Math.max(-maxBehaviour, Math.min(maxBehaviour, guest.behaviour[topicId] ?? 0)),
      lastSignalAt: null,
    })),
    selectedTopicIds: guest.selectedTopicIds,
    channelChoices: guest.channelChoices,
  };
}

function parseCursor(raw: string | null | undefined): FeedCursor {
  if (!raw) return newFeedCursor(randomInt(MAX_FEED_KEY));
  const cursor = decodeFeedCursor(raw);
  if (!cursor) throw new AppError("VALIDATION");
  return cursor;
}

const clampMomentum = (record: Record<string, number>) => Object.fromEntries(Object.entries(record).map(([id, value]) => [id, Math.max(-MAX_SESSION_MOMENTUM, Math.min(MAX_SESSION_MOMENTUM, value))]));

/**
 * One feed page, from stored data only: this never calls the YouTube API. Channels someone has
 * switched off, or that don't match their topics, aren't read at all. Each topic's share comes
 * from the transparent score, plus what happened this visit. Then channels are chosen for each
 * card, so variety holds across pages and however uneven the library is. No video is read twice
 * in a round, and nextCursor is null once all of them have been.
 */
export async function getFeedPage(actor: Actor | null, request: FeedRequest, pageSize = FEED_PAGE_SIZE): Promise<FeedPage> {
  const cursor = parseCursor(request.cursor);
  const config = await getScoringConfig();

  const topicIds = await listPublicTopicIds();
  const publicTopics = new Set(topicIds);
  let onlyTopicId: string | null = null;
  if (request.topicId) {
    const parsed = objectIdSchema.safeParse(request.topicId);
    if (!parsed.success) throw new AppError("VALIDATION");
    if (!publicTopics.has(parsed.data)) throw new AppError("NOT_FOUND");
    onlyTopicId = parsed.data;
  }

  const guest = request.guest ? guestHintsSchema.safeParse(request.guest) : undefined;
  if (guest && !guest.success) throw new AppError("VALIDATION");
  const session = request.session ? sessionHintsSchema.safeParse(request.session) : undefined;
  if (session && !session.success) throw new AppError("VALIDATION");
  const topicMomentum = clampMomentum(session?.data.topics ?? {});
  const channelMomentum = clampMomentum(session?.data.channels ?? {});

  const { interests, selectedTopicIds, channelChoices } = await loadPersonalisation(actor, guest?.data, config.maxBehaviourScore);
  // A chosen topic may have been unpublished since. If none is left, it's as if none was chosen.
  const selected = new Set(selectedTopicIds.filter((id) => publicTopics.has(id)));

  const kind = request.kind ?? "SHORT";
  const readCount = (pool: VideoPool) => cursor.o[poolKey(pool.channelId)] ?? 0;
  const pools = (await loadPools(publicTopics, kind))
    .filter((pool) => (pool.channelId ? isChannelOn(pool.channelId, pool.topicIds, selected, channelChoices) : selected.size === 0))
    .filter((pool) => !onlyTopicId || pool.topicIds.includes(onlyTopicId))
    .map((pool) => ({ ...pool, topicIds: onlyTopicId ? [onlyTopicId] : pool.topicIds, remaining: Math.max(0, pool.remaining - readCount(pool)) }))
    .filter((pool) => pool.remaining > 0);

  // Only topics with something left, so an empty one can't take up exploration slots.
  const withVideos = new Set(pools.flatMap((pool) => pool.topicIds));
  const open = [...topicIds, UNASSIGNED_TOPIC_ID].filter((id) => withVideos.has(id));

  const ranked = applySessionMomentum(rankTopics(open, interests, new Date(), config), topicMomentum, config);
  const seed = cursor.s + cursor.n;
  const picks = planFeedPage({
    topicOrder: ranked.map((item) => item.topicId),
    slots: allocateTopicSlots({ ranked, pageSize, explorationShare: onlyTopicId ? 0 : config.explorationShare, seed, maxCategoryShare: onlyTopicId ? 1 : config.maxCategoryShare }),
    pools,
    recentChannels: cursor.r,
    channelSpacing: config.channelSpacing,
    pageSize,
    channelFactor: (channelId) => channelMomentumFactor(channelMomentum[channelId] ?? 0, config),
    seed,
  });

  const wanted = new Map<string, { pool: VideoPool; count: number }>();
  for (const pick of picks) {
    const key = poolKey(pick.channelId);
    const entry = wanted.get(key);
    if (entry) entry.count += 1;
    else wanted.set(key, { pool: pools.find((pool) => pool.channelId === pick.channelId)!, count: 1 });
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
    const row = readRows.get(poolKey(pick.channelId))?.shift();
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
