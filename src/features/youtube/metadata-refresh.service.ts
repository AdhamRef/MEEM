import type { Prisma } from "@prisma/client";
import { recordAudit } from "@/features/admin/audit";
import { assertPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isYouTubeApiConfigured, YouTubeApiError } from "@/lib/youtube/client";
import { getQuotaUsage } from "@/lib/youtube/quota";
import { fetchVideoBatch, VIDEOS_PER_REQUEST } from "@/lib/youtube/videos";
import { getYouTubeSettings, MAX_DATA_AGE_DAYS } from "./settings.service";
import { refreshDueChannels, withdrawExpiredChannels } from "./channels.service";
import { syncYouTubePlaylist, withdrawExpiredPlaylists } from "./playlist-sync.service";
import { clearedYouTubeFields, youtubeFields } from "./video-persistence";

const MS_PER_DAY = 86_400_000;

/** A sync costs about 2 quota units per 50 videos, so this bounds what one run can spend on playlists. */
const PLAYLISTS_PER_RUN = 10;

export type RefreshStopReason = "NOT_CONFIGURED" | "QUOTA_EXCEEDED" | "API_ERROR" | null;

export interface RefreshReport {
  checked: number;
  updated: number;
  removedFromYouTube: number;
  withdrawn: number;
  remaining: number;
  playlistsSynced: number;
  playlistsRemoved: number;
  playlistsWithdrawn: number;
  channelsUpdated: number;
  channelsRemoved: number;
  channelsWithdrawn: number;
  stoppedBy: RefreshStopReason;
}

function stopReasonOf(error: unknown): Exclude<RefreshStopReason, null> {
  if (error instanceof YouTubeApiError) {
    if (error.reason === "NOT_CONFIGURED") return "NOT_CONFIGURED";
    if (error.reason === "QUOTA_EXCEEDED") return "QUOTA_EXCEEDED";
    return "API_ERROR";
  }
  throw error;
}

/**
 * Past YouTube's 30-day limit with nothing fresher, the stored data must go, even when the
 * API is off or out of quota. The video leaves public pages until a refresh succeeds.
 */
async function withdrawExpiredVideos(now: Date): Promise<number> {
  const expiredBefore = new Date(now.getTime() - MAX_DATA_AGE_DAYS * MS_PER_DAY);
  const { count } = await prisma.video.updateMany({
    where: { metadataFetchedAt: { lt: expiredBefore }, title: { not: "" } },
    data: clearedYouTubeFields("UNKNOWN"),
  });
  return count;
}

/**
 * Refreshes the oldest data first, within a fixed number of batches per run, so quota use
 * stays predictable. This is also how deleted videos are noticed. It runs from the admin
 * dashboard or the protected cron endpoint, never during a feed render.
 */
export async function runMetadataRefresh(now = new Date()): Promise<RefreshReport> {
  const settings = await getYouTubeSettings();
  const refreshBefore = new Date(now.getTime() - settings.refreshAfterDays * MS_PER_DAY);
  const staleFilter = { metadataFetchedAt: { lt: refreshBefore } };

  const report: RefreshReport = { checked: 0, updated: 0, removedFromYouTube: 0, withdrawn: 0, remaining: 0, playlistsSynced: 0, playlistsRemoved: 0, playlistsWithdrawn: 0, channelsUpdated: 0, channelsRemoved: 0, channelsWithdrawn: 0, stoppedBy: null };

  if (!isYouTubeApiConfigured()) {
    report.stoppedBy = "NOT_CONFIGURED";
  } else {
    for (let batchNumber = 0; batchNumber < settings.refreshBatchesPerRun; batchNumber += 1) {
      const batch = await prisma.video.findMany({
        where: staleFilter,
        orderBy: { metadataFetchedAt: "asc" },
        take: VIDEOS_PER_REQUEST,
        select: { id: true, youtubeVideoId: true },
      });
      if (batch.length === 0) break;

      let fetched;
      try {
        fetched = await fetchVideoBatch(
          batch.map((video) => video.youtubeVideoId),
          { includeStatistics: settings.statisticsEnabled },
        );
      } catch (error) {
        report.stoppedBy = stopReasonOf(error);
        break;
      }

      const byYouTubeId = new Map(fetched.map((video) => [video.youtubeVideoId, video]));
      for (const { id, youtubeVideoId } of batch) {
        report.checked += 1;
        const video = byYouTubeId.get(youtubeVideoId);
        if (video) {
          await prisma.video.update({ where: { id }, data: youtubeFields(video, { includeStatistics: settings.statisticsEnabled, now }) });
          report.updated += 1;
        } else {
          await prisma.video.update({ where: { id }, data: { ...clearedYouTubeFields("UNAVAILABLE"), metadataFetchedAt: now } });
          report.removedFromYouTube += 1;
        }
      }
    }
  }

  // Also how a playlist's membership stays within the 30-day limit, and how a deleted one is noticed.
  if (!report.stoppedBy) {
    const due = await prisma.playlist.findMany({ where: { type: "YOUTUBE", metadataFetchedAt: { lt: refreshBefore } }, orderBy: { metadataFetchedAt: "asc" }, take: PLAYLISTS_PER_RUN, select: { id: true } });
    for (const { id } of due) {
      try {
        const sync = await syncYouTubePlaylist(id, undefined, now);
        if (sync.outcome === "SYNCED") report.playlistsSynced += 1;
        else report.playlistsRemoved += 1;
      } catch (error) {
        report.stoppedBy = stopReasonOf(error);
        break;
      }
    }
  }

  if (!report.stoppedBy) {
    try {
      const channels = await refreshDueChannels(refreshBefore, now);
      report.channelsUpdated = channels.updated;
      report.channelsRemoved = channels.removed;
    } catch (error) {
      report.stoppedBy = stopReasonOf(error);
    }
  }

  report.withdrawn = await withdrawExpiredVideos(now);
  report.channelsWithdrawn = await withdrawExpiredChannels(new Date(now.getTime() - MAX_DATA_AGE_DAYS * MS_PER_DAY));
  report.playlistsWithdrawn = await withdrawExpiredPlaylists(new Date(now.getTime() - MAX_DATA_AGE_DAYS * MS_PER_DAY));
  report.remaining = await prisma.video.count({ where: staleFilter });
  return report;
}

