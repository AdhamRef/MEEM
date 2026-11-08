import type { UserRole } from "@prisma/client";
import { z } from "zod";
import { parseOptionalCursor, toCursorPage } from "@/features/content/common";
import { DEFAULT_SCORING_CONFIG } from "@/features/recommendations/scoring";
import { getScoringConfig } from "@/features/recommendations/settings.service";
import { DEFAULT_YOUTUBE_SETTINGS, getYouTubeSettings, MAX_DATA_AGE_DAYS, YOUTUBE_SETTINGS_KEY, youtubeSettingsSchema } from "@/features/youtube/settings.service";
import { AppError } from "@/lib/errors";
import { assertPermission, hasPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { isYouTubeApiConfigured } from "@/lib/youtube/client";
import { getQuotaUsage, YOUTUBE_DAILY_QUOTA } from "@/lib/youtube/quota";
import { recordAudit } from "./audit";

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const userListSchema = z.strictObject({
  query: z.string().max(120).optional(),
  role: z.enum(["USER", "CONTRIBUTOR", "SCIENTIFIC_REVIEWER", "EDITOR", "ADMIN", "SUPER_ADMIN"]).optional(),
  cursor: z.string().optional(),
});

/** Only the fields administration needs. No session or Google account data leaves here. */
export async function listUsers(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "users.view");
  const parsed = userListSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { query, role, cursor } = parsed.data;
  const validCursor = parseOptionalCursor(cursor);

  const rows = await prisma.user.findMany({
    where: {
      ...(role ? { role } : {}),
      ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }] } : {}),
    },
    orderBy: { id: "desc" },
    take: 26,
    ...(validCursor ? { cursor: { id: validCursor }, skip: 1 } : {}),
    select: { id: true, name: true, email: true, role: true, permissionGrants: true, isDeactivated: true, createdAt: true },
  });
  return toCursorPage(rows, 25);
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

const auditListSchema = z.strictObject({
  action: z.string().max(60).optional(),
  entityType: z.string().max(60).optional(),
  actor: z.string().max(120).optional(),
  cursor: z.string().optional(),
});

/** Read-only. Nothing in the application can change or remove these records. */
export async function listAuditLogs(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "audit.view");
  const parsed = auditListSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { action, entityType, actor: actorQuery, cursor } = parsed.data;
  const validCursor = parseOptionalCursor(cursor);

  const rows = await prisma.auditLog.findMany({
    where: {
      ...(action ? { action: { startsWith: action } } : {}),
      ...(entityType ? { entityType } : {}),
      ...(actorQuery ? { actorEmail: { contains: actorQuery, mode: "insensitive" } } : {}),
    },
    orderBy: { id: "desc" },
    take: 51,
    ...(validCursor ? { cursor: { id: validCursor }, skip: 1 } : {}),
  });
  return toCursorPage(rows, 50);
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface DashboardOverview {
  shorts: { total: number; published: number; draft: number };
  articles: { total: number; published: number; draft: number };
  topics: number;
  libraries: number;
  playlists: number;
  channels: number;
  recentActivity: { id: string; action: string; entityType: string; actorEmail: string | null; createdAt: Date }[] | null;
}

/** Real counts only (§19.1). Recent activity is for those allowed to read the audit log. */
export async function getDashboardOverview(actor: Actor | null): Promise<DashboardOverview> {
  assertPermission(actor, "admin.access");
  const active = { isArchived: false };
  const [shortsTotal, shortsPublished, articlesTotal, articlesPublished, topics, libraries, playlists, channels, recent] = await Promise.all([
    prisma.video.count({ where: { ...active, kind: "SHORT" } }),
    prisma.video.count({ where: { ...active, kind: "SHORT", status: "PUBLISHED" } }),
    prisma.article.count({ where: active }),
    prisma.article.count({ where: { ...active, status: "PUBLISHED" } }),
    prisma.topic.count({ where: active }),
    prisma.library.count({ where: active }),
    prisma.playlist.count({ where: active }),
    prisma.youTubeChannel.count(),
    hasPermission(actor, "audit.view") ? prisma.auditLog.findMany({ orderBy: { id: "desc" }, take: 10, select: { id: true, action: true, entityType: true, actorEmail: true, createdAt: true } }) : null,
  ]);
  return {
    shorts: { total: shortsTotal, published: shortsPublished, draft: shortsTotal - shortsPublished },
    articles: { total: articlesTotal, published: articlesPublished, draft: articlesTotal - articlesPublished },
    topics,
    libraries,
    playlists,
    channels,
    recentActivity: recent,
  };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettingsForEditing(actor: Actor | null) {
  assertPermission(actor, "settings.manage");
  const [scoring, youtube] = await Promise.all([getScoringConfig(), getYouTubeSettings()]);
  return { scoring, youtube, defaults: { scoring: DEFAULT_SCORING_CONFIG, youtube: DEFAULT_YOUTUBE_SETTINGS } };
}

const editableYouTubeSettings = youtubeSettingsSchema.omit({ statisticsEnabled: true });

/**
 * The statistics switch isn't accepted here. It stays as it is until the compliance audit
 * confirms storing them is allowed (decision D6), and turning it on takes a deliberate change.
 */
export async function updateYouTubeSettings(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "settings.manage");
  const parsed = editableYouTubeSettings.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const current = await getYouTubeSettings();
  const value = { ...parsed.data, statisticsEnabled: current.statisticsEnabled };

  await withTransaction(async (tx) => {
    await tx.applicationSetting.upsert({ where: { key: YOUTUBE_SETTINGS_KEY }, update: { value, updatedById: actor.id }, create: { key: YOUTUBE_SETTINGS_KEY, value, updatedById: actor.id } });
    await recordAudit(tx, actor, { action: "settings.update", entityType: "ApplicationSetting", entityId: YOUTUBE_SETTINGS_KEY, metadata: { value } });
  });
  return value;
}

