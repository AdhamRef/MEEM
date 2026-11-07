import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { strings } from "@/config/strings.ar";
import { recordAudit } from "@/features/admin/audit";
import { objectIdSchema } from "@/features/topics/schemas";
import { articleCardSelect, libraryCardSelect, topicCardSelect } from "@/features/content/cards";
import { conflictOnDuplicate, cursorArgs, imageUrlSchema, optionalSlugSchema, optionalText, parseId, parseOptionalCursor, resolveSlug, toCursorPage } from "@/features/content/common";
import { videoPickerLabel } from "@/features/relationships/picker.service";
import { purgeContentReferences } from "@/features/relationships/references";
import { publicVideoFilter } from "@/features/shorts/video-cards";
import { MAX_YOUTUBE_PLAYLIST_ITEMS, playlistYouTubeFields, syncYouTubePlaylist } from "@/features/youtube/playlist-sync.service";
import { AppError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { buildSearchText, normalizeArabicForSearch } from "@/lib/search/normalize";
import { decodeSlugParam, slugify } from "@/lib/slug";
import { YouTubeApiError } from "@/lib/youtube/client";
import { parseYouTubePlaylistId } from "@/lib/youtube/ids";
import { pickThumbnailUrl } from "@/lib/youtube/normalize";
import { fetchPlaylistMetadata } from "@/lib/youtube/playlists";
import { playlistCardSelect, publicPlaylistFilter, type PlaylistCardData } from "./playlist-filters";
import { validateReorder } from "./rules";

/** Keeps a page's item list within a known size. */
export const MAX_CURATED_PLAYLIST_ITEMS = MAX_YOUTUBE_PLAYLIST_ITEMS;

const PUBLIC_PAGE_SIZE = 24;
const ADMIN_PAGE_SIZE = 25;
const RELATED_LIMIT = 12;

const curatedInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  slug: optionalSlugSchema,
  description: optionalText(2000),
  introduction: optionalText(5000),
  coverImage: imageUrlSchema.nullable().optional(),
  isFeatured: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(100_000).optional(),
});

/** A YouTube playlist's title and description aren't ours to change, so they aren't accepted. */
const youtubeUpdateSchema = z.strictObject({
  slug: optionalSlugSchema,
  introduction: optionalText(5000),
  isFeatured: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(100_000).optional(),
});

function curatedSearchFields(input: { title: string; description?: string | null; introduction?: string | null }) {
  return { titleSearch: normalizeArabicForSearch(input.title), searchText: buildSearchText([input.title, input.description, input.introduction]) };
}

const slugIsTaken = (tx: Prisma.TransactionClient) => async (candidate: string) => (await tx.playlist.count({ where: { slug: candidate } })) > 0;

export async function createCuratedPlaylist(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "playlists.manage");
  const parsed = curatedInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const input = parsed.data;

  try {
    return await withTransaction(async (tx) => {
      const slug = await resolveSlug(input.title, input.slug, slugIsTaken(tx));
      const playlist = await tx.playlist.create({
        data: { ...input, slug, type: "CURATED", sourceKey: `cur:${randomUUID()}`, status: "DRAFT", syncStatus: "NOT_APPLICABLE", ...curatedSearchFields(input) },
      });
      await recordAudit(tx, actor, { action: "playlist.create", entityType: "Playlist", entityId: playlist.id, metadata: { title: playlist.title, slug } });
      return playlist;
    });
  } catch (error) {
    throw conflictOnDuplicate(error);
  }
}

/** Failures people can act on get their own message. Anything else stays generic. */
function toSyncError(error: unknown): unknown {
  if (!(error instanceof YouTubeApiError)) return error;
  if (error.reason === "NOT_CONFIGURED") return new AppError("EXTERNAL_UNAVAILABLE", strings.playlists.apiNotConfigured);
  if (error.reason === "QUOTA_EXCEEDED") return new AppError("EXTERNAL_UNAVAILABLE", strings.playlists.quotaExhausted);
  return new AppError("EXTERNAL_UNAVAILABLE", strings.playlists.syncFailed);
}

const importInputSchema = z.strictObject({ url: z.string().trim().min(1).max(500) });

