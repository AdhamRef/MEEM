import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { recordAudit } from "@/features/admin/audit";
import { objectIdSchema } from "@/features/topics/schemas";
import { idListSchema, parseId, parseOptionalCursor, toCursorPage } from "@/features/content/common";
import { videoPickerLabel, type PickerItem } from "@/features/relationships/picker.service";
import { AppError } from "@/lib/errors";
import { assertPermission, hasPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { normalizeArabicForSearch } from "@/lib/search/normalize";
import { pickThumbnailUrl } from "@/lib/youtube/normalize";

const PAGE_SIZE = 50;
export const MAX_BULK_ITEMS = 100;
/** IDs at a time, when selecting everything a filter matches. They're small, and few requests are better. */
const MATCHING_IDS_PAGE_SIZE = 1000;

const listSchema = z.strictObject({
  query: z.string().max(120).optional(),
  kind: z.enum(["SHORT", "LONG_FORM"]).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  review: z.enum(["NEEDS_REVIEW", "REVIEWED"]).optional(),
  channelId: objectIdSchema.optional(),
  cursor: z.string().optional(),
});

/** One definition, so "everything this filter matches" can't differ from what the list shows. */
function videoFilterWhere({ query, kind, status, review, channelId }: z.infer<typeof listSchema>): Prisma.VideoWhereInput {
  const search = query ? normalizeArabicForSearch(query) : "";
  return {
    ...(channelId ? { channelId } : {}),
    ...(search ? { titleSearch: { contains: search } } : {}),
    ...(kind ? { kind } : {}),
    ...(status === "ARCHIVED" ? { isArchived: true } : { isArchived: false, ...(status ? { status } : {}) }),
    // A date that was never set can be null or missing, and those differ in filters.
    ...(review === "NEEDS_REVIEW" ? { OR: [{ reviewedAt: null }, { reviewedAt: { isSet: false } }] } : review === "REVIEWED" ? { reviewedAt: { not: null } } : {}),
  };
}

/** The IDs behind "select all", across every page of results. */
export async function listMatchingVideoIds(actor: Actor | null, rawFilter: unknown, rawCursor?: unknown): Promise<{ ids: string[]; nextCursor: string | null }> {
  assertPermission(actor, "content.viewAny");
  const parsed = listSchema.safeParse(rawFilter);
  if (!parsed.success) throw new AppError("VALIDATION");
  const validCursor = parseOptionalCursor(rawCursor);
  const rows = await prisma.video.findMany({
    where: videoFilterWhere(parsed.data),
    orderBy: { id: "desc" },
    take: MATCHING_IDS_PAGE_SIZE + 1,
    ...(validCursor ? { cursor: { id: validCursor }, skip: 1 } : {}),
    select: { id: true },
  });
  const page = toCursorPage(rows, MATCHING_IDS_PAGE_SIZE);
  return { ids: page.items.map((row) => row.id), nextCursor: page.nextCursor };
}

export async function listVideosForAdmin(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "content.viewAny");
  const parsed = listSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const validCursor = parseOptionalCursor(parsed.data.cursor);
  const where = videoFilterWhere(parsed.data);

  const [total, rows] = await Promise.all([prisma.video.count({ where }), prisma.video.findMany({
    where,
    orderBy: { id: "desc" },
    take: PAGE_SIZE + 1,
    ...(validCursor ? { cursor: { id: validCursor }, skip: 1 } : {}),
    select: { id: true, title: true, kind: true, classification: true, status: true, isArchived: true, availability: true, reviewedAt: true, channelTitle: true, thumbnails: true, durationSeconds: true, updatedAt: true },
  })]);
  const page = toCursorPage(rows, PAGE_SIZE);
  return { total, nextCursor: page.nextCursor, items: page.items.map(({ thumbnails, ...row }) => ({ ...row, thumbnailUrl: pickThumbnailUrl(thumbnails) })) };
}

export async function getVideoForEditing(actor: Actor | null, rawId: unknown) {
  assertPermission(actor, "content.viewAny");
  const video = await prisma.video.findUnique({ where: { id: parseId(rawId) } });
  if (!video) throw new AppError("NOT_FOUND");

  // A CTA's target is shown by name, so nobody has to recognise an ID.
  let ctaTarget: PickerItem | null = null;
  const targetId = video.cta?.targetId;
  if (targetId) {
    switch (video.cta?.type) {
      case "INTERNAL_ARTICLE": {
        const row = await prisma.article.findUnique({ where: { id: targetId }, select: { title: true } });
        if (row) ctaTarget = { id: targetId, type: "ARTICLE", label: row.title };
        break;
      }
      case "TOPIC": {
        const row = await prisma.topic.findUnique({ where: { id: targetId }, select: { title: true } });
        if (row) ctaTarget = { id: targetId, type: "TOPIC", label: row.title };
        break;
      }
      case "CURATED_PLAYLIST":
      case "YOUTUBE_PLAYLIST": {
        const row = await prisma.playlist.findUnique({ where: { id: targetId }, select: { title: true } });
        if (row) ctaTarget = { id: targetId, type: "PLAYLIST", label: row.title };
        break;
      }
      case "FULL_VIDEO": {
        const row = await prisma.video.findUnique({ where: { id: targetId }, select: { title: true, kind: true, channelTitle: true } });
        if (row) ctaTarget = { id: targetId, type: "VIDEO", label: row.title, hint: videoPickerLabel(row) };
        break;
      }
      case "EXTERNAL_RESOURCE": {
        const row = await prisma.externalResource.findUnique({ where: { id: targetId }, select: { title: true } });
        if (row) ctaTarget = { id: targetId, type: "RESOURCE", label: row.title };
        break;
      }
    }
  }
  // Read-only here: a video's topics come from its channel.
  const topicLinks = video.channelId ? await prisma.channelTopic.findMany({ where: { channelId: video.channelId }, select: { topic: { select: { title: true } } } }) : [];
  return { ...video, thumbnailUrl: pickThumbnailUrl(video.thumbnails), ctaTarget, topicTitles: topicLinks.map((link) => link.topic.title) };
}

