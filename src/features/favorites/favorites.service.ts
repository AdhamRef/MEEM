import { z } from "zod";
import { objectIdSchema } from "@/features/categories/schemas";
import { publicContentFilter } from "@/features/content/common";
import { publicPlaylistFilter } from "@/features/playlists/playlist-filters";
import { applyCategorySignal } from "@/features/recommendations/signals.service";
import { getScoringConfig } from "@/features/recommendations/settings.service";
import { AppError, isUniqueConstraintError } from "@/lib/errors";
import { assertSignedIn, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";

export const SAVEABLE_TYPES = ["VIDEO", "ARTICLE", "TOPIC", "PLAYLIST"] as const;
export type SaveableType = (typeof SAVEABLE_TYPES)[number];

export const saveVideoSchema = z.strictObject({ videoId: objectIdSchema, isSaved: z.boolean() });
export const saveContentSchema = z.strictObject({ entityType: z.enum(SAVEABLE_TYPES), entityId: objectIdSchema, isSaved: z.boolean() });

const MAX_STATUS_IDS = 50;

/** The item, if it's public. A playlist has no category, so saving one changes no recommendation. */
async function findSaveable(entityType: SaveableType, id: string): Promise<{ categoryId: string | null } | null> {
  switch (entityType) {
    case "VIDEO":
      return prisma.video.findFirst({ where: { id, status: "PUBLISHED", isArchived: false }, select: { categoryId: true } });
    case "ARTICLE":
      return prisma.article.findFirst({ where: { id, ...publicContentFilter }, select: { categoryId: true } });
    case "TOPIC":
      return prisma.topic.findFirst({ where: { id, ...publicContentFilter }, select: { categoryId: true } });
    case "PLAYLIST": {
      const playlist = await prisma.playlist.findFirst({ where: { id, ...publicPlaylistFilter }, select: { id: true } });
      return playlist ? { categoryId: null } : null;
    }
  }
}

/** Saving twice is fine, and only the first save counts as a signal. */
export async function setContentSaved(actor: Actor | null, rawInput: unknown): Promise<{ isSaved: boolean }> {
  assertSignedIn(actor);
  const parsed = saveContentSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { entityType, entityId, isSaved } = parsed.data;

  if (!isSaved) {
    await prisma.favorite.deleteMany({ where: { userId: actor.id, entityType, entityId } });
    return { isSaved: false };
  }

  const item = await findSaveable(entityType, entityId);
  if (!item) throw new AppError("NOT_FOUND");

  const config = await getScoringConfig();
  const now = new Date();
  try {
    await withTransaction(async (tx) => {
      await tx.favorite.create({ data: { userId: actor.id, entityType, entityId } });
      if (item.categoryId) await applyCategorySignal(tx, actor.id, item.categoryId, "save", config, now);
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }
  return { isSaved: true };
}

export async function setVideoSaved(actor: Actor | null, rawInput: unknown): Promise<{ isSaved: boolean }> {
  assertSignedIn(actor);
  const parsed = saveVideoSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  return setContentSaved(actor, { entityType: "VIDEO", entityId: parsed.data.videoId, isSaved: parsed.data.isSaved });
}

/** Which of these items the person has saved. Their own data only. */
export async function getSavedIds(actor: Actor | null, rawType: unknown, rawIds: unknown): Promise<string[]> {
  assertSignedIn(actor);
  const type = z.enum(SAVEABLE_TYPES).safeParse(rawType);
  const ids = z.array(objectIdSchema).max(MAX_STATUS_IDS).safeParse(rawIds);
  if (!type.success || !ids.success) throw new AppError("VALIDATION");
  if (ids.data.length === 0) return [];

  const favorites = await prisma.favorite.findMany({
    where: { userId: actor.id, entityType: type.data, entityId: { in: ids.data } },
    select: { entityId: true },
  });
  return favorites.map((favorite) => favorite.entityId);
}

export const getSavedVideoIds = (actor: Actor | null, rawIds: unknown) => getSavedIds(actor, "VIDEO", rawIds);