/** Only a validated ID ever reaches YouTube, never the text that was pasted (§21). */
export async function importYouTubePlaylist(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "youtube.import");
  const parsed = importInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");

  const youtubePlaylistId = parseYouTubePlaylistId(parsed.data.url);
  if (!youtubePlaylistId) throw new AppError("VALIDATION", strings.playlists.invalidUrl);

  const sourceKey = `yt:${youtubePlaylistId}`;
  if (await prisma.playlist.count({ where: { sourceKey } })) throw new AppError("CONFLICT", strings.playlists.alreadyImported);

  try {
    const metadata = await fetchPlaylistMetadata(youtubePlaylistId);
    if (!metadata) throw new AppError("NOT_FOUND", strings.playlists.notFoundOnYouTube);

    const now = new Date();
    const playlist = await withTransaction(async (tx) => {
      const slug = await resolveSlug(slugify(metadata.title) ? metadata.title : youtubePlaylistId.toLowerCase(), null, slugIsTaken(tx));
      const created = await tx.playlist.create({
        data: { ...playlistYouTubeFields(metadata, now), type: "YOUTUBE", youtubePlaylistId, sourceKey, slug, status: "DRAFT", syncStatus: "PENDING" },
      });
      await recordAudit(tx, actor, { action: "playlist.import", entityType: "Playlist", entityId: created.id, metadata: { youtubePlaylistId } });
      return created;
    });

    const report = await syncYouTubePlaylist(playlist.id, actor.id, now);
    return { id: playlist.id, report };
  } catch (error) {
    throw conflictOnDuplicate(toSyncError(error));
  }
}

export async function syncPlaylistNow(actor: Actor | null, rawId: unknown) {
  assertPermission(actor, "youtube.import");
  const id = parseId(rawId);
  const existing = await prisma.playlist.findUnique({ where: { id }, select: { type: true } });
  if (!existing) throw new AppError("NOT_FOUND");
  if (existing.type !== "YOUTUBE") throw new AppError("CONFLICT");

  try {
    const report = await syncYouTubePlaylist(id, actor.id);
    await recordAudit(prisma, actor, { action: "playlist.sync", entityType: "Playlist", entityId: id, metadata: { ...report } });
    return report;
  } catch (error) {
    throw toSyncError(error);
  }
}

export async function updatePlaylist(actor: Actor | null, rawId: unknown, rawInput: unknown) {
  assertPermission(actor, "playlists.manage");
  const id = parseId(rawId);

  try {
    return await withTransaction(async (tx) => {
      const existing = await tx.playlist.findUnique({ where: { id }, select: { type: true, status: true, slug: true } });
      if (!existing) throw new AppError("NOT_FOUND");

      const assertSlugAllowed = (slug: string) => {
        if (existing.status === "PUBLISHED" && slug !== existing.slug) throw new AppError("CONFLICT", strings.content.slugLocked);
      };

      let data: Prisma.PlaylistUncheckedUpdateInput;
      if (existing.type === "CURATED") {
        const parsed = curatedInputSchema.safeParse(rawInput);
        if (!parsed.success) throw new AppError("VALIDATION");
        const slug = parsed.data.slug ?? existing.slug;
        assertSlugAllowed(slug);
        data = { ...parsed.data, slug, ...curatedSearchFields(parsed.data) };
      } else {
        const parsed = youtubeUpdateSchema.safeParse(rawInput);
        if (!parsed.success) throw new AppError("VALIDATION");
        const slug = parsed.data.slug ?? existing.slug;
        assertSlugAllowed(slug);
        data = { ...parsed.data, slug };
      }

      const playlist = await tx.playlist.update({ where: { id }, data });
      await recordAudit(tx, actor, { action: "playlist.update", entityType: "Playlist", entityId: id, metadata: { title: playlist.title } });
      return playlist;
    });
  } catch (error) {
    throw conflictOnDuplicate(error);
  }
}

