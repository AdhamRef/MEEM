import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { strings } from "@/config/strings.ar";
import { recordAudit } from "@/features/admin/audit";
import { objectIdSchema, topicInputSchema, topicUpdateSchema } from "@/features/topics/schemas";
import { articleCardSelect, libraryCardSelect, resourceCardSelect, topicCardSelect } from "@/features/content/cards";
import { cursorArgs, parseOptionalCursor, publicContentFilter, resolveSlug, toCursorPage } from "@/features/content/common";
import { purgeContentReferences } from "@/features/relationships/references";
import { publicVideoFilter, toVideoCards, videoCardSelect } from "@/features/shorts/video-cards";
import { AppError, isUniqueConstraintError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { buildSearchText, normalizeArabicForSearch } from "@/lib/search/normalize";
import { decodeSlugParam } from "@/lib/slug";

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 60;
const MAX_TOPIC_DEPTH = 32;
const SECTION_PAGE_SIZE = 12;
const ADMIN_PAGE_SIZE = 25;
/** Well above any realistic topic. It only exists so a query is never unbounded. */
const MAX_TOPIC_CHANNELS = 200;

/** Every public query uses this, so draft or archived topics can never appear by accident. */
const publicTopicFilter = { status: "PUBLISHED", isArchived: false } satisfies Prisma.TopicWhereInput;

function parseId(rawId: unknown): string {
  const parsed = objectIdSchema.safeParse(rawId);
  if (!parsed.success) throw new AppError("VALIDATION");
  return parsed.data;
}

/** Walks up from the proposed parent. Finding the topic itself means a cycle. */
async function assertValidParent(tx: Prisma.TransactionClient, parentId: string, topicId?: string): Promise<void> {
  let currentId: string | null = parentId;
  for (let depth = 0; currentId; depth += 1) {
    if (currentId === topicId || depth > MAX_TOPIC_DEPTH) throw new AppError("VALIDATION");
    const parent: { parentId: string | null } | null = await tx.topic.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    if (!parent) throw new AppError("VALIDATION");
    currentId = parent.parentId;
  }
}

function conflictOnDuplicateSlug(error: unknown): unknown {
  return isUniqueConstraintError(error) ? new AppError("CONFLICT") : error;
}

export async function createTopic(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "topics.manage");
  const parsed = topicInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const input = parsed.data;

  try {
    return await withTransaction(async (tx) => {
      if (input.parentId) await assertValidParent(tx, input.parentId);
      const slug = await resolveSlug(input.title, input.slug, async (candidate) => (await tx.topic.count({ where: { slug: candidate } })) > 0);

      // Always starts as a draft. Publishing is a separate permission.
      const topic = await tx.topic.create({
        data: {
          ...input,
          slug,
          status: "DRAFT",
          titleSearch: normalizeArabicForSearch(input.title),
          searchText: buildSearchText([input.title, input.introduction, input.description]),
        },
      });
      await recordAudit(tx, actor, {
        action: "topic.create",
        entityType: "Topic",
        entityId: topic.id,
        metadata: { title: topic.title, slug },
      });
      return topic;
    });
  } catch (error) {
    throw conflictOnDuplicateSlug(error);
  }
}

export async function updateTopic(actor: Actor | null, rawId: unknown, rawInput: unknown) {
  assertPermission(actor, "topics.manage");
  const id = parseId(rawId);
  const parsed = topicUpdateSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const input = parsed.data;

  try {
    return await withTransaction(async (tx) => {
      const existing = await tx.topic.findUnique({
        where: { id },
        select: { title: true, introduction: true, description: true, status: true, slug: true },
      });
      if (!existing) throw new AppError("NOT_FOUND");
      // A published address may already be shared or linked from elsewhere.
      if (existing.status === "PUBLISHED" && input.slug && input.slug !== existing.slug) throw new AppError("CONFLICT", strings.content.slugLocked);
      if (input.parentId) await assertValidParent(tx, input.parentId, id);

      const merged = { ...existing, ...input };
      const topic = await tx.topic.update({
        where: { id },
        data: {
          ...input,
          titleSearch: normalizeArabicForSearch(merged.title),
          searchText: buildSearchText([merged.title, merged.introduction, merged.description]),
        },
      });
      await recordAudit(tx, actor, {
        action: "topic.update",
        entityType: "Topic",
        entityId: id,
        metadata: { changedFields: Object.keys(input) },
      });
      return topic;
    });
  } catch (error) {
    throw conflictOnDuplicateSlug(error);
  }
}

