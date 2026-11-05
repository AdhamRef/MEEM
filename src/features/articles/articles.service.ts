import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { strings } from "@/config/strings.ar";
import { recordAudit } from "@/features/admin/audit";
import { objectIdSchema } from "@/features/categories/schemas";
import { articleCardSelect, resourceCardSelect, topicCardSelect, type ArticleCardData, type ResourceCardData, type TopicCardData } from "@/features/content/cards";
import {
  conflictOnDuplicate,
  cursorArgs,
  externalUrlSchema,
  idListSchema,
  imageUrlSchema,
  optionalSlugSchema,
  optionalText,
  parseId,
  parseOptionalCursor,
  publicContentFilter,
  resolveSlug,
  toCursorPage,
} from "@/features/content/common";
import { contentRelationInputSchema, normalizeRelations } from "@/features/relationships/content-relations";
import { videoPickerLabel, type PickerItem } from "@/features/relationships/picker.service";
import { purgeContentReferences } from "@/features/relationships/references";
import { publicVideoFilter, toVideoCards, videoCardSelect } from "@/features/shorts/video-cards";
import { computeReadingMinutes, extractHeadings, extractPlainText, isDocumentEmpty } from "@/lib/content/analysis";
import { sanitizeDocument } from "@/lib/content/document";
import { AppError } from "@/lib/errors";
import { assertPermission, hasPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { buildSearchText, normalizeArabicForSearch } from "@/lib/search/normalize";
import { decodeSlugParam } from "@/lib/slug";
import { canEditArticle, canViewArticle } from "./permissions";

const MAX_BODY_CHARACTERS = 2_500_000;
const ADMIN_PAGE_SIZE = 25;

const sourceSchema = z.strictObject({
  title: z.string().trim().min(1).max(300),
  author: optionalText(200),
  url: externalUrlSchema.nullable().optional(),
  note: optionalText(500),
});

export const articleInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  slug: optionalSlugSchema,
  excerpt: optionalText(500),
  coverImage: imageUrlSchema.nullable().optional(),
  coverCaption: optionalText(300),
  body: z.unknown(),
  bylineName: optionalText(120),
  categoryId: objectIdSchema.nullable().optional(),
  sources: z.array(sourceSchema).max(100).default([]),
  seoTitle: optionalText(120),
  seoDescription: optionalText(300),
  topicIds: idListSchema,
  libraryIds: idListSchema,
  videoIds: idListSchema,
  playlistIds: idListSchema,
  relations: z.array(contentRelationInputSchema).max(50).default([]),
  assigneeIds: z.array(objectIdSchema).max(20).optional(),
});

type ArticleInput = z.infer<typeof articleInputSchema>;

function parseArticleInput(rawInput: unknown): ArticleInput {
  const parsed = articleInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  return parsed.data;
}

async function assertAllExist(tx: Prisma.TransactionClient, input: ArticleInput): Promise<void> {
  const checks: [string[], (ids: string[]) => Promise<number>][] = [
    [input.topicIds, (ids) => tx.topic.count({ where: { id: { in: ids } } })],
    [input.libraryIds, (ids) => tx.library.count({ where: { id: { in: ids } } })],
    [input.videoIds, (ids) => tx.video.count({ where: { id: { in: ids } } })],
    [input.playlistIds, (ids) => tx.playlist.count({ where: { id: { in: ids } } })],
    [input.categoryId ? [input.categoryId] : [], (ids) => tx.category.count({ where: { id: { in: ids } } })],
    [input.relations.filter((r) => r.targetType === "ARTICLE").map((r) => r.targetId), (ids) => tx.article.count({ where: { id: { in: ids } } })],
    [input.relations.filter((r) => r.targetType === "TOPIC").map((r) => r.targetId), (ids) => tx.topic.count({ where: { id: { in: ids } } })],
    [input.relations.filter((r) => r.targetType === "RESOURCE").map((r) => r.targetId), (ids) => tx.externalResource.count({ where: { id: { in: ids } } })],
    [input.assigneeIds ?? [], (ids) => tx.user.count({ where: { id: { in: ids }, role: { not: "USER" }, isDeactivated: false } })],
  ];
  for (const [ids, count] of checks) {
    const unique = [...new Set(ids)];
    if (unique.length && (await count(unique)) !== unique.length) throw new AppError("VALIDATION");
  }
}