export async function setVideoArchived(actor: Actor | null, rawId: unknown, isArchived: boolean) {
  assertPermission(actor, "content.archive");
  const id = parseId(rawId);
  return withTransaction(async (tx) => {
    const existing = await tx.video.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError("NOT_FOUND");
    const video = await tx.video.update({ where: { id }, data: { isArchived, archivedAt: isArchived ? new Date() : null } });
    await recordAudit(tx, actor, { action: isArchived ? "video.archive" : "video.restore", entityType: "Video", entityId: id });
    return video;
  });
}

const bulkIds = z.array(objectIdSchema).min(1).max(MAX_BULK_ITEMS);
const bulkAssignSchema = z.strictObject({ ids: bulkIds, kind: z.enum(["SHORT", "LONG_FORM"]) });

/** A video's topics come from its channel, so choosing a kind is all there is to assign in bulk. */
export async function bulkAssignVideos(actor: Actor | null, rawInput: unknown): Promise<{ changed: number }> {
  assertPermission(actor, "content.editAny");
  const parsed = bulkAssignSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { kind } = parsed.data;
  const ids = [...new Set(parsed.data.ids)];

  return withTransaction(async (tx) => {
    if ((await tx.video.count({ where: { id: { in: ids } } })) !== ids.length) throw new AppError("VALIDATION");

    // Assigning a kind is the human review that detection can't replace (§7.2).
    await tx.video.updateMany({ where: { id: { in: ids } }, data: { kind, reviewedAt: new Date() } });

    await recordAudit(tx, actor, { action: "video.bulk_assign", entityType: "Video", metadata: { ids, kind } });
    return { changed: ids.length };
  });
}

const bulkPublishSchema = z.strictObject({ ids: bulkIds, isPublished: z.boolean() });

/**
 * All in one go, rather than a transaction per video, which took several seconds each on a
 * remote database and could run out of time partway through. A whole batch succeeds or fails
 * together, so the count reported is always true. Only what can't play is skipped, and it's
 * reported. The rules match setVideoPublished. Publishing twice changes nothing.
 */
export async function bulkPublishVideos(actor: Actor | null, rawInput: unknown): Promise<{ changed: number; skipped: number }> {
  assertPermission(actor, "content.publish");
  const parsed = bulkPublishSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const ids = [...new Set(parsed.data.ids)];
  const { isPublished } = parsed.data;
  const now = new Date();

  return withTransaction(async (tx) => {
    let changed: number;
    if (isPublished) {
      const publishable = { id: { in: ids }, availability: "AVAILABLE", isArchived: false } satisfies Prisma.VideoWhereInput;
      // Earlier dates are kept. Not set can be null or missing, and those differ in filters.
      await tx.video.updateMany({ where: { ...publishable, OR: [{ reviewedAt: null }, { reviewedAt: { isSet: false } }] }, data: { reviewedAt: now } });
      await tx.video.updateMany({ where: { ...publishable, OR: [{ publishedAt: null }, { publishedAt: { isSet: false } }] }, data: { publishedAt: now } });
      changed = (await tx.video.updateMany({ where: publishable, data: { status: "PUBLISHED" } })).count;
    } else {
      changed = (await tx.video.updateMany({ where: { id: { in: ids } }, data: { status: "DRAFT" } })).count;
    }
    await recordAudit(tx, actor, { action: isPublished ? "video.bulk_publish" : "video.bulk_unpublish", entityType: "Video", metadata: { ids, changed } });
    return { changed, skipped: ids.length - changed };
  });
}

const bulkArticlesSchema = z.strictObject({ ids: bulkIds, addTopicIds: idListSchema });

/** The same bulk assignment for articles (§19.3). Needs permission to edit any of them. */
export async function bulkAssignArticles(actor: Actor | null, rawInput: unknown): Promise<{ changed: number }> {
  assertPermission(actor, "content.editAny");
  const parsed = bulkArticlesSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const ids = [...new Set(parsed.data.ids)];
  const topicIds = [...new Set(parsed.data.addTopicIds)];
  if (topicIds.length === 0) throw new AppError("VALIDATION");

  return withTransaction(async (tx) => {
    if ((await tx.topic.count({ where: { id: { in: topicIds } } })) !== topicIds.length) throw new AppError("VALIDATION");
    if ((await tx.article.count({ where: { id: { in: ids } } })) !== ids.length) throw new AppError("VALIDATION");

    if (topicIds.length) {
      const existing = await tx.articleTopic.findMany({ where: { articleId: { in: ids }, topicId: { in: topicIds } }, select: { articleId: true, topicId: true } });
      const seen = new Set(existing.map((row) => `${row.articleId}:${row.topicId}`));
      const data = ids.flatMap((articleId) => topicIds.filter((topicId) => !seen.has(`${articleId}:${topicId}`)).map((topicId) => ({ articleId, topicId })));
      if (data.length) await tx.articleTopic.createMany({ data });
    }
    await recordAudit(tx, actor, { action: "article.bulk_assign", entityType: "Article", metadata: { ids, addTopicIds: topicIds } });
    return { changed: ids.length };
  });
}

export function canBulkEdit(actor: Actor): boolean {
  return hasPermission(actor, "content.editAny");
}
