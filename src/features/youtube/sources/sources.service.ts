import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { strings } from "@/config/strings.ar";
import { recordAudit } from "@/features/admin/audit";
import { parseId, parseOptionalCursor, toCursorPage } from "@/features/content/common";
import { importYouTubePlaylist, setPlaylistPublished } from "@/features/playlists/playlists.service";
import { AppError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { resolveChannel, type NormalizedChannel } from "@/lib/youtube/channels";
import { isYouTubeApiConfigured, YouTubeApiError } from "@/lib/youtube/client";
import { pickThumbnailUrl } from "@/lib/youtube/normalize";
import { getQuotaUsage } from "@/lib/youtube/quota";
import { syncYouTubePlaylist } from "../playlist-sync.service";
import { getYouTubeSettings } from "../settings.service";
import { importVideosByInput } from "../video-import.service";
import { checkChannel, type ChannelCheckResult, type CheckStopReason } from "./channel-check.service";
import { detectSourceInput } from "./detect";

const t = strings.sources;
const MS_PER_MINUTE = 60_000;
const PAGE_SIZE = 25;

/** A little under an hour, so an hourly schedule that runs a minute early still checks everything. */
export const CHECK_INTERVAL_MINUTES = 55;
/** Within a 60-second function limit, with room for the audit record and the response. */
const SCHEDULED_RUN_MS = 45_000;
/** One button press, or one step of the first fetch while the page is open. */
const MANUAL_STEP_MS = 20_000;
const SCHEDULED_ACTION = "sources.scheduled_check";

/** Adding a source publishes what it brings, so it takes both permissions. */
function assertCanManageSources(actor: Actor | null): asserts actor is Actor {
  assertPermission(actor, "youtube.import");
  assertPermission(actor, "content.publish");
}

function toApiError(error: unknown): AppError | null {
  if (!(error instanceof YouTubeApiError)) return null;
  if (error.reason === "NOT_CONFIGURED") return new AppError("EXTERNAL_UNAVAILABLE", t.apiNotConfigured);
  if (error.reason === "QUOTA_EXCEEDED") return new AppError("EXTERNAL_UNAVAILABLE", t.quotaStopped);
  return new AppError("EXTERNAL_UNAVAILABLE", t.youtubeFailed);
}

export type AddSourceResult =
  | { kind: "channel"; id: string; title: string; wasFollowed: boolean }
  | { kind: "playlist"; id: string; title: string; isPublished: boolean; importedVideos: number }
  | { kind: "videos"; imported: number; duplicates: number; notFound: number };

const addSchema = z.strictObject({ input: z.string().trim().min(1).max(5000) });

async function followChannel(actor: Actor, channel: NormalizedChannel): Promise<AddSourceResult> {
  const now = new Date();
  const existing = await prisma.youTubeChannel.findUnique({ where: { youtubeChannelId: channel.youtubeChannelId }, select: { isFollowed: true, followedAt: true, isBackfillComplete: true } });
  const youtubeData = {
    title: channel.title,
    description: channel.description,
    handle: channel.handle,
    thumbnailUrl: channel.thumbnailUrl,
    uploadsPlaylistId: channel.uploadsPlaylistId,
    youtubeVideoCount: channel.videoCount,
    metadataFetchedAt: now,
  };
  const follow = { isFollowed: true, isActive: true, followedAt: existing?.followedAt ?? now, isBackfillComplete: existing?.isBackfillComplete === true, lastCheckError: null };

  return withTransaction(async (tx) => {
    const stored = await tx.youTubeChannel.upsert({
      where: { youtubeChannelId: channel.youtubeChannelId },
      update: { ...youtubeData, ...follow },
      create: { youtubeChannelId: channel.youtubeChannelId, ...youtubeData, ...follow },
      select: { id: true, title: true },
    });
    await recordAudit(tx, actor, { action: "source.follow_channel", entityType: "YouTubeChannel", entityId: stored.id, metadata: { youtubeChannelId: channel.youtubeChannelId } });
    return { kind: "channel" as const, id: stored.id, title: stored.title, wasFollowed: existing?.isFollowed === true };
  });
}

/**
 * One box for everything: a channel link or handle, a playlist link, or one or more video links.
 * A channel is followed, and its videos arrive in the background. A playlist and videos are
 * fetched at once. Everything new is published (plan D10).
 */
export async function addSource(actor: Actor | null, rawInput: unknown): Promise<AddSourceResult> {
  assertCanManageSources(actor);
  const parsed = addSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION", t.invalidInput);
  const detected = detectSourceInput(parsed.data.input);

  switch (detected.kind) {
    case "invalid":
      throw new AppError("VALIDATION", t.invalidInput);
    case "legacyChannel":
      throw new AppError("VALIDATION", t.legacyChannel);
    case "channel": {
      let channel: NormalizedChannel | null;
      try {
        channel = await resolveChannel(detected.reference);
      } catch (error) {
        throw toApiError(error) ?? error;
      }
      if (!channel) throw new AppError("NOT_FOUND", t.channelNotFound);
      if (!channel.uploadsPlaylistId) throw new AppError("CONFLICT", t.noUploads);
      return followChannel(actor, channel);
    }
    case "playlist": {
      const { id } = await importYouTubePlaylist(actor, { url: detected.youtubePlaylistId });
      let isPublished = true;
      try {
        await setPlaylistPublished(actor, id, true);
      } catch (error) {
        // An empty playlist can't be published yet. It stays a draft, and the page says so.
        if (!(error instanceof AppError) || error.code !== "CONFLICT") throw error;
        isPublished = false;
      }
      const playlist = await prisma.playlist.findUniqueOrThrow({ where: { id }, select: { title: true, itemCount: true } });
      return { kind: "playlist", id, title: playlist.title, isPublished, importedVideos: playlist.itemCount };
    }
    case "videos": {
      let report;
      try {
        report = await importVideosByInput(detected.youtubeVideoIds, actor.id, { publish: true });
      } catch (error) {
        throw toApiError(error) ?? error;
      }
      await recordAudit(prisma, actor, {
        action: "source.add_videos",
        entityType: "Video",
        metadata: { imported: report.imported.length, duplicates: report.duplicates.length, notFound: report.notFound.length },
      });
      return { kind: "videos", imported: report.imported.length, duplicates: report.duplicates.length, notFound: report.notFound.length };
    }
  }
}

/** Unfollowing stops the hourly check. The channel's videos stay exactly as they are. */
export async function setChannelFollowed(actor: Actor | null, rawId: unknown, isFollowed: boolean): Promise<void> {
  assertCanManageSources(actor);
  const id = parseId(rawId);
  await withTransaction(async (tx) => {
    const channel = await tx.youTubeChannel.findUnique({ where: { id }, select: { followedAt: true, isBackfillComplete: true } });
    if (!channel) throw new AppError("NOT_FOUND");
    await tx.youTubeChannel.update({
      where: { id },
      data: isFollowed ? { isFollowed: true, isActive: true, followedAt: channel.followedAt ?? new Date(), isBackfillComplete: channel.isBackfillComplete === true } : { isFollowed: false },
    });
    await recordAudit(tx, actor, { action: isFollowed ? "source.follow_channel" : "source.unfollow_channel", entityType: "YouTubeChannel", entityId: id });
  });
}

/** "Check now", and each step of a first fetch while someone has the page open. */
export async function checkChannelNow(actor: Actor | null, rawId: unknown): Promise<ChannelCheckResult & { message: string | null }> {
  assertCanManageSources(actor);
  const id = parseId(rawId);
  if (!(await prisma.youTubeChannel.count({ where: { id } }))) throw new AppError("NOT_FOUND");

  const result = await checkChannel(id, { deadline: new Date(Date.now() + MANUAL_STEP_MS), enforceQuotaCeiling: false });
  await recordAudit(prisma, actor, { action: "source.check_channel", entityType: "YouTubeChannel", entityId: id, metadata: { ...result } });
  return { ...result, message: manualMessage(result.stoppedBy) };
}

function manualMessage(reason: CheckStopReason | null): string | null {
  if (reason === "BUSY") return t.busy;
  if (reason === "NOT_FOLLOWED") return t.notFollowed;
  if (reason === "QUOTA_CEILING" || reason === "QUOTA_EXCEEDED") return t.quotaStopped;
  if (reason === "NOT_CONFIGURED") return t.apiNotConfigured;
  if (reason === "API_ERROR") return t.youtubeFailed;
  if (reason === "NO_UPLOADS") return t.noUploads;
  return null;
}

const listSchema = z.strictObject({ query: z.string().trim().max(120).optional(), cursor: z.string().optional() });

const channelSelect = {
  id: true,
  youtubeChannelId: true,
  title: true,
  handle: true,
  thumbnailUrl: true,
  youtubeVideoCount: true,
  isFollowed: true,
  isBackfillComplete: true,
  lastCheckedAt: true,
  lastCheckError: true,
  topics: { select: { topic: { select: { title: true } } } },
} satisfies Prisma.YouTubeChannelSelect;

async function withVideoCounts<T extends { id: string }>(channels: T[]) {
  if (channels.length === 0) return [];
  const ids = channels.map((channel) => channel.id);
  const grouped = await prisma.video.groupBy({ by: ["channelId", "status"], where: { channelId: { in: ids }, isArchived: false }, _count: { _all: true } });
  return channels.map((channel) => {
    const counts = grouped.filter((row) => row.channelId === channel.id);
    const count = (status: "PUBLISHED" | "DRAFT") => counts.find((row) => row.status === status)?._count._all ?? 0;
    return { ...channel, publishedCount: count("PUBLISHED"), hiddenCount: count("DRAFT") };
  });
}

export async function listFollowedChannels(actor: Actor | null, rawInput: unknown = {}) {
  assertPermission(actor, "youtube.import");
  const parsed = listSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { query, cursor } = parsed.data;
  const validCursor = parseOptionalCursor(cursor);

  const rows = await prisma.youTubeChannel.findMany({
    where: { isFollowed: true, ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { handle: { contains: query, mode: "insensitive" } }] } : {}) },
    orderBy: { id: "desc" },
    take: PAGE_SIZE + 1,
    ...(validCursor ? { cursor: { id: validCursor }, skip: 1 } : {}),
    select: channelSelect,
  });
  const page = toCursorPage(rows, PAGE_SIZE);
  return { ...page, items: await withVideoCounts(page.items) };
}