/** Everything derived from the body is recalculated here, so it can't drift from the text. */
function buildContentFields(input: ArticleInput) {
  if (JSON.stringify(input.body ?? null).length > MAX_BODY_CHARACTERS) throw new AppError("VALIDATION");
  const document = sanitizeDocument(input.body);
  const plainText = extractPlainText(document);
  return {
    title: input.title,
    excerpt: input.excerpt ?? null,
    coverImage: input.coverImage ?? null,
    coverCaption: input.coverCaption ?? null,
    body: document as unknown as Prisma.InputJsonValue,
    headings: extractHeadings(document),
    sources: input.sources.map((source) => ({ title: source.title, author: source.author ?? null, url: source.url ?? null, note: source.note ?? null })),
    seo: input.seoTitle || input.seoDescription ? { title: input.seoTitle ?? null, description: input.seoDescription ?? null, imageUrl: null } : null,
    bylineName: input.bylineName ?? null,
    categoryId: input.categoryId ?? null,
    readingMinutes: computeReadingMinutes(plainText),
    titleSearch: normalizeArabicForSearch(input.title),
    searchText: buildSearchText([input.title, input.excerpt, plainText]),
  };
}

async function syncArticleLinks(tx: Prisma.TransactionClient, articleId: string, input: ArticleInput, actorId: string): Promise<void> {
  const relations = normalizeRelations("ARTICLE", articleId, input.relations);
  if (!relations) throw new AppError("VALIDATION");

  const unique = (ids: string[]) => [...new Set(ids)];
  // These lists are small and capped, so replacing them is simpler and safe inside the transaction.
  await tx.articleTopic.deleteMany({ where: { articleId } });
  await tx.articleLibrary.deleteMany({ where: { articleId } });
  await tx.articleVideo.deleteMany({ where: { articleId } });
  await tx.articlePlaylist.deleteMany({ where: { articleId } });
  await tx.contentRelation.deleteMany({ where: { sourceType: "ARTICLE", sourceId: articleId } });

  const topicIds = unique(input.topicIds);
  const libraryIds = unique(input.libraryIds);
  const videoIds = unique(input.videoIds);
  const playlistIds = unique(input.playlistIds);
  if (topicIds.length) await tx.articleTopic.createMany({ data: topicIds.map((topicId) => ({ articleId, topicId })) });
  if (libraryIds.length) await tx.articleLibrary.createMany({ data: libraryIds.map((libraryId) => ({ articleId, libraryId })) });
  if (videoIds.length) await tx.articleVideo.createMany({ data: videoIds.map((videoId, position) => ({ articleId, videoId, position })) });
  if (playlistIds.length) await tx.articlePlaylist.createMany({ data: playlistIds.map((playlistId) => ({ articleId, playlistId })) });
  if (relations.length) {
    await tx.contentRelation.createMany({
      data: relations.map((relation) => ({
        sourceType: "ARTICLE",
        sourceId: articleId,
        targetType: relation.targetType,
        targetId: relation.targetId,
        relationType: relation.relationType,
        note: relation.note ?? null,
        createdById: actorId,
      })),
    });
  }
}

export async function createArticle(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "content.create");
  const input = parseArticleInput(rawInput);
  const fields = buildContentFields(input);
  // Only someone who can assign others may choose assignees.
  if (input.assigneeIds?.length && !hasPermission(actor, "content.editAny")) throw new AppError("FORBIDDEN");

  try {
    return await withTransaction(async (tx) => {
      await assertAllExist(tx, input);
      const slug = await resolveSlug(input.title, input.slug, async (candidate) => (await tx.article.count({ where: { slug: candidate } })) > 0);

      // Always starts as a draft. Publishing is a separate permission.
      const article = await tx.article.create({ data: { ...fields, slug, status: "DRAFT", authorId: actor.id, assigneeIds: input.assigneeIds ?? [] } });
      await syncArticleLinks(tx, article.id, input, actor.id);
      await recordAudit(tx, actor, { action: "article.create", entityType: "Article", entityId: article.id, metadata: { title: article.title, slug } });
      return article;
    });
  } catch (error) {
    throw conflictOnDuplicate(error);
  }
}

