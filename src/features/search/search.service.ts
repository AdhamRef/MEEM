import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { strings } from "@/config/strings.ar";
import { objectIdSchema } from "@/features/categories/schemas";
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

/** Types that have a category. The others have nothing a category filter could apply to. */
export const CATEGORIZED_TYPES: readonly SearchType[] = ["TOPIC", "SHORT", "LONG_VIDEO", "ARTICLE"];

const OVERVIEW_LIMIT = 6;
const PAGE_SIZE = 12;
/** A person who hasn't found it after this many results needs a better query, not more pages. */
const MAX_PAGES = 25;
const MAX_LINKED_RESULTS = 200;
const MAX_MATCHING_TOPICS = 30;
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
  categoryId: objectIdSchema.optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(MAX_PAGES).catch(1),
});

interface TypeSearchOptions {
  terms: SearchTerms;
  categoryId?: string;
  limit: number;
}

/**
 * Public filters as MongoDB receives them. $text needs a raw query, and these say the same as
 * publicVideoFilter and the others, with the same results checked again when items are loaded.
 */
const rawPublicFilter = { status: publicContentFilter.status, isArchived: publicContentFilter.isArchived };
const rawVideoFilter = { status: publicVideoFilter.status, isArchived: publicVideoFilter.isArchived, availability: publicVideoFilter.availability };

function rawFilterFor(type: SearchType, categoryId: string | undefined): Prisma.InputJsonObject {
  const category = categoryId ? { categoryId: { $oid: categoryId } } : {};
  switch (type) {
    case "SHORT":
      return { ...rawVideoFilter, kind: "SHORT", ...category };
    case "LONG_VIDEO":
      return { ...rawVideoFilter, kind: "LONG_FORM", ...category };
    case "PLAYLIST":
      return { ...rawPublicFilter, title: { $ne: "" } };
    case "TOPIC":
    case "ARTICLE":
      return { ...rawPublicFilter, ...category };
    default:
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
async function directMatches(type: SearchType, { terms, categoryId, limit }: TypeSearchOptions): Promise<string[]> {
  const rows = (await aggregate(type, [
    { $match: { $text: { $search: terms.textQuery }, ...rawFilterFor(type, categoryId) } },
    { $sort: { score: { $meta: "textScore" }, _id: 1 } },
    { $limit: limit },
    { $project: { _id: 1 } },
  ])) as unknown as { _id: { $oid: string } }[];
  return rows.map((row) => row._id.$oid);
}

interface MatchedTaxonomy {
  topicIds: string[];
  categoryIds: string[];
}

/** Topics and categories named by the query. Their content counts, even if it doesn't repeat the name. */
async function findMatchedTaxonomy(terms: SearchTerms): Promise<MatchedTaxonomy> {
  const [topics, categories] = await Promise.all([
    prisma.topic.aggregateRaw({
      pipeline: [
        { $match: { $text: { $search: terms.textQuery }, ...rawPublicFilter } },
        { $sort: { score: { $meta: "textScore" }, _id: 1 } },
        { $limit: MAX_MATCHING_TOPICS },
        { $project: { _id: 1, titleSearch: 1 } },
      ],
    }) as unknown as Promise<{ _id: { $oid: string }; titleSearch: string }[]>,
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, title: true } }),
  ]);

  return {
    topicIds: topics.filter((topic) => titleMatchesQuery(topic.titleSearch, terms.words)).map((topic) => topic._id.$oid),
    categoryIds: categories.filter((category) => titleMatchesQuery(normalizeArabicForSearch(category.title), terms.words)).map((category) => category.id),
  };
}

