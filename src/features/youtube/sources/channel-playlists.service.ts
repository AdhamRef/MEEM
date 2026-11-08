import { isUniqueConstraintError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { YouTubeApiError } from "@/lib/youtube/client";
import { fetchChannelPlaylistsPage } from "@/lib/youtube/playlists";
import { getQuotaUsage } from "@/lib/youtube/quota";
import { createYouTubePlaylist, publishPlaylistIfReady, syncYouTubePlaylist } from "../playlist-sync.service";
import { getYouTubeSettings } from "../settings.service";

const MS_PER_HOUR = 3_600_000;
/** A channel rarely adds playlists, so its list is read again once a day, not every hour. */
export const PLAYLIST_RESCAN_HOURS = 24;

export type PlaylistWalkStop = "QUOTA_CEILING" | "QUOTA_EXCEEDED" | "NOT_CONFIGURED" | "API_ERROR";

export interface PlaylistWalkResult {
  added: number;
  isComplete: boolean;
  stoppedBy: PlaylistWalkStop | null;
}

/** Due when the first walk isn't finished, or the last full read is a day old. */
export function arePlaylistsDue(channel: { isPlaylistsComplete: boolean | null; playlistsCheckedAt: Date | null }, now: Date): boolean {
  if (channel.isPlaylistsComplete !== true) return true;
  return !channel.playlistsCheckedAt || channel.playlistsCheckedAt.getTime() < now.getTime() - PLAYLIST_RESCAN_HOURS * MS_PER_HOUR;
}

function stopReasonOf(error: unknown): PlaylistWalkStop {
  if (!(error instanceof YouTubeApiError)) throw error;
  if (error.reason === "QUOTA_EXCEEDED") return "QUOTA_EXCEEDED";
  if (error.reason === "NOT_CONFIGURED") return "NOT_CONFIGURED";
  return "API_ERROR";
}

/**
 * Adds a channel's own playlists, published as soon as they have something to play (plan D10),
 * each with its own page on the site. The list carries every playlist's item count, so one
 * already stored is synced again only when its count changed: the daily read costs 1 unit per
 * 50 playlists, plus the pages of those that changed.
 * The place is saved after each page, so an interrupted walk continues where it stopped.
 *
 * The caller holds the channel's lease, so two walks never run on one channel at once.
 */
export async function walkChannelPlaylists(channelId: string, { deadline, enforceQuotaCeiling }: { deadline: Date; enforceQuotaCeiling: boolean }): Promise<PlaylistWalkResult> {
  const now = new Date();
  const channel = await prisma.youTubeChannel.findUnique({ where: { id: channelId }, select: { youtubeChannelId: true, isPlaylistsComplete: true, playlistsPageToken: true, playlistsCheckedAt: true } });
  if (!channel) return { added: 0, isComplete: false, stoppedBy: null };

  const settings = await getYouTubeSettings();
  // A finished walk that's due again starts over from the first page.
  let token = channel.isPlaylistsComplete === true ? null : (channel.playlistsPageToken ?? null);
  let added = 0;
  let stoppedBy: PlaylistWalkStop | null = null;
  let pagesRead = 0;

  const hasBudget = async (): Promise<boolean> => {
    if (pagesRead > 0 && Date.now() >= deadline.getTime()) return false;
    if (enforceQuotaCeiling && (await getQuotaUsage()).units >= settings.autoCheckQuotaCeiling) {
      stoppedBy = "QUOTA_CEILING";
      return false;
    }
    return true;
  };

  try {
    while (await hasBudget()) {
      const page = await fetchChannelPlaylistsPage(channel.youtubeChannelId, token);
      pagesRead += 1;

      // A page is finished before its token is saved, so nothing on it is skipped if time runs out.
      const ids = page.playlists.map((playlist) => playlist.youtubePlaylistId);
      const storedRows = await prisma.playlist.findMany({ where: { youtubePlaylistId: { in: ids } }, select: { id: true, youtubePlaylistId: true, youtubeItemCount: true, isArchived: true } });
      const stored = new Map(storedRows.map((row) => [row.youtubePlaylistId, row]));
      let synced = 0;
      for (const playlist of page.playlists) {
        const existing = stored.get(playlist.youtubePlaylistId);
        // Stored and unchanged costs nothing more. The list already carries each one's count.
        const needsSync = existing ? !existing.isArchived && playlist.itemCount !== null && playlist.itemCount !== existing.youtubeItemCount : playlist.itemCount !== 0;
        if (!needsSync) continue;
        // Each sync takes a few seconds. Stopping here leaves the page's place unsaved, so the
        // next walk reads it again and skips what's already stored. At least one always runs.
        if (synced > 0 && Date.now() >= deadline.getTime()) return { added, isComplete: false, stoppedBy: null };
        if (enforceQuotaCeiling && (await getQuotaUsage()).units >= settings.autoCheckQuotaCeiling) return { added, isComplete: false, stoppedBy: "QUOTA_CEILING" };
        synced += 1;
        let id = existing?.id;
        if (!id) {
          try {
            id = await createYouTubePlaylist(playlist, { sourceChannelId: channelId, now });
          } catch (error) {
            if (isUniqueConstraintError(error)) continue;
            throw error;
          }
        }
        await syncYouTubePlaylist(id, undefined, now);
        // Only one it just created is published. One already stored keeps the state a person gave it.
        if (!existing && (await publishPlaylistIfReady(id, now))) added += 1;
      }

      token = page.nextPageToken;
      const isComplete = !token;
      await prisma.youTubeChannel.update({
        where: { id: channelId },
        data: { playlistsPageToken: token, isPlaylistsComplete: isComplete, ...(isComplete ? { playlistsCheckedAt: now } : {}) },
      });
      if (isComplete) return { added, isComplete: true, stoppedBy: null };
    }
  } catch (error) {
    stoppedBy = stopReasonOf(error);
  }
  return { added, isComplete: false, stoppedBy };
}