export async function updateArticle(actor: Actor | null, rawId: unknown, rawInput: unknown) {
  assertPermission(actor, "admin.access");
  const id = parseId(rawId);
  const input = parseArticleInput(rawInput);
  const fields = buildContentFields(input);

  try {
    return await withTransaction(async (tx) => {
      const existing = await tx.article.findUnique({ where: { id }, select: { status: true, authorId: true, assigneeIds: true, slug: true } });
      if (!existing) throw new AppError("NOT_FOUND");
      if (!canEditArticle(actor, existing)) throw new AppError("FORBIDDEN");

      const isChangingAssignees = input.assigneeIds !== undefined && [...input.assigneeIds].sort().join() !== [...existing.assigneeIds].sort().join();
      if (isChangingAssignees && !hasPermission(actor, "content.editAny")) throw new AppError("FORBIDDEN");

      // A published address may already be shared or linked from other articles.
      const slug = input.slug ?? existing.slug;
      if (existing.status === "PUBLISHED" && slug !== existing.slug) throw new AppError("CONFLICT", strings.content.slugLocked);

      await assertAllExist(tx, input);
      const article = await tx.article.update({ where: { id }, data: { ...fields, slug, ...(input.assigneeIds ? { assigneeIds: input.assigneeIds } : {}) } });
      await syncArticleLinks(tx, id, input, actor.id);
      await recordAudit(tx, actor, { action: "article.update", entityType: "Article", entityId: id, metadata: { title: article.title } });
      return article;
    });
  } catch (error) {
    throw conflictOnDuplicate(error);
  }
}

export async function setArticlePublished(actor: Actor | null, rawId: unknown, isPublished: boolean) {
  assertPermission(actor, "content.publish");
  const id = parseId(rawId);

  return withTransaction(async (tx) => {
    const existing = await tx.article.findUnique({ where: { id }, select: { body: true, isArchived: true, publishedAt: true } });
    if (!existing) throw new AppError("NOT_FOUND");
    if (isPublished && existing.isArchived) throw new AppError("CONFLICT", strings.content.archivedCantPublish);
    if (isPublished && isDocumentEmpty(sanitizeDocument(existing.body))) throw new AppError("CONFLICT", strings.articles.emptyCantPublish);

    const article = await tx.article.update({
      where: { id },
      data: { status: isPublished ? "PUBLISHED" : "DRAFT", publishedAt: isPublished ? (existing.publishedAt ?? new Date()) : existing.publishedAt },
    });
    await recordAudit(tx, actor, { action: isPublished ? "article.publish" : "article.unpublish", entityType: "Article", entityId: id });
    return article;
  });
}

/** Archiving hides an article and keeps everything that refers to it intact. */
export async function setArticleArchived(actor: Actor | null, rawId: unknown, isArchived: boolean) {
  assertPermission(actor, "content.archive");
  const id = parseId(rawId);

  return withTransaction(async (tx) => {
    const existing = await tx.article.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError("NOT_FOUND");
    const article = await tx.article.update({ where: { id }, data: { isArchived, archivedAt: isArchived ? new Date() : null } });
    await recordAudit(tx, actor, { action: isArchived ? "article.archive" : "article.restore", entityType: "Article", entityId: id });
    return article;
  });
}

export async function deleteArticle(actor: Actor | null, rawId: unknown): Promise<void> {
  assertPermission(actor, "content.delete");
  const id = parseId(rawId);

  await withTransaction(async (tx) => {
    const existing = await tx.article.findUnique({ where: { id }, select: { title: true, slug: true } });
    if (!existing) throw new AppError("NOT_FOUND");
    await purgeContentReferences(tx, "ARTICLE", id);
    await tx.article.delete({ where: { id } });
    await recordAudit(tx, actor, { action: "article.delete", entityType: "Article", entityId: id, metadata: { title: existing.title, slug: existing.slug } });
  });
}

const adminListSchema = z.strictObject({
  query: z.string().max(120).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  cursor: z.string().optional(),
});

