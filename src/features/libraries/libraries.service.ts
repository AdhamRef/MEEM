import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { strings } from "@/config/strings.ar";
import { recordAudit } from "@/features/admin/audit";
import { objectIdSchema } from "@/features/topics/schemas";
import { articleCardSelect, libraryCardSelect, resourceCardSelect, topicCardSelect } from "@/features/content/cards";
import {
  conflictOnDuplicate,
  cursorArgs,
  imageUrlSchema,
  optionalSlugSchema,
  optionalText,
  parseId,
  parseOptionalCursor,
  publicContentFilter,
  resolveSlug,
  toCursorPage,
} from "@/features/content/common";
import { pullFromVideoArray, purgeContentReferences } from "@/features/relationships/references";
import { publicVideoFilter, toVideoCards, videoCardSelect } from "@/features/shorts/video-cards";
import { AppError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { buildSearchText, normalizeArabicForSearch } from "@/lib/search/normalize";
import { decodeSlugParam } from "@/lib/slug";

const MAX_DEPTH = 32;
const PUBLIC_PAGE_SIZE = 24;
const SECTION_PAGE_SIZE = 12;
const ADMIN_PAGE_SIZE = 25;

export const libraryInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  slug: optionalSlugSchema,
  description: optionalText(1000),
  introduction: optionalText(5000),
  coverImage: imageUrlSchema.nullable().optional(),
  isFeatured: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(100_000).optional(),
  parentId: objectIdSchema.nullable().optional(),
});

function parseInput(rawInput: unknown) {
  const parsed = libraryInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  return parsed.data;
}

/** Walks up from the proposed parent. Finding the library itself means a cycle. */
async function assertValidParent(tx: Prisma.TransactionClient, parentId: string, libraryId?: string): Promise<void> {
  let currentId: string | null = parentId;
  for (let depth = 0; currentId; depth += 1) {
    if (currentId === libraryId || depth > MAX_DEPTH) throw new AppError("VALIDATION");
    const parent: { parentId: string | null } | null = await tx.library.findUnique({ where: { id: currentId }, select: { parentId: true } });
    if (!parent) throw new AppError("VALIDATION");
    currentId = parent.parentId;
  }
}

function searchFields(input: { name: string; description?: string | null; introduction?: string | null }) {
  return { titleSearch: normalizeArabicForSearch(input.name), searchText: buildSearchText([input.name, input.description, input.introduction]) };
}

export async function createLibrary(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "libraries.manage");
  const input = parseInput(rawInput);

  try {
    return await withTransaction(async (tx) => {
      if (input.parentId) await assertValidParent(tx, input.parentId);
      const slug = await resolveSlug(input.name, input.slug, async (candidate) => (await tx.library.count({ where: { slug: candidate } })) > 0);
      const library = await tx.library.create({ data: { ...input, slug, status: "DRAFT", ...searchFields(input) } });
      await recordAudit(tx, actor, { action: "library.create", entityType: "Library", entityId: library.id, metadata: { name: library.name, slug } });
      return library;
    });
  } catch (error) {
    throw conflictOnDuplicate(error);
  }
}

export async function updateLibrary(actor: Actor | null, rawId: unknown, rawInput: unknown) {
  assertPermission(actor, "libraries.manage");
  const id = parseId(rawId);
  const input = parseInput(rawInput);

  try {
    return await withTransaction(async (tx) => {
      const existing = await tx.library.findUnique({ where: { id }, select: { status: true, slug: true } });
      if (!existing) throw new AppError("NOT_FOUND");
      if (input.parentId) await assertValidParent(tx, input.parentId, id);
      const slug = input.slug ?? existing.slug;
      if (existing.status === "PUBLISHED" && slug !== existing.slug) throw new AppError("CONFLICT", strings.content.slugLocked);

      const library = await tx.library.update({ where: { id }, data: { ...input, slug, ...searchFields(input) } });
      await recordAudit(tx, actor, { action: "library.update", entityType: "Library", entityId: id, metadata: { name: library.name } });
      return library;
    });
  } catch (error) {
    throw conflictOnDuplicate(error);
  }
}