/** Channels stored without being followed, for example a single video's. They can be followed from here. */
export async function listUnfollowedChannels(actor: Actor | null) {
  assertPermission(actor, "youtube.import");
  const rows = await prisma.youTubeChannel.findMany({
    where: { OR: [{ isFollowed: false }, { isFollowed: null }, { isFollowed: { isSet: false } }], title: { not: "" } },
    orderBy: { id: "desc" },
    take: 50,
    select: channelSelect,
  });
  return withVideoCounts(rows);
}

export async function getSourceChannel(actor: Actor | null, rawId: unknown) {
  assertPermission(actor, "youtube.import");
  const channel = await prisma.youTubeChannel.findUnique({ where: { id: parseId(rawId) }, select: channelSelect });
  if (!channel) throw new AppError("NOT_FOUND");
  const [withCounts] = await withVideoCounts([channel]);
  return withCounts!;
}

export async function listSourcePlaylists(actor: Actor | null, rawInput: unknown = {}) {
  assertPermission(actor, "youtube.import");
  const parsed = listSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const validCursor = parseOptionalCursor(parsed.data.cursor);
  const rows = await prisma.playlist.findMany({
    where: { type: "YOUTUBE", isArchived: false },
    orderBy: { id: "desc" },
    take: PAGE_SIZE + 1,
    ...(validCursor ? { cursor: { id: validCursor }, skip: 1 } : {}),
    select: { id: true, title: true, slug: true, channelTitle: true, itemCount: true, status: true, syncStatus: true, metadataFetchedAt: true, thumbnails: true },
  });
  const page = toCursorPage(rows, PAGE_SIZE);
  return { ...page, items: page.items.map(({ thumbnails, ...row }) => ({ ...row, thumbnailUrl: pickThumbnailUrl(thumbnails) })) };
}