async function linkedMatches(type: SearchType, { topicIds, categoryIds }: MatchedTaxonomy, categoryId: string | undefined, limit: number): Promise<string[]> {
  const hasTopics = topicIds.length > 0;
  const hasCategories = categoryIds.length > 0;
  if (!hasTopics && !hasCategories) return [];

  const common = { orderBy: { id: "desc" as const }, take: limit, select: { id: true } };
  const filterCategory = categoryId ? { categoryId } : {};
  let rows: { id: string }[] = [];

  switch (type) {
    case "SHORT":
    case "LONG_VIDEO":
      rows = await prisma.video.findMany({
        ...common,
        where: {
          ...publicVideoFilter,
          ...filterCategory,
          kind: type === "SHORT" ? "SHORT" : "LONG_FORM",
          OR: [...(hasTopics ? [{ topicIds: { hasSome: topicIds } }] : []), ...(hasCategories ? [{ categoryId: { in: categoryIds } }] : [])],
        },
      });
      break;
    case "ARTICLE":
      rows = await prisma.article.findMany({
        ...common,
        where: {
          ...publicContentFilter,
          ...filterCategory,
          OR: [...(hasTopics ? [{ topics: { some: { topicId: { in: topicIds } } } }] : []), ...(hasCategories ? [{ categoryId: { in: categoryIds } }] : [])],
        },
      });
      break;
    case "TOPIC":
      if (hasCategories) rows = await prisma.topic.findMany({ ...common, where: { ...publicContentFilter, AND: [{ categoryId: { in: categoryIds } }, filterCategory] } });
      break;
    case "PLAYLIST":
      if (hasTopics) rows = await prisma.playlist.findMany({ ...common, where: { ...publicPlaylistFilter, topics: { some: { topicId: { in: topicIds } } } } });
      break;
    case "LIBRARY":
      if (hasTopics) rows = await prisma.library.findMany({ ...common, where: { ...publicContentFilter, topics: { some: { topicId: { in: topicIds } } } } });
      break;
    case "RESOURCE":
      if (hasTopics) rows = await prisma.externalResource.findMany({ ...common, where: { ...publicContentFilter, topics: { some: { topicId: { in: topicIds } } } } });
      break;
  }
  return rows.map((row) => row.id);
}

export interface SearchGroup {
  type: SearchType;
  items: ResolvedContent[];
  hasMore: boolean;
}

async function searchOneType(type: SearchType, terms: SearchTerms, taxonomy: MatchedTaxonomy, categoryId: string | undefined, offset: number, size: number): Promise<SearchGroup> {
  // One more than needed shows whether another page exists.
  const needed = offset + size + 1;
  const [direct, linked] = await Promise.all([directMatches(type, { terms, categoryId, limit: needed }), linkedMatches(type, taxonomy, categoryId, Math.min(needed, MAX_LINKED_RESULTS))]);
  const ranked = mergeRanked(direct, linked);
  const refs = ranked.slice(offset, offset + size).map((entityId) => ({ entityType: entityTypeOf[type], entityId }));
  return { type, items: await resolveInOrder(refs), hasMore: ranked.length > offset + size };
}

export type SearchResult =
  | { status: "EMPTY_QUERY"; query: string; type?: SearchType; categoryId?: string }
  | { status: "OVERVIEW"; query: string; categoryId?: string; groups: SearchGroup[] }
  | { status: "TYPE"; query: string; type: SearchType; categoryId?: string; page: number; group: SearchGroup };

/**
 * Searches stored data only. Titles, descriptions and tags are in the text index. Topic and
 * category names work through the content connected to them (§17). Queries aren't stored.
 */
export async function searchContent(rawInput: unknown): Promise<SearchResult> {
  const input = searchInputSchema.parse(rawInput);
  const { query, type, categoryId, page } = input;
  const terms = parseSearchTerms(query);
  if (!terms) return { status: "EMPTY_QUERY", query, type, categoryId };

  const taxonomy = await findMatchedTaxonomy(terms);

  if (type) {
    if (categoryId && !CATEGORIZED_TYPES.includes(type)) return { status: "TYPE", query, type, categoryId, page: 1, group: { type, items: [], hasMore: false } };
    const group = await searchOneType(type, terms, taxonomy, categoryId, (page - 1) * PAGE_SIZE, PAGE_SIZE);
    return { status: "TYPE", query, type, categoryId, page, group: { ...group, hasMore: group.hasMore && page < MAX_PAGES } };
  }

  const types = categoryId ? SEARCH_TYPES.filter((candidate) => CATEGORIZED_TYPES.includes(candidate)) : SEARCH_TYPES;
  const groups = await Promise.all(types.map((candidate) => searchOneType(candidate, terms, taxonomy, categoryId, 0, OVERVIEW_LIMIT)));
  return { status: "OVERVIEW", query, categoryId, groups: groups.filter((group) => group.items.length > 0) };
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