export async function setLibraryPublished(actor: Actor | null, rawId: unknown, isPublished: boolean) {
  assertPermission(actor, "content.publish");
  const id = parseId(rawId);

  return withTransaction(async (tx) => {
    const existing = await tx.library.findUnique({ where: { id }, select: { isArchived: true, publishedAt: true } });
    if (!existing) throw new AppError("NOT_FOUND");
    if (existing.isArchived && isPublished) throw new AppError("CONFLICT", strings.content.archivedCantPublish);

    const library = await tx.library.update({
      where: { id },
      data: { status: isPublished ? "PUBLISHED" : "DRAFT", publishedAt: isPublished ? (existing.publishedAt ?? new Date()) : existing.publishedAt },
    });
    await recordAudit(tx, actor, { action: isPublished ? "library.publish" : "library.unpublish", entityType: "Library", entityId: id });
    return library;
  });
}

export async function setLibraryArchived(actor: Actor | null, rawId: unknown, isArchived: boolean) {
  assertPermission(actor, "content.archive");
  const id = parseId(rawId);

  return withTransaction(async (tx) => {
    const existing = await tx.library.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError("NOT_FOUND");
    const library = await tx.library.update({ where: { id }, data: { isArchived, archivedAt: isArchived ? new Date() : null } });
    await recordAudit(tx, actor, { action: isArchived ? "library.archive" : "library.restore", entityType: "Library", entityId: id });
    return library;
  });
}

/** Sub-libraries survive and move up to the top level, rather than disappearing with their parent. */
export async function deleteLibrary(actor: Actor | null, rawId: unknown): Promise<void> {
  assertPermission(actor, "content.delete");
  const id = parseId(rawId);

  await withTransaction(async (tx) => {
    const existing = await tx.library.findUnique({ where: { id }, select: { name: true, slug: true } });
    if (!existing) throw new AppError("NOT_FOUND");

    await purgeContentReferences(tx, "LIBRARY", id);
    await pullFromVideoArray(tx, "libraryIds", id);
    await tx.library.updateMany({ where: { parentId: id }, data: { parentId: null } });
    await tx.libraryRelation.deleteMany({ where: { OR: [{ fromLibraryId: id }, { toLibraryId: id }] } });
    await tx.library.delete({ where: { id } });
    await recordAudit(tx, actor, { action: "library.delete", entityType: "Library", entityId: id, metadata: { name: existing.name, slug: existing.slug } });
  });
}

const adminListSchema = z.strictObject({ query: z.string().max(120).optional(), status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(), cursor: z.string().optional() });

export async function listLibrariesForAdmin(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "admin.access");
  const parsed = adminListSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { query, status, cursor } = parsed.data;
  const search = query ? normalizeArabicForSearch(query) : "";

  const rows = await prisma.library.findMany({
    where: { ...(search ? { titleSearch: { contains: search } } : {}), ...(status === "ARCHIVED" ? { isArchived: true } : { isArchived: false, ...(status ? { status } : {}) }) },
    orderBy: { id: "desc" },
    take: ADMIN_PAGE_SIZE + 1,
    ...cursorArgs(parseOptionalCursor(cursor)),
    select: { id: true, name: true, slug: true, status: true, isArchived: true, updatedAt: true, isFeatured: true },
  });
  return toCursorPage(rows, ADMIN_PAGE_SIZE);
}

export async function getLibraryForEditing(actor: Actor | null, rawId: unknown) {
  assertPermission(actor, "admin.access");
  const library = await prisma.library.findUnique({ where: { id: parseId(rawId) }, include: { parent: { select: { id: true, name: true } } } });
  if (!library) throw new AppError("NOT_FOUND");
  return library;
}