// ---------------------------------------------------------------------------
// YouTube integration status
// ---------------------------------------------------------------------------


export interface IntegrationStatus {
  isConfigured: boolean;
  statisticsEnabled: boolean;
  quota: { unitsToday: number; exhausted: boolean; dailyLimit: number; recentDays: { day: string; units: number; exhausted: boolean }[] };
  refresh: { afterDays: number; videosDue: number; videosPastLimit: number; playlistsDue: number; channelsDue: number; lastRun: Date | null };
  sources: { followedChannels: number; fetchingChannels: number };
  cronConfigured: boolean;
}

/** All read from stored data, so opening this page spends no quota. */
export async function getIntegrationStatus(actor: Actor | null, now = new Date()): Promise<IntegrationStatus> {
  assertPermission(actor, "youtube.import");
  const settings = await getYouTubeSettings();
  const refreshBefore = new Date(now.getTime() - settings.refreshAfterDays * MS_PER_DAY);
  const limitBefore = new Date(now.getTime() - MAX_DATA_AGE_DAYS * MS_PER_DAY);

  const [quota, recentDays, videosDue, videosPastLimit, playlistsDue, channelsDue, followedChannels, fetchingChannels, lastRun] = await Promise.all([
    getQuotaUsage(now),
    prisma.apiQuotaUsage.findMany({ orderBy: { day: "desc" }, take: 7, select: { day: true, units: true, exhausted: true } }),
    prisma.video.count({ where: { metadataFetchedAt: { lt: refreshBefore } } }),
    prisma.video.count({ where: { metadataFetchedAt: { lt: limitBefore }, title: { not: "" } } }),
    prisma.playlist.count({ where: { type: "YOUTUBE", metadataFetchedAt: { lt: refreshBefore } } }),
    prisma.youTubeChannel.count({ where: { metadataFetchedAt: { lt: refreshBefore } } }),
    prisma.youTubeChannel.count({ where: { isFollowed: true } }),
    // Never set can be null or missing, and those differ in filters.
    prisma.youTubeChannel.count({ where: { isFollowed: true, OR: [{ isBackfillComplete: false }, { isBackfillComplete: null }, { isBackfillComplete: { isSet: false } }] } }),
    prisma.auditLog.findFirst({ where: { action: "youtube.refresh_metadata" }, orderBy: { id: "desc" }, select: { createdAt: true } }),
  ]);

  return {
    isConfigured: isYouTubeApiConfigured(),
    statisticsEnabled: settings.statisticsEnabled,
    quota: { unitsToday: quota.units, exhausted: quota.exhausted, dailyLimit: YOUTUBE_DAILY_QUOTA, recentDays },
    refresh: { afterDays: settings.refreshAfterDays, videosDue, videosPastLimit, playlistsDue, channelsDue, lastRun: lastRun?.createdAt ?? null },
    sources: { followedChannels, fetchingChannels },
    cronConfigured: Boolean(process.env.CRON_SECRET),
  };
}

export const STAFF_ROLE_OPTIONS: Exclude<UserRole, "SUPER_ADMIN">[] = ["USER", "CONTRIBUTOR", "SCIENTIFIC_REVIEWER", "EDITOR", "ADMIN"];
