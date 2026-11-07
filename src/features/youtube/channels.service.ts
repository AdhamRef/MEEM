import { recordAudit } from "@/features/admin/audit";
import { parseId, parseOptionalCursor, toCursorPage } from "@/features/content/common";
import { AppError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { fetchChannelBatch } from "@/lib/youtube/channels";

const CHANNELS_PER_RUN = 50;

/** Part of the daily refresh. Channels hold YouTube data too, with the same 30-day limit. */
export async function refreshDueChannels(refreshBefore: Date, now: Date): Promise<{ updated: number; removed: number }> {
  const due = await prisma.youTubeChannel.findMany({ where: { metadataFetchedAt: { lt: refreshBefore } }, orderBy: { metadataFetchedAt: "asc" }, take: CHANNELS_PER_RUN, select: { id: true, youtubeChannelId: true } });
  if (due.length === 0) return { updated: 0, removed: 0 };

  const fetched = new Map((await fetchChannelBatch(due.map((channel) => channel.youtubeChannelId))).map((channel) => [channel.youtubeChannelId, channel]));
  let updated = 0;
  let removed = 0;
  for (const { id, youtubeChannelId } of due) {
    const channel = fetched.get(youtubeChannelId);
    if (channel) {
      await prisma.youTubeChannel.update({
        where: { id },
        data: { title: channel.title, description: channel.description, handle: channel.handle, thumbnailUrl: channel.thumbnailUrl, uploadsPlaylistId: channel.uploadsPlaylistId, metadataFetchedAt: now },
      });
      updated += 1;
    } else {
      await prisma.youTubeChannel.update({ where: { id }, data: { title: "", description: null, handle: null, thumbnailUrl: null, uploadsPlaylistId: null, isActive: false, metadataFetchedAt: now } });
      removed += 1;
    }
  }
  return { updated, removed };
}

/** Past the 30-day limit with nothing fresher, even with the API off or out of quota. */
export async function withdrawExpiredChannels(expiredBefore: Date): Promise<number> {
  const { count } = await prisma.youTubeChannel.updateMany({
    where: { metadataFetchedAt: { lt: expiredBefore }, title: { not: "" } },
    data: { title: "", description: null, handle: null, thumbnailUrl: null, uploadsPlaylistId: null },
  });
  return count;
}

export async function listChannels(actor: Actor | null, options: { query?: string; cursor?: unknown } = {}) {
  assertPermission(actor, "youtube.import");
  const cursor = parseOptionalCursor(options.cursor);
  const search = options.query?.trim();
  const rows = await prisma.youTubeChannel.findMany({
    where: search ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { handle: { contains: search, mode: "insensitive" } }] } : {},
    orderBy: { id: "desc" },
    take: 26,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, youtubeChannelId: true, title: true, handle: true, thumbnailUrl: true, isActive: true, lastSyncedAt: true, metadataFetchedAt: true, _count: { select: { videos: true } }, topics: { select: { topic: { select: { title: true } } } } },
  });
  return toCursorPage(rows, 25);
}

/** Inactive channels are skipped by people deciding what to sync. Their videos stay as they are. */
export async function setChannelActive(actor: Actor | null, rawId: unknown, isActive: boolean): Promise<void> {
  assertPermission(actor, "youtube.import");
  const id = parseId(rawId);
  await withTransaction(async (tx) => {
    const channel = await tx.youTubeChannel.findUnique({ where: { id }, select: { id: true } });
    if (!channel) throw new AppError("NOT_FOUND");
    await tx.youTubeChannel.update({ where: { id }, data: { isActive } });
    await recordAudit(tx, actor, { action: isActive ? "channel.activate" : "channel.deactivate", entityType: "YouTubeChannel", entityId: id });
  });
}
