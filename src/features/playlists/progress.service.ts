import { z } from "zod";
import { objectIdSchema } from "@/features/topics/schemas";
import { parseId } from "@/features/content/common";
import { publicVideoFilter } from "@/features/shorts/video-cards";
import { AppError, isUniqueConstraintError } from "@/lib/errors";
import { assertSignedIn, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { publicPlaylistFilter } from "./playlist-filters";
import { isWatchComplete } from "./rules";

const MAX_SECONDS = 24 * 3600 * 7;

export const progressInputSchema = z.strictObject({
  videoId: objectIdSchema,
  playlistId: objectIdSchema.nullable().optional(),
  positionSeconds: z.number().min(0).max(MAX_SECONDS),
  durationSeconds: z.number().min(0).max(MAX_SECONDS).nullable().optional(),
  didEnd: z.boolean().optional(),
});

/** Only what was really observed while playing on this site reaches here (limit L7). */
export async function recordViewingProgress(actor: Actor | null, rawInput: unknown): Promise<void> {
  assertSignedIn(actor);
  const parsed = progressInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { videoId, playlistId, didEnd = false } = parsed.data;

  if (playlistId) {
    const item = await prisma.playlistItem.findFirst({
      where: { playlistId, videoId, playlist: publicPlaylistFilter, video: { isArchived: false, availability: "AVAILABLE" } },
      select: { id: true },
    });
    if (!item) throw new AppError("NOT_FOUND");
  } else {
    const video = await prisma.video.findFirst({ where: { id: videoId, ...publicVideoFilter }, select: { id: true } });
    if (!video) throw new AppError("NOT_FOUND");
  }

  const durationSeconds = parsed.data.durationSeconds ? Math.round(parsed.data.durationSeconds) : null;
  const positionSeconds = Math.round(durationSeconds === null ? parsed.data.positionSeconds : Math.min(parsed.data.positionSeconds, durationSeconds));
  const scopeKey = playlistId ? `playlist:${playlistId}` : "video";
  const isCompletedNow = isWatchComplete(positionSeconds, durationSeconds, didEnd);
  const key = { userId_videoId_scopeKey: { userId: actor.id, videoId, scopeKey } };

  const write = () =>
    prisma.viewingProgress.upsert({
      where: key,
      // Rewatching the start of something finished doesn't undo having finished it.
      update: { positionSeconds, durationSeconds, ...(isCompletedNow ? { isCompleted: true } : {}), playlistId: playlistId ?? null },
      create: { userId: actor.id, videoId, scopeKey, playlistId: playlistId ?? null, positionSeconds, durationSeconds, isCompleted: isCompletedNow },
    });

  try {
    await write();
  } catch (error) {
    // Two first reports raced. The record exists now, so this one updates it.
    if (!isUniqueConstraintError(error)) throw error;
    await write();
  }
}

export interface PlaylistProgress {
  items: { videoId: string; positionSeconds: number; durationSeconds: number | null; isCompleted: boolean }[];
  lastVideoId: string | null;
}

/** The person's own progress only. Their ID always comes from the session. */
export async function getPlaylistProgress(actor: Actor | null, rawPlaylistId: unknown): Promise<PlaylistProgress> {
  assertSignedIn(actor);
  const playlistId = parseId(rawPlaylistId);
  const rows = await prisma.viewingProgress.findMany({
    where: { userId: actor.id, scopeKey: `playlist:${playlistId}` },
    orderBy: { updatedAt: "desc" },
    take: 500,
    select: { videoId: true, positionSeconds: true, durationSeconds: true, isCompleted: true },
  });
  return { items: rows, lastVideoId: rows[0]?.videoId ?? null };
}

export async function getVideoProgress(actor: Actor | null, rawVideoId: unknown) {
  assertSignedIn(actor);
  const videoId = parseId(rawVideoId);
  return prisma.viewingProgress.findUnique({
    where: { userId_videoId_scopeKey: { userId: actor.id, videoId, scopeKey: "video" } },
    select: { positionSeconds: true, durationSeconds: true, isCompleted: true },
  });
}