export async function setPlaylistPublished(actor: Actor | null, rawId: unknown, isPublished: boolean) {
  assertPermission(actor, "content.publish");
  const id = parseId(rawId);

  return withTransaction(async (tx) => {
    const existing = await tx.playlist.findUnique({ where: { id }, select: { isArchived: true, publishedAt: true, title: true, type: true } });
    if (!existing) throw new AppError("NOT_FOUND");

    if (isPublished) {
      if (existing.isArchived) throw new AppError("CONFLICT", strings.content.archivedCantPublish);
      if (!existing.title) throw new AppError("CONFLICT", strings.playlists.dataWithdrawn);
      const items = await tx.playlistItem.count({ where: { playlistId: id } });
      if (items === 0) throw new AppError("CONFLICT", strings.playlists.emptyCantPublish);
    }

    const playlist = await tx.playlist.update({
      where: { id },
      data: { status: isPublished ? "PUBLISHED" : "DRAFT", publishedAt: isPublished ? (existing.publishedAt ?? new Date()) : existing.publishedAt },
    });
    await recordAudit(tx, actor, { action: isPublished ? "playlist.publish" : "playlist.unpublish", entityType: "Playlist", entityId: id });
    return playlist;
  });
}

export async function setPlaylistArchived(actor: Actor | null, rawId: unknown, isArchived: boolean) {
  assertPermission(actor, "content.archive");
  const id = parseId(rawId);

  return withTransaction(async (tx) => {
    const existing = await tx.playlist.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError("NOT_FOUND");
    const playlist = await tx.playlist.update({ where: { id }, data: { isArchived, archivedAt: isArchived ? new Date() : null } });
    await recordAudit(tx, actor, { action: isArchived ? "playlist.archive" : "playlist.restore", entityType: "Playlist", entityId: id });
    return playlist;
  });
}

/** The videos themselves stay, since they may belong to other playlists and pages. */
export async function deletePlaylist(actor: Actor | null, rawId: unknown): Promise<void> {
  assertPermission(actor, "content.delete");
  const id = parseId(rawId);

  await withTransaction(async (tx) => {
    const existing = await tx.playlist.findUnique({ where: { id }, select: { title: true, slug: true, sourceKey: true } });
    if (!existing) throw new AppError("NOT_FOUND");

    await purgeContentReferences(tx, "PLAYLIST", id);
    await tx.viewingProgress.deleteMany({ where: { scopeKey: `playlist:${id}` } });
    await tx.playlist.delete({ where: { id } });
    await recordAudit(tx, actor, { action: "playlist.delete", entityType: "Playlist", entityId: id, metadata: { title: existing.title, slug: existing.slug, sourceKey: existing.sourceKey } });
  });
}

// ---------------------------------------------------------------------------
// Items of a curated playlist. A YouTube playlist's items come only from YouTube.
// ---------------------------------------------------------------------------

async function loadCuratedForEditing(tx: Prisma.TransactionClient, playlistId: string): Promise<void> {
  const playlist = await tx.playlist.findUnique({ where: { id: playlistId }, select: { type: true } });
  if (!playlist) throw new AppError("NOT_FOUND");
  if (playlist.type !== "CURATED") throw new AppError("CONFLICT", strings.playlists.youtubeItemsLocked);
}

const addItemSchema = z.strictObject({ playlistId: objectIdSchema, videoId: objectIdSchema });

/** Added at the end. One video can be in any number of playlists, but only once in each. */
export async function addPlaylistItem(actor: Actor | null, rawInput: unknown): Promise<void> {
  assertPermission(actor, "playlists.manage");
  const parsed = addItemSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { playlistId, videoId } = parsed.data;

  try {
    await withTransaction(async (tx) => {
      await loadCuratedForEditing(tx, playlistId);
      if (!(await tx.video.count({ where: { id: videoId } }))) throw new AppError("VALIDATION");

      const count = await tx.playlistItem.count({ where: { playlistId } });
      if (count >= MAX_CURATED_PLAYLIST_ITEMS) throw new AppError("CONFLICT", strings.playlists.tooManyItems);

      const last = await tx.playlistItem.findFirst({ where: { playlistId }, orderBy: { position: "desc" }, select: { position: true } });
      await tx.playlistItem.create({ data: { playlistId, videoId, position: (last?.position ?? -1) + 1 } });
      await tx.playlist.update({ where: { id: playlistId }, data: { itemCount: count + 1 } });
      await recordAudit(tx, actor, { action: "playlist.item_add", entityType: "Playlist", entityId: playlistId, metadata: { videoId } });
    });
  } catch (error) {
    throw conflictOnDuplicate(error);
  }
}