export async function listPublishedLibraries(options: { cursor?: unknown } = {}) {
  const rows = await prisma.library.findMany({
    // A document created without a parent has no such field, and Prisma treats that as different from null.
    where: { ...publicContentFilter, OR: [{ parentId: null }, { parentId: { isSet: false } }] },
    orderBy: [{ isFeatured: "desc" }, { displayOrder: "asc" }, { id: "desc" }],
    take: PUBLIC_PAGE_SIZE + 1,
    ...cursorArgs(parseOptionalCursor(options.cursor)),
    select: libraryCardSelect,
  });
  return toCursorPage(rows, PUBLIC_PAGE_SIZE);
}

export async function getPublishedLibraryBySlug(rawSlug: string) {
  const slug = decodeSlugParam(rawSlug);
  if (!slug) return null;
  return prisma.library.findFirst({ where: { slug, ...publicContentFilter } });
}

export interface LibrarySectionCursors {
  articles?: unknown;
  videos?: unknown;
}

/** Empty sections come back empty, and the page hides them. Featured items lead rather than repeat. */
export async function getLibrarySections(libraryId: string, cursors: LibrarySectionCursors = {}) {
  const [featuredArticleLinks, featuredVideoLinks, articleRows, videoRows, children, related, topicLinks, resourceLinks] = await Promise.all([
    prisma.articleLibrary.findMany({ where: { libraryId, isFeatured: true, article: publicContentFilter }, take: 6, select: { article: { select: articleCardSelect } } }),
    prisma.videoLibrary.findMany({ where: { libraryId, isFeatured: true, video: publicVideoFilter }, take: 6, select: { video: { select: videoCardSelect } } }),
    prisma.article.findMany({
      where: { ...publicContentFilter, libraries: { some: { libraryId, isFeatured: false } } },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: SECTION_PAGE_SIZE + 1,
      ...cursorArgs(parseOptionalCursor(cursors.articles)),
      select: articleCardSelect,
    }),
    prisma.video.findMany({
      where: { ...publicVideoFilter, libraries: { some: { libraryId, isFeatured: false } } },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: SECTION_PAGE_SIZE + 1,
      ...cursorArgs(parseOptionalCursor(cursors.videos)),
      select: videoCardSelect,
    }),
    prisma.library.findMany({ where: { parentId: libraryId, ...publicContentFilter }, orderBy: [{ displayOrder: "asc" }, { id: "asc" }], take: 24, select: libraryCardSelect }),
    prisma.libraryRelation.findMany({
      where: { OR: [{ fromLibraryId: libraryId, toLibrary: publicContentFilter }, { toLibraryId: libraryId, fromLibrary: publicContentFilter }] },
      take: 24,
      select: { fromLibraryId: true, fromLibrary: { select: libraryCardSelect }, toLibrary: { select: libraryCardSelect } },
    }),
    prisma.libraryTopic.findMany({ where: { libraryId, topic: publicContentFilter }, take: 24, select: { topic: { select: topicCardSelect } } }),
    prisma.resourceLibrary.findMany({ where: { libraryId, resource: publicContentFilter }, take: 24, select: { resource: { select: resourceCardSelect } } }),
  ]);

  const videos = toCursorPage(videoRows, SECTION_PAGE_SIZE);
  return {
    featuredArticles: featuredArticleLinks.map((link) => link.article),
    featuredVideos: await toVideoCards(featuredVideoLinks.map((link) => link.video)),
    articles: toCursorPage(articleRows, SECTION_PAGE_SIZE),
    videos: { items: await toVideoCards(videos.items), nextCursor: videos.nextCursor },
    children,
    related: related.map((row) => (row.fromLibraryId === libraryId ? row.toLibrary : row.fromLibrary)),
    topics: topicLinks.map((link) => link.topic),
    resources: resourceLinks.map((link) => link.resource),
  };
}

export async function getPublicLibraryParent(parentId: string | null) {
  if (!parentId) return null;
  return prisma.library.findFirst({ where: { id: parentId, ...publicContentFilter }, select: { name: true, slug: true } });
}