export async function listArticlesForAdmin(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "admin.access");
  const parsed = adminListSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const where = articleFilterWhere(actor, parsed.data);

  const [total, rows] = await Promise.all([
    prisma.article.count({ where }),
    prisma.article.findMany({
      where,
      orderBy: { id: "desc" },
      take: ADMIN_PAGE_SIZE + 1,
      ...cursorArgs(parseOptionalCursor(parsed.data.cursor)),
      select: { id: true, title: true, slug: true, status: true, isArchived: true, updatedAt: true, publishedAt: true, authorId: true, assigneeIds: true },
    }),
  ]);
  return { ...toCursorPage(rows, ADMIN_PAGE_SIZE), total };
}

/** One definition, so "everything this filter matches" can't differ from what the list shows. */
function articleFilterWhere(actor: Actor, { query, status }: { query?: string; status?: "DRAFT" | "PUBLISHED" | "ARCHIVED" }): Prisma.ArticleWhereInput {
  const search = query ? normalizeArabicForSearch(query) : "";
  // Someone who can't see everything sees only what they wrote or were assigned.
  const scope: Prisma.ArticleWhereInput = hasPermission(actor, "content.viewAny") ? {} : { OR: [{ authorId: actor.id }, { assigneeIds: { has: actor.id } }] };
  return {
    ...scope,
    ...(search ? { titleSearch: { contains: search } } : {}),
    ...(status === "ARCHIVED" ? { isArchived: true } : { isArchived: false, ...(status ? { status } : {}) }),
  };
}

const MATCHING_IDS_PAGE_SIZE = 1000;

/** The IDs behind "select all", across every page of results, limited to what this person can see. */
export async function listMatchingArticleIds(actor: Actor | null, rawFilter: unknown, rawCursor?: unknown): Promise<{ ids: string[]; nextCursor: string | null }> {
  assertPermission(actor, "admin.access");
  const parsed = adminListSchema.safeParse(rawFilter);
  if (!parsed.success) throw new AppError("VALIDATION");
  const rows = await prisma.article.findMany({
    where: articleFilterWhere(actor, parsed.data),
    orderBy: { id: "desc" },
    take: MATCHING_IDS_PAGE_SIZE + 1,
    ...cursorArgs(parseOptionalCursor(rawCursor)),
    select: { id: true },
  });
  const page = toCursorPage(rows, MATCHING_IDS_PAGE_SIZE);
  return { ids: page.items.map((row) => row.id), nextCursor: page.nextCursor };
}