export async function setTopicPublished(actor: Actor | null, rawId: unknown, isPublished: boolean) {
  assertPermission(actor, "content.publish");
  const id = parseId(rawId);

  return withTransaction(async (tx) => {
    const existing = await tx.topic.findUnique({ where: { id }, select: { isArchived: true, publishedAt: true } });
    if (!existing) throw new AppError("NOT_FOUND");
    if (existing.isArchived && isPublished) throw new AppError("CONFLICT");

    const topic = await tx.topic.update({
      where: { id },
      data: {
        status: isPublished ? "PUBLISHED" : "DRAFT",
        // Keeps the original date when republishing.
        publishedAt: isPublished ? (existing.publishedAt ?? new Date()) : existing.publishedAt,
      },
    });
    await recordAudit(tx, actor, {
      action: isPublished ? "topic.publish" : "topic.unpublish",
      entityType: "Topic",
      entityId: id,
    });
    return topic;
  });
}

/** Archiving hides a topic and keeps everything that refers to it intact. */
export async function setTopicArchived(actor: Actor | null, rawId: unknown, isArchived: boolean) {
  assertPermission(actor, "content.archive");
  const id = parseId(rawId);

  return withTransaction(async (tx) => {
    const existing = await tx.topic.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError("NOT_FOUND");

    const topic = await tx.topic.update({
      where: { id },
      data: { isArchived, archivedAt: isArchived ? new Date() : null },
    });
    await recordAudit(tx, actor, {
      action: isArchived ? "topic.archive" : "topic.restore",
      entityType: "Topic",
      entityId: id,
    });
    return topic;
  });
}

export async function getPublishedTopicBySlug(rawSlug: string) {
  const slug = decodeSlugParam(rawSlug);
  if (!slug) return null;
  return prisma.topic.findFirst({ where: { slug, ...publicTopicFilter } });
}

export async function listPublishedTopics(options: { cursor?: string; limit?: number } = {}) {
  const limit = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const cursor = options.cursor === undefined ? undefined : parseId(options.cursor);

  const topics = await prisma.topic.findMany({
    where: publicTopicFilter,
    orderBy: { id: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, title: true, slug: true, introduction: true, coverImage: true, isFeatured: true },
  });

  const hasMore = topics.length > limit;
  const items = hasMore ? topics.slice(0, limit) : topics;
  return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
}

/** Child topics survive and move up to the top level, rather than disappearing with their parent. */
export async function deleteTopic(actor: Actor | null, rawId: unknown): Promise<void> {
  assertPermission(actor, "content.delete");
  const id = parseId(rawId);

  await withTransaction(async (tx) => {
    const existing = await tx.topic.findUnique({ where: { id }, select: { title: true, slug: true } });
    if (!existing) throw new AppError("NOT_FOUND");

    await purgeContentReferences(tx, "TOPIC", id);
    await tx.topic.updateMany({ where: { parentId: id }, data: { parentId: null } });
    await tx.topicRelation.deleteMany({ where: { OR: [{ fromTopicId: id }, { toTopicId: id }] } });
    await tx.topic.delete({ where: { id } });
    await recordAudit(tx, actor, { action: "topic.delete", entityType: "Topic", entityId: id, metadata: { title: existing.title, slug: existing.slug } });
  });
}

const adminListSchema = z.strictObject({ query: z.string().max(120).optional(), status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(), cursor: z.string().optional() });

export async function listTopicsForAdmin(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "admin.access");
  const parsed = adminListSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { query, status, cursor } = parsed.data;
  const search = query ? normalizeArabicForSearch(query) : "";

  const rows = await prisma.topic.findMany({
    where: { ...(search ? { titleSearch: { contains: search } } : {}), ...(status === "ARCHIVED" ? { isArchived: true } : { isArchived: false, ...(status ? { status } : {}) }) },
    orderBy: { id: "desc" },
    take: ADMIN_PAGE_SIZE + 1,
    ...cursorArgs(parseOptionalCursor(cursor)),
    select: { id: true, title: true, slug: true, status: true, isArchived: true, updatedAt: true, isFeatured: true },
  });
  return toCursorPage(rows, ADMIN_PAGE_SIZE);
}

export async function getTopicForEditing(actor: Actor | null, rawId: unknown) {
  assertPermission(actor, "admin.access");
  const topic = await prisma.topic.findUnique({ where: { id: parseId(rawId) }, include: { parent: { select: { id: true, title: true } } } });
  if (!topic) throw new AppError("NOT_FOUND");
  return topic;
}

export async function listFeaturedTopics(limit = 6) {
  return prisma.topic.findMany({ where: { ...publicContentFilter, isFeatured: true }, orderBy: [{ displayOrder: "asc" }, { id: "desc" }], take: limit, select: topicCardSelect });
}