export async function removePlaylistItem(actor: Actor | null, rawInput: unknown): Promise<void> {
  assertPermission(actor, "playlists.manage");
  const parsed = addItemSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { playlistId, videoId } = parsed.data;

  await withTransaction(async (tx) => {
    await loadCuratedForEditing(tx, playlistId);
    await tx.playlistItem.deleteMany({ where: { playlistId, videoId } });
    await tx.playlist.update({ where: { id: playlistId }, data: { itemCount: await tx.playlistItem.count({ where: { playlistId } }) } });
    await recordAudit(tx, actor, { action: "playlist.item_remove", entityType: "Playlist", entityId: playlistId, metadata: { videoId } });
  });
}

const reorderSchema = z.strictObject({ playlistId: objectIdSchema, videoIds: z.array(objectIdSchema).max(MAX_CURATED_PLAYLIST_ITEMS) });

export async function reorderPlaylistItems(actor: Actor | null, rawInput: unknown): Promise<void> {
  assertPermission(actor, "playlists.manage");
  const parsed = reorderSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { playlistId, videoIds } = parsed.data;

  await withTransaction(async (tx) => {
    await loadCuratedForEditing(tx, playlistId);
    const items = await tx.playlistItem.findMany({ where: { playlistId }, select: { id: true, videoId: true } });
    const ordered = validateReorder(
      items.map((item) => item.videoId),
      videoIds,
    );
    // Someone else changed the list since this screen loaded, so nothing is applied.
    if (!ordered) throw new AppError("CONFLICT", strings.playlists.listChanged);

    const idByVideo = new Map(items.map((item) => [item.videoId, item.id]));
    for (const [position, videoId] of ordered.entries()) await tx.playlistItem.update({ where: { id: idByVideo.get(videoId)! }, data: { position } });
    await recordAudit(tx, actor, { action: "playlist.reorder", entityType: "Playlist", entityId: playlistId });
  });
}

const noteSchema = z.strictObject({ playlistId: objectIdSchema, videoId: objectIdSchema, note: z.string().trim().max(500).nullable() });

