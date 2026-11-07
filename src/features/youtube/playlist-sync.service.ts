import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { buildSearchText, normalizeArabicForSearch } from "@/lib/search/normalize";
import { YouTubeApiError } from "@/lib/youtube/client";
import { fetchPlaylistMetadata, fetchPlaylistVideoIds, type NormalizedPlaylist } from "@/lib/youtube/playlists";
import { importVideosByInput } from "./video-import.service";

/** Keeps a page's item list, and one sync's quota use, within a known size. */
export const MAX_YOUTUBE_PLAYLIST_ITEMS = 500;

export function playlistYouTubeFields(playlist: NormalizedPlaylist, now: Date) {
  return {
    title: playlist.title,
    description: playlist.description,
    channelTitle: playlist.channelTitle,
    youtubeChannelId: playlist.channelYoutubeId,
    thumbnails: playlist.thumbnails,
    metadataFetchedAt: now,
    titleSearch: normalizeArabicForSearch(playlist.title),
    searchText: buildSearchText([playlist.title, playlist.description, playlist.channelTitle]),
  } satisfies Prisma.PlaylistUncheckedUpdateInput;
}

/** What remains once YouTube's data must go. A blank title keeps it off public pages. */
const clearedPlaylistFields = {
  title: "",
  description: null,
  channelTitle: null,
  youtubeChannelId: null,
  thumbnails: [],
  itemCount: 0,
  syncStatus: "FAILED",
  titleSearch: "",
  searchText: "",
} satisfies Prisma.PlaylistUncheckedUpdateManyInput;

export interface PlaylistSyncReport {
  outcome: "SYNCED" | "REMOVED_FROM_YOUTUBE";
  itemCount: number;
  importedVideos: number;
  isTruncated: boolean;
}

/**
 * Makes a stored playlist match YouTube. A playlist is a followed source, so videos it brings
 * that aren't stored yet are published straight away (plan D10). One already stored keeps its
 * state, so a hidden video stays hidden. Re-running creates no duplicates, and an API failure
 * leaves the stored list as it was.
 */
export async function syncYouTubePlaylist(playlistId: string, createdById: string | undefined, now = new Date()): Promise<PlaylistSyncReport> {
  const playlist = await prisma.playlist.findUniqueOrThrow({ where: { id: playlistId }, select: { youtubePlaylistId: true } });
  if (!playlist.youtubePlaylistId) throw new Error("Only YouTube playlists can be synced");
  const youtubePlaylistId = playlist.youtubePlaylistId;

  try {
    const metadata = await fetchPlaylistMetadata(youtubePlaylistId);
    if (!metadata) {
      await withTransaction(async (tx) => {
        await tx.playlistItem.deleteMany({ where: { playlistId } });
        await tx.playlist.update({ where: { id: playlistId }, data: { ...clearedPlaylistFields, metadataFetchedAt: now } });
      });
      return { outcome: "REMOVED_FROM_YOUTUBE", itemCount: 0, importedVideos: 0, isTruncated: false };
    }

    const { videoIds, isTruncated } = await fetchPlaylistVideoIds(youtubePlaylistId, MAX_YOUTUBE_PLAYLIST_ITEMS);
    const importReport = await importVideosByInput(videoIds, createdById, { publish: true });

    const videos = await prisma.video.findMany({ where: { youtubeVideoId: { in: videoIds } }, select: { id: true, youtubeVideoId: true } });
    const idByYouTubeId = new Map(videos.map((video) => [video.youtubeVideoId, video.id]));
    const ordered = videoIds.flatMap((id) => {
      const videoId = idByYouTubeId.get(id);
      return videoId ? [videoId] : [];
    });

    await withTransaction(async (tx) => {
      // Replaced as a whole, because YouTube decides the order. Viewing progress is keyed by video, so it survives.
      await tx.playlistItem.deleteMany({ where: { playlistId } });
      if (ordered.length) await tx.playlistItem.createMany({ data: ordered.map((videoId, position) => ({ playlistId, videoId, position })) });
      await tx.playlist.update({ where: { id: playlistId }, data: { ...playlistYouTubeFields(metadata, now), syncStatus: "SYNCED", itemCount: ordered.length } });
    });

    return { outcome: "SYNCED", itemCount: ordered.length, importedVideos: importReport.imported.length, isTruncated };
  } catch (error) {
    if (error instanceof YouTubeApiError) await prisma.playlist.update({ where: { id: playlistId }, data: { syncStatus: "FAILED" } });
    throw error;
  }
}

/** Past the 30-day limit with nothing fresher, the data must go, even with the API off or out of quota. */
export async function withdrawExpiredPlaylists(expiredBefore: Date): Promise<number> {
  const where = { type: "YOUTUBE", metadataFetchedAt: { lt: expiredBefore }, title: { not: "" } } satisfies Prisma.PlaylistWhereInput;
  const expired = await prisma.playlist.findMany({ where, select: { id: true } });
  if (expired.length === 0) return 0;

  const ids = expired.map((playlist) => playlist.id);
  await withTransaction(async (tx) => {
    await tx.playlistItem.deleteMany({ where: { playlistId: { in: ids } } });
    await tx.playlist.updateMany({ where: { id: { in: ids } }, data: clearedPlaylistFields });
  });
  return ids.length;
}
