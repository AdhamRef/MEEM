import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { strings } from "@/config/strings.ar";
import { isUniqueConstraintError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { fetchUploadsPage } from "@/lib/youtube/channels";
import { YouTubeApiError } from "@/lib/youtube/client";
import { classifyByDuration } from "@/lib/youtube/normalize";
import { getQuotaUsage } from "@/lib/youtube/quota";
import { fetchVideoBatch } from "@/lib/youtube/videos";
import { getYouTubeSettings, type YouTubeSettings } from "../settings.service";
import { youtubeFields } from "../video-persistence";

const MAX_FEED_KEY = 2 ** 31 - 1;
/** Longer than any one check may run, so a check that died mid-way frees the channel soon after. */
const LEASE_MARGIN_MS = 30_000;

export type CheckStopReason = "QUOTA_CEILING" | "QUOTA_EXCEEDED" | "NOT_CONFIGURED" | "API_ERROR" | "NOT_FOLLOWED" | "NO_UPLOADS" | "BUSY";

export interface ChannelCheckResult {
  added: number;
  isBackfillComplete: boolean;
  stoppedBy: CheckStopReason | null;
}

export interface CheckOptions {
  /** No new page starts after this. A page that started finishes, so nothing is half-stored. */
  deadline: Date;
  /** The hourly job stops at the daily ceiling. A person pressing a button doesn't. */
  enforceQuotaCeiling: boolean;
}

function stopReasonOf(error: unknown): CheckStopReason {
  if (!(error instanceof YouTubeApiError)) throw error;
  if (error.reason === "NOT_CONFIGURED") return "NOT_CONFIGURED";
  if (error.reason === "QUOTA_EXCEEDED") return "QUOTA_EXCEEDED";
  return "API_ERROR";
}

export function checkErrorMessage(reason: CheckStopReason): string | null {
  const t = strings.sources;
  switch (reason) {
    case "QUOTA_CEILING":
    case "QUOTA_EXCEEDED":
      return t.quotaStopped;
    case "NOT_CONFIGURED":
      return t.apiNotConfigured;
    case "API_ERROR":
      return t.youtubeFailed;
    case "NO_UPLOADS":
      return t.noUploads;
    default:
      return null;
  }
}

/**
 * Stores what's new on one page of uploads, published at once (plan D10). A video already
 * stored is skipped, whatever its state, so a hidden one stays hidden. Only new IDs are fetched,
 * in one batched request, so a page with nothing new costs no metadata quota.
 */
async function storeNewVideos(channelId: string, videoIds: string[], settings: YouTubeSettings, now: Date): Promise<{ added: number; newCount: number }> {
  if (videoIds.length === 0) return { added: 0, newCount: 0 };
  const existing = await prisma.video.findMany({ where: { youtubeVideoId: { in: videoIds } }, select: { youtubeVideoId: true } });
  const known = new Set(existing.map((video) => video.youtubeVideoId));
  const newIds = videoIds.filter((id) => !known.has(id));
  if (newIds.length === 0) return { added: 0, newCount: 0 };

  const videos = await fetchVideoBatch(newIds, { includeStatistics: settings.statisticsEnabled });
  const rows = videos.map((video) => {
    const classification = classifyByDuration(video.durationSeconds, settings.maxShortSeconds, video.aspectRatio);
    return {
      ...youtubeFields(video, { includeStatistics: settings.statisticsEnabled, now }),
      youtubeVideoId: video.youtubeVideoId,
      classification,
      kind: classification === "SHORT_CANDIDATE" ? ("SHORT" as const) : ("LONG_FORM" as const),
      status: "PUBLISHED" as const,
      publishedAt: now,
      feedKey: randomInt(MAX_FEED_KEY),
      channelId,
    } satisfies Prisma.VideoCreateManyInput;
  });

  let added = 0;
  try {
    if (rows.length) added = (await prisma.video.createMany({ data: rows })).count;
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    // Stored by something else in the meantime. One by one counts only what's really new.
    for (const data of rows) {
      try {
        await prisma.video.create({ data });
        added += 1;
      } catch (rowError) {
        if (!isUniqueConstraintError(rowError)) throw rowError;
      }
    }
  }
  return { added, newCount: newIds.length };
}

async function acquireLease(channelId: string, now: Date, deadline: Date): Promise<boolean> {
  const { count } = await prisma.youTubeChannel.updateMany({
    // Never set can be null or missing, and those differ in filters.
    where: { id: channelId, OR: [{ checkLockedUntil: null }, { checkLockedUntil: { isSet: false } }, { checkLockedUntil: { lt: now } }] },
    data: { checkLockedUntil: new Date(deadline.getTime() + LEASE_MARGIN_MS) },
  });
  return count === 1;
}

/**
 * Checks one followed channel. Uploads come newest first, so new videos are found by reading
 * from the top until a page holds something already stored, usually one page and 1 quota unit.
 * Until every older upload has been read, the walk then carries on from where it last stopped,
 * saving its place after each page, so an interrupted check loses nothing.
 */
export async function checkChannel(channelId: string, { deadline, enforceQuotaCeiling }: CheckOptions): Promise<ChannelCheckResult> {
  const now = new Date();
  const channel = await prisma.youTubeChannel.findUnique({
    where: { id: channelId },
    select: { isFollowed: true, uploadsPlaylistId: true, isBackfillComplete: true, backfillPageToken: true },
  });
  if (!channel || channel.isFollowed !== true) return { added: 0, isBackfillComplete: false, stoppedBy: "NOT_FOLLOWED" };
  const wasComplete = channel.isBackfillComplete === true;
  if (!channel.uploadsPlaylistId) {
    await prisma.youTubeChannel.update({ where: { id: channelId }, data: { lastCheckedAt: now, lastCheckError: checkErrorMessage("NO_UPLOADS") } });
    return { added: 0, isBackfillComplete: wasComplete, stoppedBy: "NO_UPLOADS" };
  }
  if (!(await acquireLease(channelId, now, deadline))) return { added: 0, isBackfillComplete: wasComplete, stoppedBy: "BUSY" };

  const settings = await getYouTubeSettings();
  const uploads = channel.uploadsPlaylistId;
  let added = 0;
  let isComplete = wasComplete;
  let stoppedBy: CheckStopReason | null = null;
  let pagesRead = 0;

  // At least one page per check, so a slow first page can't leave a channel never checked.
  const mayReadPage = async (): Promise<boolean> => {
    if (pagesRead > 0 && Date.now() >= deadline.getTime()) return false;
    if (enforceQuotaCeiling && (await getQuotaUsage()).units >= settings.autoCheckQuotaCeiling) {
      stoppedBy = "QUOTA_CEILING";
      return false;
    }
    return true;
  };

  try {
    // New uploads first. While the first fetch hasn't started, it begins at the top anyway.
    if (wasComplete || channel.backfillPageToken) {
      let token: string | null = null;
      while (await mayReadPage()) {
        const page = await fetchUploadsPage(uploads, token);
        pagesRead += 1;
        const stored = await storeNewVideos(channelId, page.videoIds, settings, now);
        added += stored.added;
        if (stored.newCount < page.videoIds.length || !page.nextPageToken) break;
        token = page.nextPageToken;
      }
    }

    if (!isComplete && !stoppedBy) {
      let token = channel.backfillPageToken ?? null;
      while (await mayReadPage()) {
        const page = await fetchUploadsPage(uploads, token);
        pagesRead += 1;
        added += (await storeNewVideos(channelId, page.videoIds, settings, now)).added;
        token = page.nextPageToken;
        isComplete = !token;
        await prisma.youTubeChannel.update({ where: { id: channelId }, data: { backfillPageToken: token, isBackfillComplete: isComplete } });
        if (isComplete) break;
      }
    }
  } catch (error) {
    stoppedBy = stopReasonOf(error);
  }

  await prisma.youTubeChannel.update({
    where: { id: channelId },
    data: {
      checkLockedUntil: null,
      ...(pagesRead > 0 ? { lastCheckedAt: now } : {}),
      ...(stoppedBy === null && pagesRead > 0 ? { lastSyncedAt: now } : {}),
      lastCheckError: stoppedBy ? checkErrorMessage(stoppedBy) : null,
    },
  });
  return { added, isBackfillComplete: isComplete, stoppedBy };
}