/** Everything the editing page needs, with the attached items' names resolved for the pickers. */
export async function getArticleForEditing(actor: Actor | null, rawId: unknown) {
  assertPermission(actor, "admin.access");
  const id = parseId(rawId);

  const article = await prisma.article.findUnique({
    where: { id },
    include: {
      topics: { include: { topic: { select: { id: true, title: true } } } },
      libraries: { include: { library: { select: { id: true, name: true } } } },
      videos: { orderBy: { position: "asc" }, include: { video: { select: { id: true, title: true, kind: true, channelTitle: true } } } },
      playlists: { include: { playlist: { select: { id: true, title: true } } } },
    },
  });
  if (!article) throw new AppError("NOT_FOUND");
  if (!canViewArticle(actor, article)) throw new AppError("FORBIDDEN");

  const relationRows = await prisma.contentRelation.findMany({ where: { sourceType: "ARTICLE", sourceId: id }, orderBy: { createdAt: "asc" } });
  const idsOf = (type: string) => relationRows.filter((row) => row.targetType === type).map((row) => row.targetId);
  const [relatedArticles, relatedTopics, relatedResources, assignees] = await Promise.all([
    prisma.article.findMany({ where: { id: { in: idsOf("ARTICLE") } }, select: { id: true, title: true } }),
    prisma.topic.findMany({ where: { id: { in: idsOf("TOPIC") } }, select: { id: true, title: true } }),
    prisma.externalResource.findMany({ where: { id: { in: idsOf("RESOURCE") } }, select: { id: true, title: true } }),
    hasPermission(actor, "content.editAny") ? prisma.user.findMany({ where: { id: { in: article.assigneeIds } }, select: { id: true, name: true, email: true } }) : [],
  ]);
  const relationTitles = new Map([...relatedArticles, ...relatedTopics, ...relatedResources].map((row) => [row.id, row.title]));

  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    excerpt: article.excerpt,
    coverImage: article.coverImage,
    coverCaption: article.coverCaption,
    body: article.body,
    bylineName: article.bylineName,
    categoryId: article.categoryId,
    sources: article.sources,
    seoTitle: article.seo?.title ?? null,
    seoDescription: article.seo?.description ?? null,
    status: article.status,
    isArchived: article.isArchived,
    isFeatured: article.isFeatured,
    updatedAt: article.updatedAt,
    canEdit: canEditArticle(actor, article),
    topics: article.topics.map(({ topic }): PickerItem => ({ id: topic.id, type: "TOPIC", label: topic.title })),
    libraries: article.libraries.map(({ library }): PickerItem => ({ id: library.id, type: "LIBRARY", label: library.name })),
    videos: article.videos.map(({ video }): PickerItem => ({ id: video.id, type: "VIDEO", label: video.title, hint: videoPickerLabel(video) })),
    playlists: article.playlists.map(({ playlist }): PickerItem => ({ id: playlist.id, type: "PLAYLIST", label: playlist.title })),
    relations: relationRows.map((row) => ({
      relationType: row.relationType,
      targetType: row.targetType as "ARTICLE" | "TOPIC" | "RESOURCE",
      targetId: row.targetId,
      note: row.note,
      label: relationTitles.get(row.targetId) ?? "",
    })),
    assignees: assignees.map((user): PickerItem => ({ id: user.id, type: "STAFF", label: user.name ?? user.email, hint: user.email })),
  };
}

export type ArticleForEditing = Awaited<ReturnType<typeof getArticleForEditing>>;

export async function getPublishedArticleBySlug(rawSlug: string) {
  const slug = decodeSlugParam(rawSlug);
  if (!slug) return null;
  return prisma.article.findFirst({
    where: { slug, ...publicContentFilter },
    select: {
      id: true,
      title: true,
      slug: true,
      excerpt: true,
      coverImage: true,
      coverCaption: true,
      body: true,
      headings: true,
      sources: true,
      seo: true,
      bylineName: true,
      readingMinutes: true,
      publishedAt: true,
      updatedAt: true,
      category: { select: { title: true } },
    },
  });
}

export interface ArticleRelationGroup {
  relationType: "RELATED_ARTICLE" | "COMPLEMENTARY_TOPIC" | "FURTHER_READING" | "RESPONSE_TO_OBJECTION" | "PREREQUISITE" | "RELATED_RESOURCE";
  articles: ArticleCardData[];
  topics: TopicCardData[];
  resources: ResourceCardData[];
}

const CONNECTION_LIMIT = 24;

