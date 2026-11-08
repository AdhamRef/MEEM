import type { Prisma } from "@prisma/client";
import { resolveSlug } from "@/features/content/common";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { buildSearchText, normalizeArabicForSearch } from "@/lib/search/normalize";
import { slugify } from "@/lib/slug";
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

/** Stores a YouTube playlist as a draft, ready to sync. The unique source key stops a second copy. */
export async function createYouTubePlaylist(metadata: NormalizedPlaylist, options: { sourceChannelId?: string; now?: Date } = {}): Promise<string> {
  const now = options.now ?? new Date();
  return withTransaction(async (tx) => {
    const isTaken = async (candidate: string) => (await tx.playlist.count({ where: { slug: candidate } })) > 0;
    const slug = await resolveSlug(slugify(metadata.title) ? metadata.title : metadata.youtubePlaylistId.toLowerCase(), null, isTaken);
    const created = await tx.playlist.create({
      data: {
        ...playlistYouTubeFields(metadata, now),
        type: "YOUTUBE",
        youtubePlaylistId: metadata.youtubePlaylistId,
        sourceKey: `yt:${metadata.youtubePlaylistId}`,
        slug,
        status: "DRAFT",
        syncStatus: "PENDING",
        ...(options.sourceChannelId ? { sourceChannelId: options.sourceChannelId } : {}),
      },
      select: { id: true },
    });
    return created.id;
  });
}

/**
 * Publishes a synced playlist from a followed source (plan D10), once it has something to play.
 * One someone unpublished or archived is left alone, so hiding it sticks.
 */
export async function publishPlaylistIfReady(playlistId: string, now = new Date()): Promise<boolean> {
  const playlist = await prisma.playlist.findUnique({ where: { id: playlistId }, select: { status: true, isArchived: true, title: true, itemCount: true, publishedAt: true } });
  if (!playlist || playlist.status !== "DRAFT" || playlist.isArchived || !playlist.title || playlist.itemCount === 0 || playlist.publishedAt) return false;
  await prisma.playlist.update({ where: { id: playlistId }, data: { status: "PUBLISHED", publishedAt: now } });
  return true;
}

export interface PlaylistSyncReport {
  outcome: "SYNCED" | "REMOVED_FROM_YOUTUBE";
  itemCount: number;
  importedVideos: number;
  isTruncated: boolean;
  /** True when YouTube's count was unchanged, so only the details were refreshed. */
  wasUnchanged?: boolean;
}

/**
 * Makes a stored playlist match YouTube. A playlist is a followed source, so videos it brings
 * that aren't stored yet are published straight away (plan D10). One already stored keeps its
 * state, so a hidden video stays hidden. Re-running creates no duplicates, and an API failure
 * leaves the stored list as it was.
 */
export async function syncYouTubePlaylist(playlistId: string, createdById: string | undefined, now = new Date(), options: { skipIfUnchanged?: boolean } = {}): Promise<PlaylistSyncReport> {
  const playlist = await prisma.playlist.findUniqueOrThrow({ where: { id: playlistId }, select: { youtubePlaylistId: true, youtubeItemCount: true, itemCount: true, syncStatus: true } });
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

    // The details request already carries YouTube's count. When it hasn't moved, the items almost
    // certainly haven't either, so the 1 to 10 item pages are skipped. A full sync still runs within
    // the 30-day refresh, which catches a swap that left the count the same.
    if (options.skipIfUnchanged && playlist.syncStatus === "SYNCED" && metadata.itemCount !== null && metadata.itemCount === playlist.youtubeItemCount) {
      // The 30-day clock is left alone, so the refresh job still does a full sync in time.
      await prisma.playlist.update({ where: { id: playlistId }, data: { ...playlistYouTubeFields(metadata, now), metadataFetchedAt: undefined } });
      return { outcome: "SYNCED", itemCount: playlist.itemCount, importedVideos: 0, isTruncated: false, wasUnchanged: true };
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
      await tx.playlist.update({ where: { id: playlistId }, data: { ...playlistYouTubeFields(metadata, now), syncStatus: "SYNCED", itemCount: ordered.length, youtubeItemCount: metadata.itemCount } });
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
