import type { ContentType } from "@prisma/client";
import { z } from "zod";
import { objectIdSchema } from "@/features/categories/schemas";
import { articleCardSelect, topicCardSelect, type TopicCardData } from "@/features/content/cards";
import { publicContentFilter } from "@/features/content/common";
import { resolveInOrder, type ResolvedContent } from "@/features/content/resolve";
import { publicVideoFilter, toVideoCards, videoCardSelect } from "@/features/shorts/video-cards";
import { playlistCardSelect, publicPlaylistFilter } from "@/features/playlists/playlist-filters";
import { libraryCardSelect } from "@/features/content/cards";
import { prisma } from "@/lib/prisma";

const SECTION_LIMIT = 6;
const SHORTS_LIMIT = 10;
const MS_PER_DAY = 86_400_000;

/** Below these, a "popular" list would describe a handful of people, so it isn't shown (§11.3). */
export const POPULAR_WINDOW_DAYS = 30;
export const POPULAR_MIN_VIEWERS = 5;
export const POPULAR_MIN_ITEMS = 3;
const POPULAR_TYPES: ContentType[] = ["TOPIC", "ARTICLE", "PLAYLIST", "VIDEO"];

/**
 * The same for everyone. Explore shows the breadth of the platform, and must not become a
 * second For You feed (§16), so this never reads who is asking.
 */
export async function getExploreSections() {
  const [featuredTopics, updatedTopics, libraries, playlists, articles, newArticles, newLongVideos, newShorts] = await Promise.all([
    prisma.topic.findMany({ where: { ...publicContentFilter, isFeatured: true }, orderBy: [{ displayOrder: "asc" }, { id: "desc" }], take: SECTION_LIMIT, select: topicCardSelect }),
    prisma.topic.findMany({ where: publicContentFilter, orderBy: { updatedAt: "desc" }, take: SECTION_LIMIT, select: topicCardSelect }),
    prisma.library.findMany({
      where: { ...publicContentFilter, OR: [{ parentId: null }, { parentId: { isSet: false } }] },
      orderBy: [{ isFeatured: "desc" }, { displayOrder: "asc" }, { id: "desc" }],
      take: SECTION_LIMIT,
      select: libraryCardSelect,
    }),
    prisma.playlist.findMany({ where: { ...publicPlaylistFilter, isFeatured: true }, orderBy: [{ displayOrder: "asc" }, { id: "desc" }], take: SECTION_LIMIT, select: playlistCardSelect }),
    prisma.article.findMany({ where: { ...publicContentFilter, isFeatured: true }, orderBy: { publishedAt: "desc" }, take: SECTION_LIMIT, select: articleCardSelect }),
    prisma.article.findMany({ where: publicContentFilter, orderBy: { publishedAt: "desc" }, take: 3, select: articleCardSelect }),
    prisma.video.findMany({ where: { ...publicVideoFilter, kind: "LONG_FORM" }, orderBy: { publishedAt: "desc" }, take: 3, select: videoCardSelect }),
    prisma.video.findMany({ where: { ...publicVideoFilter, kind: "SHORT" }, orderBy: { publishedAt: "desc" }, take: SHORTS_LIMIT, select: videoCardSelect }),
  ]);

  const featuredIds = new Set(featuredTopics.map((topic) => topic.id));
  const [longVideos, shorts] = await Promise.all([toVideoCards(newLongVideos), toVideoCards(newShorts)]);

  return {
    featuredTopics,
    // A topic shown just above shouldn't take up room here too.
    updatedTopics: updatedTopics.filter((topic) => !featuredIds.has(topic.id)),
    libraries,
    playlists,
    articles,
    newContent: { articles: newArticles, longVideos, shorts },
  };
}

/**
 * Real use of this site, counted as people rather than visits, because each person has one
 * view record per item. Hidden until there's enough to mean something. YouTube's statistics
 * are never involved, and the page says so (R6).
 */
export async function listPopularContent(now = new Date()): Promise<ResolvedContent[]> {
  const rows = (await prisma.userActivity.aggregateRaw({
    pipeline: [
      { $match: { action: "VIEW", entityType: { $in: POPULAR_TYPES }, occurredAt: { $gte: { $date: new Date(now.getTime() - POPULAR_WINDOW_DAYS * MS_PER_DAY).toISOString() } } } },
      { $group: { _id: { entityType: "$entityType", entityId: "$entityId" }, people: { $sum: 1 } } },
      { $match: { people: { $gte: POPULAR_MIN_VIEWERS } } },
      { $sort: { people: -1, "_id.entityId": 1 } },
      // Some of the most viewed may have since been unpublished.
      { $limit: SECTION_LIMIT * 2 },
    ],
  })) as unknown as { _id: { entityType: ContentType; entityId: { $oid: string } } }[];

  const items = await resolveInOrder(rows.map((row) => ({ entityType: row._id.entityType, entityId: row._id.entityId.$oid })));
  return items.length >= POPULAR_MIN_ITEMS ? items.slice(0, SECTION_LIMIT) : [];
}

const categoryIdsSchema = z.array(objectIdSchema).min(1).max(50);

/**
 * Topic recommendations (§11.3): topics in the categories someone chose, and nothing inferred.
 * Guests' choices live in their browser, so the IDs arrive with the request. Nothing is stored.
 */
export async function listTopicsForInterests(rawCategoryIds: unknown): Promise<TopicCardData[]> {
  const parsed = categoryIdsSchema.safeParse(rawCategoryIds);
  if (!parsed.success) return [];
  return prisma.topic.findMany({
    where: { ...publicContentFilter, categoryId: { in: parsed.data } },
    orderBy: [{ displayOrder: "asc" }, { id: "desc" }],
    take: SECTION_LIMIT,
    select: topicCardSelect,
  });
}
