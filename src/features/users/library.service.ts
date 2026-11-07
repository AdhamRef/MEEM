import type { ContentType } from "@prisma/client";
import { z } from "zod";
import { objectIdSchema } from "@/features/topics/schemas";
import { cursorArgs, parseOptionalCursor, publicContentFilter, toCursorPage, type CursorPage } from "@/features/content/common";
import { contentKey, resolvePublicContent, type ResolvedContent } from "@/features/content/resolve";
import { publicPlaylistFilter } from "@/features/playlists/playlist-filters";
import type { VideoCard } from "@/features/shorts/types";
import { publicVideoFilter, toVideoCards, videoCardSelect } from "@/features/shorts/video-cards";
import { AppError, isUniqueConstraintError } from "@/lib/errors";
import { assertSignedIn, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const LIBRARY_PAGE_SIZE = 20;
const CONTINUE_WATCHING_LIMIT = 6;
const MS_PER_DAY = 86_400_000;
/** History is for finding something again. It isn't a permanent record of what someone read. */
const VIEW_RETENTION_DAYS = 90;

export const SAVED_FILTERS = ["VIDEO", "ARTICLE", "TOPIC", "PLAYLIST"] as const;
export type SavedFilter = (typeof SAVED_FILTERS)[number];

export interface LibraryEntry {
  id: string;
  entityType: ContentType;
  entityId: string;
  /** Null when the item is no longer public. It can still be removed from the list. */
  content: ResolvedContent | null;
  at: Date;
}

async function toEntries(rows: { id: string; entityType: ContentType; entityId: string; at: Date }[]): Promise<LibraryEntry[]> {
  const resolved = await resolvePublicContent(rows);
  return rows.map((row) => ({ ...row, content: resolved.get(contentKey(row)) ?? null }));
}

/** The person's own saved items, newest first. Their ID always comes from the session. */
export async function listSavedContent(actor: Actor | null, options: { type?: unknown; cursor?: unknown } = {}): Promise<CursorPage<LibraryEntry>> {
  assertSignedIn(actor);
  const type = z.enum(SAVED_FILTERS).safeParse(options.type);
  const rows = await prisma.favorite.findMany({
    where: { userId: actor.id, entityType: type.success ? type.data : { in: [...SAVED_FILTERS] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LIBRARY_PAGE_SIZE + 1,
    ...cursorArgs(parseOptionalCursor(options.cursor)),
    select: { id: true, entityType: true, entityId: true, createdAt: true },
  });
  const page = toCursorPage(rows, LIBRARY_PAGE_SIZE);
  return { items: await toEntries(page.items.map(({ createdAt, ...row }) => ({ ...row, at: createdAt }))), nextCursor: page.nextCursor };
}

/** Only what the site shows a page for, so a history entry always has somewhere to go. */
export const viewInputSchema = z.strictObject({
  entityType: z.enum(["VIDEO", "ARTICLE", "TOPIC", "LIBRARY", "PLAYLIST", "RESOURCE"]),
  entityId: objectIdSchema,
});

async function isPublic(entityType: ContentType, entityId: string): Promise<boolean> {
  const where = { id: entityId };
  switch (entityType) {
    case "VIDEO":
      return (await prisma.video.count({ where: { ...where, ...publicVideoFilter } })) > 0;
    case "ARTICLE":
      return (await prisma.article.count({ where: { ...where, ...publicContentFilter } })) > 0;
    case "TOPIC":
      return (await prisma.topic.count({ where: { ...where, ...publicContentFilter } })) > 0;
    case "LIBRARY":
      return (await prisma.library.count({ where: { ...where, ...publicContentFilter } })) > 0;
    case "PLAYLIST":
      return (await prisma.playlist.count({ where: { ...where, ...publicPlaylistFilter } })) > 0;
    case "RESOURCE":
      return (await prisma.externalResource.count({ where: { ...where, ...publicContentFilter } })) > 0;
  }
}

/**
 * One record per person and item, moved forward on each visit. A unique index guarantees it,
 * so history lists each thing once, and counting records counts people rather than page loads.
 * This says nothing about interests: only what §9.2 lists changes a recommendation.
 */
export async function recordContentView(actor: Actor | null, rawInput: unknown, now = new Date()): Promise<void> {
  assertSignedIn(actor);
  const parsed = viewInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { entityType, entityId } = parsed.data;
  if (!(await isPublic(entityType, entityId))) throw new AppError("NOT_FOUND");

  const where = { userId: actor.id, entityType, entityId, action: "VIEW" as const };
  const times = { occurredAt: now, expiresAt: new Date(now.getTime() + VIEW_RETENTION_DAYS * MS_PER_DAY) };

  const { count } = await prisma.userActivity.updateMany({ where, data: times });
  if (count > 0) return;
  try {
    await prisma.userActivity.create({ data: { ...where, ...times } });
  } catch (error) {
    // Two first views raced, and the other one's record is just as good.
    if (!isUniqueConstraintError(error)) throw error;
  }
}

export async function listHistory(actor: Actor | null, options: { cursor?: unknown } = {}): Promise<CursorPage<LibraryEntry>> {
  assertSignedIn(actor);
  const rows = await prisma.userActivity.findMany({
    where: { userId: actor.id, action: "VIEW" },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: LIBRARY_PAGE_SIZE + 1,
    ...cursorArgs(parseOptionalCursor(options.cursor)),
    select: { id: true, entityType: true, entityId: true, occurredAt: true },
  });
  const page = toCursorPage(rows, LIBRARY_PAGE_SIZE);
  return { items: await toEntries(page.items.map(({ occurredAt, ...row }) => ({ ...row, at: occurredAt }))), nextCursor: page.nextCursor };
}

/** Removing a video from history also forgets where the person stopped watching it on its own page. */
export async function removeFromHistory(actor: Actor | null, rawInput: unknown): Promise<void> {
  assertSignedIn(actor);
  const parsed = viewInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { entityType, entityId } = parsed.data;

  await prisma.userActivity.deleteMany({ where: { userId: actor.id, entityType, entityId, action: "VIEW" } });
  if (entityType === "VIDEO") await prisma.viewingProgress.deleteMany({ where: { userId: actor.id, videoId: entityId, scopeKey: "video" } });
}

/** Clears what history shows, and viewing positions with it. Interests and saved items stay. */
export async function clearHistory(actor: Actor | null): Promise<void> {
  assertSignedIn(actor);
  await prisma.userActivity.deleteMany({ where: { userId: actor.id, action: "VIEW" } });
  await prisma.viewingProgress.deleteMany({ where: { userId: actor.id } });
}

export interface ContinueWatchingItem {
  video: VideoCard;
  positionSeconds: number;
  durationSeconds: number | null;
  /** The page to continue on: the playlist it was being watched in, or the video's own page. */
  href: string;
  playlistTitle: string | null;
}

/** Unfinished videos, wherever progress was really observed (limit L7). */
export async function listContinueWatching(actor: Actor | null): Promise<ContinueWatchingItem[]> {
  assertSignedIn(actor);
  // Finished or barely started items, and those no longer public, can fill the first rows.
  const rows = await prisma.viewingProgress.findMany({
    where: { userId: actor.id, isCompleted: false, positionSeconds: { gt: 0 } },
    orderBy: { updatedAt: "desc" },
    take: CONTINUE_WATCHING_LIMIT * 3,
    select: { videoId: true, playlistId: true, positionSeconds: true, durationSeconds: true, video: { select: { ...videoCardSelect, status: true, isArchived: true, availability: true } } },
  });

  const playlistIds = [...new Set(rows.flatMap((row) => (row.playlistId ? [row.playlistId] : [])))];
  const playlists = playlistIds.length ? await prisma.playlist.findMany({ where: { id: { in: playlistIds }, ...publicPlaylistFilter }, select: { id: true, slug: true, title: true } }) : [];
  const playlistById = new Map(playlists.map((playlist) => [playlist.id, playlist]));

  // A YouTube playlist's items can stay drafts, and are public on that playlist's page only.
  const visible = rows.filter(({ video, playlistId }) => {
    if (video.isArchived || video.availability !== "AVAILABLE") return false;
    return playlistId ? playlistById.has(playlistId) : video.status === "PUBLISHED";
  });
  const kept = visible.slice(0, CONTINUE_WATCHING_LIMIT);
  const cards = new Map((await toVideoCards(kept.map((row) => row.video))).map((card) => [card.id, card]));

  return kept.flatMap((row) => {
    const video = cards.get(row.videoId);
    if (!video) return [];
    const playlist = row.playlistId ? playlistById.get(row.playlistId) : undefined;
    return [
      {
        video,
        positionSeconds: row.positionSeconds,
        durationSeconds: row.durationSeconds,
        href: playlist ? `/playlists/${encodeURIComponent(playlist.slug)}` : `/videos/${row.videoId}`,
        playlistTitle: playlist?.title ?? null,
      },
    ];
  });
}