export interface SourcesOverview {
  isConfigured: boolean;
  autoCheckEnabled: boolean;
  isScheduleConfigured: boolean;
  followedChannels: number;
  fetchingChannels: number;
  playlists: number;
  lastScheduledRun: Date | null;
  quotaUnitsToday: number;
  quotaCeiling: number;
}

/** Read from stored data, so opening the page spends no quota. */
export async function getSourcesOverview(actor: Actor | null): Promise<SourcesOverview> {
  assertPermission(actor, "youtube.import");
  const [settings, quota, followedChannels, fetchingChannels, playlists, lastRun] = await Promise.all([
    getYouTubeSettings(),
    getQuotaUsage(),
    prisma.youTubeChannel.count({ where: { isFollowed: true } }),
    prisma.youTubeChannel.count({ where: { isFollowed: true, OR: [{ isBackfillComplete: false }, { isBackfillComplete: null }, { isBackfillComplete: { isSet: false } }] } }),
    prisma.playlist.count({ where: { type: "YOUTUBE", isArchived: false } }),
    prisma.auditLog.findFirst({ where: { action: SCHEDULED_ACTION }, orderBy: { id: "desc" }, select: { createdAt: true } }),
  ]);
  return {
    isConfigured: isYouTubeApiConfigured(),
    autoCheckEnabled: settings.autoCheckEnabled,
    isScheduleConfigured: Boolean(process.env.CRON_SECRET),
    followedChannels,
    fetchingChannels,
    playlists,
    lastScheduledRun: lastRun?.createdAt ?? null,
    quotaUnitsToday: quota.units,
    quotaCeiling: settings.autoCheckQuotaCeiling,
  };
}