export async function runMetadataRefreshAs(actor: Actor | null): Promise<RefreshReport> {
  assertPermission(actor, "youtube.import");
  const report = await runMetadataRefresh();
  await recordAudit(prisma, actor, { action: "youtube.refresh_metadata", entityType: "Video", metadata: { ...report } });
  return report;
}

export interface YouTubeStatus {
  isConfigured: boolean;
  quotaUnitsToday: number;
  quotaExhausted: boolean;
  videosDueForRefresh: number;
}

export async function getYouTubeStatus(actor: Actor | null, now = new Date()): Promise<YouTubeStatus> {
  assertPermission(actor, "youtube.import");
  const settings = await getYouTubeSettings();
  const [quota, videosDueForRefresh] = await Promise.all([
    getQuotaUsage(now),
    prisma.video.count({ where: { metadataFetchedAt: { lt: new Date(now.getTime() - settings.refreshAfterDays * MS_PER_DAY) } } }),
  ]);
  return { isConfigured: isYouTubeApiConfigured(), quotaUnitsToday: quota.units, quotaExhausted: quota.exhausted, videosDueForRefresh };
}

/** The daily job. A scheduler has no account, so its audit record names it as the system. */
export async function runScheduledRefresh() {
  const report = await runMetadataRefresh();
  await prisma.auditLog.create({
    data: { actorEmail: "system:cron", action: "youtube.refresh_metadata", entityType: "Video", metadata: { ...report } },
  });
  return report;
}

export interface StatisticsBackfillReport {
  updated: number;
  remaining: number;
  stoppedBy?: RefreshReport["stoppedBy"];
}

/**
 * Likes and comment counts for videos stored before they were collected. Costs 1 quota unit per 50
 * videos. It only reads what's missing, so running it again continues where it stopped.
 */
export async function backfillVideoStatistics(maxBatches: number, now = new Date()): Promise<StatisticsBackfillReport> {
  const missing = { availability: "AVAILABLE", OR: [{ stats: { isSet: false } }, { stats: null }] } satisfies Prisma.VideoWhereInput;
  const report: StatisticsBackfillReport = { updated: 0, remaining: 0 };
  if (!isYouTubeApiConfigured()) report.stoppedBy = "NOT_CONFIGURED";

  let afterId: string | undefined;
  for (let batchNumber = 0; batchNumber < maxBatches && !report.stoppedBy; batchNumber += 1) {
    const batch: { id: string; youtubeVideoId: string }[] = await prisma.video.findMany({
      where: { ...missing, ...(afterId ? { id: { gt: afterId } } : {}) },
      orderBy: { id: "asc" },
      take: VIDEOS_PER_REQUEST,
      select: { id: true, youtubeVideoId: true },
    });
    if (batch.length === 0) break;
    afterId = batch.at(-1)!.id;

    let fetched;
    try {
      fetched = await fetchVideoBatch(
        batch.map((video) => video.youtubeVideoId),
        { includeStatistics: true },
      );
    } catch (error) {
      report.stoppedBy = stopReasonOf(error);
      break;
    }
    const byYouTubeId = new Map(fetched.map((video) => [video.youtubeVideoId, video]));
    for (const { id, youtubeVideoId } of batch) {
      const statistics = byYouTubeId.get(youtubeVideoId)?.statistics;
      if (!statistics) continue;
      await prisma.video.update({ where: { id }, data: { stats: { ...statistics, fetchedAt: now } } });
      report.updated += 1;
    }
  }

  report.remaining = await prisma.video.count({ where: missing });
  return report;
}

export async function backfillVideoStatisticsAs(actor: Actor | null, maxBatches = 20): Promise<StatisticsBackfillReport> {
  assertPermission(actor, "youtube.import");
  const report = await backfillVideoStatistics(maxBatches);
  await recordAudit(prisma, actor, { action: "youtube.backfill_statistics", entityType: "Video", metadata: { updated: report.updated, remaining: report.remaining } });
  return report;
}
