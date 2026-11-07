import { prisma } from "@/lib/prisma";
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
        data: { title: channel.title, description: channel.description, handle: channel.handle, thumbnailUrl: channel.thumbnailUrl, uploadsPlaylistId: channel.uploadsPlaylistId, youtubeVideoCount: channel.videoCount, metadataFetchedAt: now },
      });
      updated += 1;
    } else {
      await prisma.youTubeChannel.update({ where: { id }, data: { title: "", description: null, handle: null, thumbnailUrl: null, uploadsPlaylistId: null, youtubeVideoCount: null, isActive: false, metadataFetchedAt: now } });
      removed += 1;
    }
  }
  return { updated, removed };
}

/** Past the 30-day limit with nothing fresher, even with the API off or out of quota. */
export async function withdrawExpiredChannels(expiredBefore: Date): Promise<number> {
  const { count } = await prisma.youTubeChannel.updateMany({
    where: { metadataFetchedAt: { lt: expiredBefore }, title: { not: "" } },
    data: { title: "", description: null, handle: null, thumbnailUrl: null, uploadsPlaylistId: null, youtubeVideoCount: null },
  });
  return count;
}