export async function listPublicTopics(options: { cursor?: unknown } = {}) {
  const rows = await prisma.topic.findMany({
    where: publicContentFilter,
    orderBy: [{ displayOrder: "asc" }, { id: "desc" }],
    take: DEFAULT_PAGE_SIZE + 1,
    ...cursorArgs(parseOptionalCursor(options.cursor)),
    select: topicCardSelect,
  });
  return toCursorPage(rows, DEFAULT_PAGE_SIZE);
}

export interface TopicSectionCursors {
  shorts?: unknown;
  videos?: unknown;
  articles?: unknown;
  resources?: unknown;
}

/**
 * Empty sections come back empty, and the page hides them (§11.1). Only public items are read.
 * A topic's videos are all those of its channels, so nobody has to attach them one by one.
 */
export async function getTopicSections(topicId: string, parentId: string | null, cursors: TopicSectionCursors = {}) {
  const channelLinks = await prisma.channelTopic.findMany({
    where: { topicId, channel: { title: { not: "" } } },
    take: MAX_TOPIC_CHANNELS,
    orderBy: { id: "asc" },
    select: { channel: { select: { id: true, title: true, handle: true, thumbnailUrl: true } } },
  });
  const channels = channelLinks.map((link) => link.channel);
  const videoWhere = { ...publicVideoFilter, channelId: { in: channels.map((channel) => channel.id) } };
  const newestFirst = [{ publishedAt: "desc" as const }, { id: "desc" as const }];

  const [shortRows, videoRows, articleRows, resourceRows, children, relations, libraryLinks, parent] = await Promise.all([
    prisma.video.findMany({ where: { ...videoWhere, kind: "SHORT" }, orderBy: newestFirst, take: SECTION_PAGE_SIZE + 1, ...cursorArgs(parseOptionalCursor(cursors.shorts)), select: videoCardSelect }),
    prisma.video.findMany({ where: { ...videoWhere, kind: "LONG_FORM" }, orderBy: newestFirst, take: SECTION_PAGE_SIZE + 1, ...cursorArgs(parseOptionalCursor(cursors.videos)), select: videoCardSelect }),
    prisma.article.findMany({
      where: { ...publicContentFilter, topics: { some: { topicId } } },
      orderBy: newestFirst,
      take: SECTION_PAGE_SIZE + 1,
      ...cursorArgs(parseOptionalCursor(cursors.articles)),
      select: articleCardSelect,
    }),
    prisma.externalResource.findMany({
      where: { ...publicContentFilter, topics: { some: { topicId } } },
      orderBy: newestFirst,
      take: SECTION_PAGE_SIZE + 1,
      ...cursorArgs(parseOptionalCursor(cursors.resources)),
      select: resourceCardSelect,
    }),
    prisma.topic.findMany({ where: { ...publicContentFilter, parentId: topicId }, orderBy: [{ displayOrder: "asc" }, { id: "asc" }], take: 24, select: topicCardSelect }),
    prisma.topicRelation.findMany({
      where: { OR: [{ fromTopicId: topicId, toTopic: publicContentFilter }, { toTopicId: topicId, fromTopic: publicContentFilter }] },
      take: 48,
      select: { type: true, fromTopicId: true, fromTopic: { select: topicCardSelect }, toTopic: { select: topicCardSelect } },
    }),
    prisma.libraryTopic.findMany({ where: { topicId, library: publicContentFilter }, take: 24, select: { library: { select: libraryCardSelect } } }),
    parentId ? prisma.topic.findFirst({ where: { id: parentId, ...publicContentFilter }, select: { title: true, slug: true } }) : null,
  ]);

  const other = (row: (typeof relations)[number]) => (row.fromTopicId === topicId ? row.toTopic : row.fromTopic);
  const shorts = toCursorPage(shortRows, SECTION_PAGE_SIZE);
  const videos = toCursorPage(videoRows, SECTION_PAGE_SIZE);

  return {
    parent,
    channels,
    shorts: { items: await toVideoCards(shorts.items), nextCursor: shorts.nextCursor },
    videos: { items: await toVideoCards(videos.items), nextCursor: videos.nextCursor },
    articles: toCursorPage(articleRows, SECTION_PAGE_SIZE),
    resources: toCursorPage(resourceRows, SECTION_PAGE_SIZE),
    children,
    related: relations.filter((row) => row.type === "RELATED").map(other),
    complementary: relations.filter((row) => row.type === "COMPLEMENTARY").map(other),
    libraries: libraryLinks.map((link) => link.library),
  };
}