export interface ScheduledCheckReport {
  skipped: "DISABLED" | "NOT_CONFIGURED" | null;
  channelsChecked: number;
  videosAdded: number;
  playlistsSynced: number;
  playlistVideosAdded: number;
  /** Due but left for the next run, because time or the quota ceiling ran out. */
  channelsLeft: number;
  stoppedBy: CheckStopReason | null;
}

/**
 * The hourly job (plan D10). Followed channels that are due, oldest check first, then YouTube
 * playlists. It stops at a time budget and at the daily quota ceiling, and whatever is left
 * waits for the next run, so its cadence and its quota use stay bounded (§7.4).
 */
export async function runScheduledSourceCheck(now = new Date()): Promise<ScheduledCheckReport> {
  const report: ScheduledCheckReport = { skipped: null, channelsChecked: 0, videosAdded: 0, playlistsSynced: 0, playlistVideosAdded: 0, channelsLeft: 0, stoppedBy: null };
  const settings = await getYouTubeSettings();
  if (!settings.autoCheckEnabled) report.skipped = "DISABLED";
  else if (!isYouTubeApiConfigured()) report.skipped = "NOT_CONFIGURED";

  if (!report.skipped) {
    const deadline = new Date(now.getTime() + SCHEDULED_RUN_MS);
    const dueBefore = new Date(now.getTime() - CHECK_INTERVAL_MINUTES * MS_PER_MINUTE);
    const due = await prisma.youTubeChannel.findMany({
      where: {
        isFollowed: true,
        // Not checked lately, or still on its first fetch. Never set can be null or missing.
        OR: [{ lastCheckedAt: { lt: dueBefore } }, { lastCheckedAt: null }, { lastCheckedAt: { isSet: false } }, { isBackfillComplete: false }, { isBackfillComplete: null }, { isBackfillComplete: { isSet: false } }],
      },
      orderBy: { lastCheckedAt: "asc" },
      take: 200,
      select: { id: true },
    });

    const isOutOfTime = () => Date.now() >= deadline.getTime();
    const isFatal = (reason: CheckStopReason | null) => reason === "QUOTA_CEILING" || reason === "QUOTA_EXCEEDED" || reason === "NOT_CONFIGURED";

    for (const [index, { id }] of due.entries()) {
      if (isOutOfTime() || isFatal(report.stoppedBy)) {
        report.channelsLeft = due.length - index;
        break;
      }
      const result = await checkChannel(id, { deadline, enforceQuotaCeiling: true });
      if (result.stoppedBy === "BUSY") continue;
      report.channelsChecked += 1;
      report.videosAdded += result.added;
      if (result.stoppedBy && result.stoppedBy !== "NO_UPLOADS") report.stoppedBy = result.stoppedBy;
    }

    if (!isOutOfTime() && !isFatal(report.stoppedBy)) {
      const playlists = await prisma.playlist.findMany({
        where: { type: "YOUTUBE", isArchived: false, OR: [{ metadataFetchedAt: { lt: dueBefore } }, { metadataFetchedAt: null }, { metadataFetchedAt: { isSet: false } }] },
        orderBy: { metadataFetchedAt: "asc" },
        take: 50,
        select: { id: true },
      });
      for (const { id } of playlists) {
        if (isOutOfTime()) break;
        if ((await getQuotaUsage()).units >= settings.autoCheckQuotaCeiling) {
          report.stoppedBy = "QUOTA_CEILING";
          break;
        }
        try {
          const sync = await syncYouTubePlaylist(id, undefined);
          report.playlistsSynced += 1;
          report.playlistVideosAdded += sync.importedVideos;
        } catch (error) {
          if (!(error instanceof YouTubeApiError)) throw error;
          report.stoppedBy = error.reason === "QUOTA_EXCEEDED" ? "QUOTA_EXCEEDED" : error.reason === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "API_ERROR";
          if (isFatal(report.stoppedBy)) break;
        }
      }
    }
  }

  // A scheduler has no account, so its audit record names it as the system.
  await prisma.auditLog.create({ data: { actorEmail: "system:cron", action: SCHEDULED_ACTION, entityType: "YouTubeChannel", metadata: { ...report } } });
  return report;
}