/** Only public targets are returned, so a link to hidden content simply doesn't render. */
export async function getArticleConnections(articleId: string) {
  const [topicLinks, videoLinks, outgoing, incomingRelated] = await Promise.all([
    prisma.articleTopic.findMany({ where: { articleId }, take: CONNECTION_LIMIT, select: { topicId: true } }),
    prisma.articleVideo.findMany({ where: { articleId }, orderBy: { position: "asc" }, take: CONNECTION_LIMIT, select: { videoId: true } }),
    prisma.contentRelation.findMany({ where: { sourceType: "ARTICLE", sourceId: articleId }, orderBy: { createdAt: "asc" }, take: CONNECTION_LIMIT * 2 }),
    // "Related" reads both ways. The other relationships have a direction.
    prisma.contentRelation.findMany({ where: { targetType: "ARTICLE", targetId: articleId, relationType: "RELATED_ARTICLE", sourceType: "ARTICLE" }, take: CONNECTION_LIMIT, select: { sourceId: true } }),
  ]);

  const articleIds = [...new Set([...outgoing.filter((row) => row.targetType === "ARTICLE").map((row) => row.targetId), ...incomingRelated.map((row) => row.sourceId)])];
  const relationTopicIds = outgoing.filter((row) => row.targetType === "TOPIC").map((row) => row.targetId);
  const resourceIds = outgoing.filter((row) => row.targetType === "RESOURCE").map((row) => row.targetId);

  const [topics, videoRows, articles, relationTopics, resources, libraryLinks] = await Promise.all([
    prisma.topic.findMany({ where: { id: { in: topicLinks.map((link) => link.topicId) }, ...publicContentFilter }, select: topicCardSelect }),
    prisma.video.findMany({ where: { id: { in: videoLinks.map((link) => link.videoId) }, ...publicVideoFilter }, select: videoCardSelect }),
    prisma.article.findMany({ where: { id: { in: articleIds }, ...publicContentFilter }, select: articleCardSelect }),
    prisma.topic.findMany({ where: { id: { in: relationTopicIds }, ...publicContentFilter }, select: topicCardSelect }),
    prisma.externalResource.findMany({ where: { id: { in: resourceIds }, ...publicContentFilter }, select: resourceCardSelect }),
    prisma.articleLibrary.findMany({ where: { articleId, library: publicContentFilter }, take: CONNECTION_LIMIT, select: { library: { select: { id: true, name: true, slug: true } } } }),
  ]);

  const positionByVideo = new Map(videoLinks.map((link, index) => [link.videoId, index]));
  const videos = await toVideoCards([...videoRows].sort((a, b) => positionByVideo.get(a.id)! - positionByVideo.get(b.id)!));

  const articleById = new Map(articles.map((row) => [row.id, row]));
  const topicById = new Map(relationTopics.map((row) => [row.id, row]));
  const resourceById = new Map(resources.map((row) => [row.id, row]));

  const groups = new Map<ArticleRelationGroup["relationType"], ArticleRelationGroup>();
  const groupOf = (relationType: ArticleRelationGroup["relationType"]) => {
    let group = groups.get(relationType);
    if (!group) {
      group = { relationType, articles: [], topics: [], resources: [] };
      groups.set(relationType, group);
    }
    return group;
  };
  const seenRelated = new Set<string>();
  for (const row of outgoing) {
    const group = groupOf(row.relationType);
    if (row.targetType === "ARTICLE" && articleById.has(row.targetId)) {
      if (row.relationType === "RELATED_ARTICLE") seenRelated.add(row.targetId);
      group.articles.push(articleById.get(row.targetId)!);
    } else if (row.targetType === "TOPIC" && topicById.has(row.targetId)) {
      group.topics.push(topicById.get(row.targetId)!);
    } else if (row.targetType === "RESOURCE" && resourceById.has(row.targetId)) {
      group.resources.push(resourceById.get(row.targetId)!);
    }
  }
  for (const { sourceId } of incomingRelated) {
    const article = articleById.get(sourceId);
    if (article && !seenRelated.has(sourceId)) groupOf("RELATED_ARTICLE").articles.push(article);
  }

  return {
    topics,
    libraries: libraryLinks.map((link) => link.library),
    shorts: videos.filter((video) => video.kind === "SHORT"),
    longVideos: videos.filter((video) => video.kind === "LONG_FORM"),
    relationGroups: [...groups.values()].filter((group) => group.articles.length + group.topics.length + group.resources.length > 0),
  };
}

/** For a video's page: "A Short can link to multiple articles" (§12.6). */
/** A separate action, because choosing what Explore highlights is an editor's decision, not an author's. */
export async function setArticleFeatured(actor: Actor | null, rawId: unknown, isFeatured: boolean): Promise<void> {
  assertPermission(actor, "content.editAny");
  const id = parseId(rawId);
  await withTransaction(async (tx) => {
    const { count } = await tx.article.updateMany({ where: { id }, data: { isFeatured } });
    if (count === 0) throw new AppError("NOT_FOUND");
    await recordAudit(tx, actor, { action: isFeatured ? "article.feature" : "article.unfeature", entityType: "Article", entityId: id });
  });
}

export async function listPublishedArticlesForVideo(rawVideoId: unknown): Promise<ArticleCardData[]> {
  const videoId = parseId(rawVideoId);
  const links = await prisma.articleVideo.findMany({
    where: { videoId, article: publicContentFilter },
    take: 12,
    select: { article: { select: articleCardSelect } },
  });
  return links.map((link) => link.article);
}