export async function setPlaylistItemNote(actor: Actor | null, rawInput: unknown): Promise<void> {
  assertPermission(actor, "playlists.manage");
  const parsed = noteSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { playlistId, videoId, note } = parsed.data;

  await withTransaction(async (tx) => {
    await loadCuratedForEditing(tx, playlistId);
    const { count } = await tx.playlistItem.updateMany({ where: { playlistId, videoId }, data: { note: note || null } });
    if (count === 0) throw new AppError("NOT_FOUND");
    await recordAudit(tx, actor, { action: "playlist.item_note", entityType: "Playlist", entityId: playlistId, metadata: { videoId } });
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const adminListSchema = z.strictObject({ query: z.string().max(120).optional(), status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(), cursor: z.string().optional() });

export async function listPlaylistsForAdmin(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "admin.access");
  const parsed = adminListSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { query, status, cursor } = parsed.data;
  const search = query ? normalizeArabicForSearch(query) : "";

  const rows = await prisma.playlist.findMany({
    where: { ...(search ? { titleSearch: { contains: search } } : {}), ...(status === "ARCHIVED" ? { isArchived: true } : { isArchived: false, ...(status ? { status } : {}) }) },
    orderBy: { id: "desc" },
    take: ADMIN_PAGE_SIZE + 1,
    ...cursorArgs(parseOptionalCursor(cursor)),
    select: { id: true, type: true, title: true, youtubePlaylistId: true, status: true, isArchived: true, updatedAt: true, itemCount: true },
  });
  return toCursorPage(rows, ADMIN_PAGE_SIZE);
}

export async function getPlaylistForEditing(actor: Actor | null, rawId: unknown) {
  assertPermission(actor, "admin.access");
  const playlist = await prisma.playlist.findUnique({
    where: { id: parseId(rawId) },
    include: {
      items: {
        orderBy: { position: "asc" },
        take: MAX_CURATED_PLAYLIST_ITEMS,
        select: { note: true, video: { select: { id: true, title: true, kind: true, channelTitle: true, status: true, availability: true } } },
      },
    },
  });
  if (!playlist) throw new AppError("NOT_FOUND");
  return {
    ...playlist,
    items: playlist.items.map(({ note, video }) => ({
      videoId: video.id,
      note,
      title: video.title,
      hint: videoPickerLabel(video),
      isDraft: video.status === "DRAFT",
      isUnavailable: video.availability !== "AVAILABLE",
    })),
  };
}

export async function listPublicPlaylists(options: { cursor?: unknown } = {}) {
  const rows = await prisma.playlist.findMany({
    where: publicPlaylistFilter,
    orderBy: [{ isFeatured: "desc" }, { displayOrder: "asc" }, { id: "desc" }],
    take: PUBLIC_PAGE_SIZE + 1,
    ...cursorArgs(parseOptionalCursor(options.cursor)),
    select: playlistCardSelect,
  });
  return toCursorPage(rows, PUBLIC_PAGE_SIZE);
}

export interface PublicPlaylistItem {
  videoId: string;
  youtubeVideoId: string;
  kind: "SHORT" | "LONG_FORM";
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  note: string | null;
}

export async function getPublishedPlaylistBySlug(rawSlug: string) {
  const slug = decodeSlugParam(rawSlug);
  if (!slug) return null;
  const playlist = await prisma.playlist.findFirst({ where: { slug, ...publicPlaylistFilter } });
  if (!playlist) return null;

  // YouTube's own playlist player shows every video it holds, so this list has to match it, whatever
  // a video's status here. A curated playlist is our own choice, so its videos must be published.
  const videoFilter: Prisma.VideoWhereInput = playlist.type === "YOUTUBE" ? { isArchived: false, availability: "AVAILABLE" } : publicVideoFilter;
  const rows = await prisma.playlistItem.findMany({
    where: { playlistId: playlist.id, video: videoFilter },
    orderBy: { position: "asc" },
    take: MAX_CURATED_PLAYLIST_ITEMS,
    select: { note: true, video: { select: { id: true, youtubeVideoId: true, kind: true, title: true, channelTitle: true, thumbnails: true, durationSeconds: true } } },
  });

  const items: PublicPlaylistItem[] = rows.map(({ note, video }) => ({
    videoId: video.id,
    youtubeVideoId: video.youtubeVideoId,
    kind: video.kind,
    title: video.title,
    channelTitle: video.channelTitle,
    thumbnailUrl: pickThumbnailUrl(video.thumbnails),
    durationSeconds: video.durationSeconds,
    note,
  }));
  return { playlist, items };
}

/** Only public targets, so a link to hidden content simply doesn't render. Related means shares a topic. */
export async function getPlaylistConnections(playlistId: string) {
  const [topicLinks, articleLinks, libraryLinks] = await Promise.all([
    prisma.playlistTopic.findMany({ where: { playlistId, topic: { status: "PUBLISHED", isArchived: false } }, take: RELATED_LIMIT, select: { topic: { select: topicCardSelect } } }),
    prisma.articlePlaylist.findMany({ where: { playlistId, article: { status: "PUBLISHED", isArchived: false } }, take: RELATED_LIMIT, select: { article: { select: articleCardSelect } } }),
    prisma.playlistLibrary.findMany({ where: { playlistId, library: { status: "PUBLISHED", isArchived: false } }, take: RELATED_LIMIT, select: { library: { select: libraryCardSelect } } }),
  ]);
  const topicIds = topicLinks.map((link) => link.topic.id);
  const related = topicIds.length
    ? await prisma.playlist.findMany({
        where: { ...publicPlaylistFilter, id: { not: playlistId }, topics: { some: { topicId: { in: topicIds } } } },
        orderBy: { id: "desc" },
        take: RELATED_LIMIT,
        select: playlistCardSelect,
      })
    : [];

  return { topics: topicLinks.map((link) => link.topic), articles: articleLinks.map((link) => link.article), libraries: libraryLinks.map((link) => link.library), related };
}

/** For the pages of topics, libraries, and articles. */
export async function listPublicPlaylistsFor(filter: { topicId: string } | { libraryId: string } | { articleId: string }): Promise<PlaylistCardData[]> {
  const where: Prisma.PlaylistWhereInput =
    "topicId" in filter ? { topics: { some: { topicId: filter.topicId } } } : "libraryId" in filter ? { libraries: { some: { libraryId: filter.libraryId } } } : { articles: { some: { articleId: filter.articleId } } };
  return prisma.playlist.findMany({ where: { ...publicPlaylistFilter, ...where }, orderBy: { id: "desc" }, take: RELATED_LIMIT, select: playlistCardSelect });
}
