import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { strings } from "@/config/strings.ar";
import { objectIdSchema } from "@/features/topics/schemas";
import { publicContentFilter } from "@/features/content/common";
import { resolveInOrder, type ContentRef, type ResolvedContent } from "@/features/content/resolve";
import { publicPlaylistFilter } from "@/features/playlists/playlist-filters";
import { videoPickerLabel } from "@/features/relationships/picker.service";
import { publicVideoFilter } from "@/features/shorts/video-cards";
import { prisma } from "@/lib/prisma";
import { normalizeArabicForSearch } from "@/lib/search/normalize";
import { mergeRanked, parseSearchTerms, titleMatchesQuery, type SearchTerms } from "@/lib/search/query";

export const SEARCH_TYPES = ["TOPIC", "SHORT", "LONG_VIDEO", "ARTICLE", "PLAYLIST", "LIBRARY", "RESOURCE"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** Types a topic filter can narrow. A topic doesn't belong to another topic. */
export const TOPIC_FILTERED_TYPES: readonly SearchType[] = ["SHORT", "LONG_VIDEO", "ARTICLE", "PLAYLIST", "LIBRARY", "RESOURCE"];

const OVERVIEW_LIMIT = 6;
const PAGE_SIZE = 12;
/** A person who hasn't found it after this many results needs a better query, not more pages. */
const MAX_PAGES = 25;
const MAX_LINKED_RESULTS = 200;
const MAX_MATCHING_TOPICS = 30;
/** Bounds a topic filter's list of IDs, which goes into a text query. */
const MAX_TOPIC_SCOPE = 1000;
const SUGGESTIONS_PER_TYPE = 3;
const MAX_SUGGESTIONS = 8;

const entityTypeOf: Record<SearchType, ContentRef["entityType"]> = {
  TOPIC: "TOPIC",
  SHORT: "VIDEO",
  LONG_VIDEO: "VIDEO",
  ARTICLE: "ARTICLE",
  PLAYLIST: "PLAYLIST",
  LIBRARY: "LIBRARY",
  RESOURCE: "RESOURCE",
};

const searchInputSchema = z.object({
  query: z.string().trim().max(120).catch(""),
  type: z.enum(SEARCH_TYPES).optional().catch(undefined),
  topicId: objectIdSchema.optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(MAX_PAGES).catch(1),
});

interface TypeSearchOptions {
  terms: SearchTerms;
  scope: TopicScope | null;
  limit: number;
}

/**
 * Public filters as MongoDB receives them. $text needs a raw query, and these say the same as
 * publicVideoFilter and the others, with the same results checked again when items are loaded.
 */
const rawPublicFilter = { status: publicContentFilter.status, isArchived: publicContentFilter.isArchived };
const rawVideoFilter = { status: publicVideoFilter.status, isArchived: publicVideoFilter.isArchived, availability: publicVideoFilter.availability };

/** What a topic filter allows, as IDs per kind of content, read once per search. */
interface TopicScope {
  channelIds: string[];
  articleIds: string[];
  playlistIds: string[];
  libraryIds: string[];
  resourceIds: string[];
}

async function loadTopicScope(topicId: string): Promise<TopicScope> {
  const take = MAX_TOPIC_SCOPE;
  const where = { topicId };
  const [channels, articles, playlists, libraries, resources] = await Promise.all([
    prisma.channelTopic.findMany({ where, take, select: { channelId: true } }),
    prisma.articleTopic.findMany({ where, take, select: { articleId: true } }),
    prisma.playlistTopic.findMany({ where, take, select: { playlistId: true } }),
    prisma.libraryTopic.findMany({ where, take, select: { libraryId: true } }),
    prisma.resourceTopic.findMany({ where, take, select: { resourceId: true } }),
  ]);
  return {
    channelIds: channels.map((row) => row.channelId),
    articleIds: articles.map((row) => row.articleId),
    playlistIds: playlists.map((row) => row.playlistId),
    libraryIds: libraries.map((row) => row.libraryId),
    resourceIds: resources.map((row) => row.resourceId),
  };
}

const rawIds = (ids: string[]) => ({ $in: ids.map((id) => ({ $oid: id })) });

function rawFilterFor(type: SearchType, scope: TopicScope | null): Prisma.InputJsonObject {
  switch (type) {
    case "SHORT":
      return { ...rawVideoFilter, kind: "SHORT", ...(scope ? { channelId: rawIds(scope.channelIds) } : {}) };
    case "LONG_VIDEO":
      return { ...rawVideoFilter, kind: "LONG_FORM", ...(scope ? { channelId: rawIds(scope.channelIds) } : {}) };
    case "PLAYLIST":
      return { ...rawPublicFilter, title: { $ne: "" }, ...(scope ? { _id: rawIds(scope.playlistIds) } : {}) };
    case "ARTICLE":
      return { ...rawPublicFilter, ...(scope ? { _id: rawIds(scope.articleIds) } : {}) };
    case "LIBRARY":
      return { ...rawPublicFilter, ...(scope ? { _id: rawIds(scope.libraryIds) } : {}) };
    case "RESOURCE":
      return { ...rawPublicFilter, ...(scope ? { _id: rawIds(scope.resourceIds) } : {}) };
    case "TOPIC":
      return rawPublicFilter;
  }
}

function aggregate(type: SearchType, pipeline: Prisma.InputJsonValue[]) {
  const args = { pipeline };
  switch (type) {
    case "SHORT":
    case "LONG_VIDEO":
      return prisma.video.aggregateRaw(args);
    case "ARTICLE":
      return prisma.article.aggregateRaw(args);
    case "TOPIC":
      return prisma.topic.aggregateRaw(args);
    case "LIBRARY":
      return prisma.library.aggregateRaw(args);
    case "PLAYLIST":
      return prisma.playlist.aggregateRaw(args);
    case "RESOURCE":
      return prisma.externalResource.aggregateRaw(args);
  }
}

/** Best matches first. The ID breaks ties, so a page always continues where the last one ended. */
async function directMatches(type: SearchType, { terms, scope, limit }: TypeSearchOptions): Promise<string[]> {
  const rows = (await aggregate(type, [
    { $match: { $text: { $search: terms.textQuery }, ...rawFilterFor(type, scope) } },
    { $sort: { score: { $meta: "textScore" }, _id: 1 } },
    { $limit: limit },
    { $project: { _id: 1 } },
  ])) as unknown as { _id: { $oid: string } }[];
  return rows.map((row) => row._id.$oid);
}

interface MatchedTopics {
  topicIds: string[];
  channelIds: string[];
}

/** Topics named by the query. Their content counts, even if it doesn't repeat the name. */
async function findMatchedTopics(terms: SearchTerms): Promise<MatchedTopics> {
  const topics = (await prisma.topic.aggregateRaw({
    pipeline: [
      { $match: { $text: { $search: terms.textQuery }, ...rawPublicFilter } },
      { $sort: { score: { $meta: "textScore" }, _id: 1 } },
      { $limit: MAX_MATCHING_TOPICS },
      { $project: { _id: 1, titleSearch: 1 } },
    ],
  })) as unknown as { _id: { $oid: string }; titleSearch: string }[];

  const topicIds = topics.filter((topic) => titleMatchesQuery(topic.titleSearch, terms.words)).map((topic) => topic._id.$oid);
  if (topicIds.length === 0) return { topicIds, channelIds: [] };
  const links = await prisma.channelTopic.findMany({ where: { topicId: { in: topicIds } }, take: MAX_TOPIC_SCOPE, select: { channelId: true } });
  return { topicIds, channelIds: [...new Set(links.map((link) => link.channelId))] };
}

async function linkedMatches(type: SearchType, { topicIds, channelIds }: MatchedTopics, scope: TopicScope | null, limit: number): Promise<string[]> {
  if (topicIds.length === 0) return [];

  const common = { orderBy: { id: "desc" as const }, take: limit, select: { id: true } };
  const linked = { some: { topicId: { in: topicIds } } };
  let rows: { id: string }[] = [];

  switch (type) {
    case "SHORT":
    case "LONG_VIDEO": {
      const allowed = scope ? channelIds.filter((id) => scope.channelIds.includes(id)) : channelIds;
      if (allowed.length) rows = await prisma.video.findMany({ ...common, where: { ...publicVideoFilter, kind: type === "SHORT" ? "SHORT" : "LONG_FORM", channelId: { in: allowed } } });
      break;
    }
    case "ARTICLE":
      rows = await prisma.article.findMany({ ...common, where: { ...publicContentFilter, topics: linked, ...(scope ? { id: { in: scope.articleIds } } : {}) } });
      break;
    case "TOPIC":
      break;
    case "PLAYLIST":
      rows = await prisma.playlist.findMany({ ...common, where: { ...publicPlaylistFilter, topics: linked, ...(scope ? { id: { in: scope.playlistIds } } : {}) } });
      break;
    case "LIBRARY":
      rows = await prisma.library.findMany({ ...common, where: { ...publicContentFilter, topics: linked, ...(scope ? { id: { in: scope.libraryIds } } : {}) } });
      break;
    case "RESOURCE":
      rows = await prisma.externalResource.findMany({ ...common, where: { ...publicContentFilter, topics: linked, ...(scope ? { id: { in: scope.resourceIds } } : {}) } });
      break;
  }
  return rows.map((row) => row.id);
}

export interface SearchGroup {
  type: SearchType;
  items: ResolvedContent[];
  hasMore: boolean;
}

async function searchOneType(type: SearchType, terms: SearchTerms, matched: MatchedTopics, scope: TopicScope | null, offset: number, size: number): Promise<SearchGroup> {
  // One more than needed shows whether another page exists.
  const needed = offset + size + 1;
  const [direct, linked] = await Promise.all([directMatches(type, { terms, scope, limit: needed }), linkedMatches(type, matched, scope, Math.min(needed, MAX_LINKED_RESULTS))]);
  const ranked = mergeRanked(direct, linked);
  const refs = ranked.slice(offset, offset + size).map((entityId) => ({ entityType: entityTypeOf[type], entityId }));
  return { type, items: await resolveInOrder(refs), hasMore: ranked.length > offset + size };
}

export type SearchResult =
  | { status: "EMPTY_QUERY"; query: string; type?: SearchType; topicId?: string }
  | { status: "OVERVIEW"; query: string; topicId?: string; groups: SearchGroup[] }
  | { status: "TYPE"; query: string; type: SearchType; topicId?: string; page: number; group: SearchGroup };

/**
 * Searches stored data only. Titles, descriptions and tags are in the text index. Topic names
 * work through the content connected to them (§17). Queries aren't stored.
 */
export async function searchContent(rawInput: unknown): Promise<SearchResult> {
  const input = searchInputSchema.parse(rawInput);
  const { query, type, topicId, page } = input;
  const terms = parseSearchTerms(query);
  if (!terms) return { status: "EMPTY_QUERY", query, type, topicId };

  const [matched, scope] = await Promise.all([findMatchedTopics(terms), topicId ? loadTopicScope(topicId) : null]);

  if (type) {
    if (topicId && !TOPIC_FILTERED_TYPES.includes(type)) return { status: "TYPE", query, type, topicId, page: 1, group: { type, items: [], hasMore: false } };
    const group = await searchOneType(type, terms, matched, scope, (page - 1) * PAGE_SIZE, PAGE_SIZE);
    return { status: "TYPE", query, type, topicId, page, group: { ...group, hasMore: group.hasMore && page < MAX_PAGES } };
  }

  const types = topicId ? TOPIC_FILTERED_TYPES : SEARCH_TYPES;
  const groups = await Promise.all(types.map((candidate) => searchOneType(candidate, terms, matched, scope, 0, OVERVIEW_LIMIT)));
  return { status: "OVERVIEW", query, topicId, groups: groups.filter((group) => group.items.length > 0) };
}

export interface SearchSuggestion {
  id: string;
  label: string;
  hint: string;
  href: string;
}

const pathFor = (base: string, slug: string) => `/${base}/${encodeURIComponent(slug)}`;

/**
 * Titles beginning with what's been typed, using the title indexes. A title often starts with
 * the definite article while the person doesn't type it, so both are checked. YouTube is
 * credited on each suggestion that shows its content.
 */
export async function suggestContent(rawQuery: unknown): Promise<SearchSuggestion[]> {
  const parsed = z.string().trim().max(120).safeParse(rawQuery);
  if (!parsed.success) return [];
  const prefix = normalizeArabicForSearch(parsed.data);
  if (prefix.length < 2) return [];

  const titleStarts = { OR: [{ titleSearch: { startsWith: prefix } }, { titleSearch: { startsWith: `ال${prefix}` } }] };
  const common = { take: SUGGESTIONS_PER_TYPE, orderBy: { titleSearch: "asc" as const } };
  const c = strings.search.types;

  const [topics, articles, playlists, libraries, videos] = await Promise.all([
    prisma.topic.findMany({ ...common, where: { ...publicContentFilter, ...titleStarts }, select: { id: true, title: true, slug: true } }),
    prisma.article.findMany({ ...common, where: { ...publicContentFilter, ...titleStarts }, select: { id: true, title: true, slug: true } }),
    prisma.playlist.findMany({ ...common, where: { ...publicPlaylistFilter, ...titleStarts }, select: { id: true, title: true, slug: true, type: true, channelTitle: true } }),
    prisma.library.findMany({ ...common, where: { ...publicContentFilter, ...titleStarts }, select: { id: true, name: true, slug: true } }),
    prisma.video.findMany({ ...common, where: { ...publicVideoFilter, ...titleStarts }, select: { id: true, title: true, kind: true, channelTitle: true } }),
  ]);

  return [
    ...topics.map((row) => ({ id: row.id, label: row.title, hint: c.TOPIC, href: pathFor("topics", row.slug) })),
    ...articles.map((row) => ({ id: row.id, label: row.title, hint: c.ARTICLE, href: pathFor("articles", row.slug) })),
    ...videos.map((row) => ({ id: row.id, label: row.title, hint: videoPickerLabel(row), href: `/${row.kind === "SHORT" ? "shorts" : "videos"}/${row.id}` })),
    ...playlists.map((row) => ({
      id: row.id,
      label: row.title,
      hint: row.type === "YOUTUBE" ? [c.PLAYLIST, row.channelTitle, strings.feed.source].filter(Boolean).join(" · ") : c.PLAYLIST,
      href: pathFor("playlists", row.slug),
    })),
    ...libraries.map((row) => ({ id: row.id, label: row.name, hint: c.LIBRARY, href: pathFor("libraries", row.slug) })),
  ].slice(0, MAX_SUGGESTIONS);
}
