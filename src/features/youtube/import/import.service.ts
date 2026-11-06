import { randomInt } from "node:crypto";
import type { ImportJobStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { strings } from "@/config/strings.ar";
import { recordAudit } from "@/features/admin/audit";
import { objectIdSchema } from "@/features/categories/schemas";
import { idListSchema, parseId, parseOptionalCursor, toCursorPage } from "@/features/content/common";
import { AppError, isUniqueConstraintError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { buildSearchText, normalizeArabicForSearch } from "@/lib/search/normalize";
import { fetchUploadsPage, parseChannelInput, resolveChannel, type NormalizedChannel } from "@/lib/youtube/channels";
import { YouTubeApiError } from "@/lib/youtube/client";
import { classifyByDuration } from "@/lib/youtube/normalize";
import { getQuotaUsage } from "@/lib/youtube/quota";
import { fetchVideoBatch } from "@/lib/youtube/videos";
import { getYouTubeSettings, MAX_DATA_AGE_DAYS } from "../settings.service";

const MS_PER_DAY = 86_400_000;
const CANDIDATE_PAGE_SIZE = 50;
const DESCRIPTION_PREVIEW_LENGTH = 220;
const IMPORT_BATCH_SIZE = 25;
const MAX_ERRORS_KEPT = 50;
const MAX_FEED_KEY = 2 ** 31 - 1;

/** A day inside YouTube's 30-day limit, so a preview can never outlive it, and the TTL index removes it. */
const candidateExpiry = (now: Date) => new Date(now.getTime() + (MAX_DATA_AGE_DAYS - 1) * MS_PER_DAY);

const toApiError = (error: unknown): AppError | null => {
  if (!(error instanceof YouTubeApiError)) return null;
  if (error.reason === "NOT_CONFIGURED") return new AppError("EXTERNAL_UNAVAILABLE", strings.importer.apiNotConfigured);
  if (error.reason === "QUOTA_EXCEEDED") return new AppError("EXTERNAL_UNAVAILABLE", strings.importer.quotaExhausted);
  return new AppError("EXTERNAL_UNAVAILABLE", strings.importer.youtubeFailed);
};

async function saveChannel(channel: NormalizedChannel, now: Date) {
  const data = {
    title: channel.title,
    description: channel.description,
    handle: channel.handle,
    thumbnailUrl: channel.thumbnailUrl,
    uploadsPlaylistId: channel.uploadsPlaylistId,
    metadataFetchedAt: now,
  };
  return prisma.youTubeChannel.upsert({ where: { youtubeChannelId: channel.youtubeChannelId }, update: data, create: { youtubeChannelId: channel.youtubeChannelId, ...data } });
}

const startSchema = z.strictObject({ input: z.string().trim().min(1).max(300) });

/** Steps 1 to 3: reads the channel and creates a job, which the browser then advances page by page. */
export async function startChannelImport(actor: Actor | null, rawInput: unknown): Promise<{ jobId: string }> {
  assertPermission(actor, "youtube.import");
  const parsed = startSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");

  const reference = parseChannelInput(parsed.data.input);
  if (!reference) throw new AppError("VALIDATION", strings.importer.invalidChannel);
  if (reference.kind === "legacy") throw new AppError("VALIDATION", strings.importer.legacyChannel);

  let channel: NormalizedChannel | null;
  try {
    channel = await resolveChannel(reference);
  } catch (error) {
    throw toApiError(error) ?? error;
  }
  if (!channel) throw new AppError("NOT_FOUND", strings.importer.channelNotFound);
  if (!channel.uploadsPlaylistId) throw new AppError("CONFLICT", strings.importer.noUploads);

  const stored = await saveChannel(channel, new Date());
  const unfinished = await findUnfinishedJob(stored.id);
  if (unfinished) return { jobId: unfinished.id };

  const job = await createJob(actor, stored.id, "IMPORT");
  return { jobId: job.id };
}

/** A second job would fetch the same videos and spend quota twice, so the first one continues instead. */
function findUnfinishedJob(channelId: string) {
  return prisma.importJob.findFirst({ where: { channelId, status: { in: ["DISCOVERING", "IMPORTING", "PAUSED"] } }, orderBy: { createdAt: "asc" }, select: { id: true } });
}

async function createJob(actor: Actor, channelId: string, type: "IMPORT" | "SYNC") {
  return withTransaction(async (tx) => {
    const job = await tx.importJob.create({ data: { type, status: "DISCOVERING", channelId, createdById: actor.id } });
    await recordAudit(tx, actor, { action: type === "IMPORT" ? "import.start" : "channel.sync_start", entityType: "ImportJob", entityId: job.id, metadata: { channelId } });
    return job;
  });
}

/** Sync finds what's new without importing anything again (§7.4). It runs only when someone asks. */
export async function startChannelSync(actor: Actor | null, rawChannelId: unknown): Promise<{ jobId: string }> {
  assertPermission(actor, "youtube.import");
  const channelId = parseId(rawChannelId);
  const stored = await prisma.youTubeChannel.findUnique({ where: { id: channelId }, select: { youtubeChannelId: true } });
  if (!stored) throw new AppError("NOT_FOUND");

  const unfinished = await findUnfinishedJob(channelId);
  if (unfinished) return { jobId: unfinished.id };

  try {
    // Read again, because the stored uploads list counts as YouTube data with the 30-day limit.
    const channel = await resolveChannel({ kind: "id", value: stored.youtubeChannelId });
    if (!channel) throw new AppError("NOT_FOUND", strings.importer.channelNotFound);
    if (!channel.uploadsPlaylistId) throw new AppError("CONFLICT", strings.importer.noUploads);
    await saveChannel(channel, new Date());
  } catch (error) {
    throw toApiError(error) ?? error;
  }

  const job = await createJob(actor, channelId, "SYNC");
  return { jobId: job.id };
}

async function recordJobError(jobId: string, stage: string, message: string): Promise<void> {
  const job = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId }, select: { errors: true } });
  const errors = [...job.errors, { stage, message, occurredAt: new Date() }].slice(-MAX_ERRORS_KEPT);
  await prisma.importJob.update({ where: { id: jobId }, data: { errors } });
}

export interface JobProgress {
  status: ImportJobStatus;
  discoveredCount: number;
  importedCount: number;
  duplicateCount: number;
  skippedCount: number;
  failedCount: number;
  /** Set when the job stopped by itself, with what to do about it. */
  message: string | null;
}

const progressSelect = { status: true, discoveredCount: true, importedCount: true, duplicateCount: true, skippedCount: true, failedCount: true } as const;

async function finishCancelled(jobId: string): Promise<JobProgress> {
  const job = await prisma.importJob.update({ where: { id: jobId }, data: { status: "CANCELLED", completedAt: new Date() }, select: progressSelect });
  return { ...job, message: null };
}

/**
 * Someone may cancel or delete a job while a step is working on it. Only a job that's still
 * running moves on, so the step can't bring it back, and its answer reports the real state.
 */
async function updateRunningJob(jobId: string, running: "DISCOVERING" | "IMPORTING", data: Prisma.ImportJobUpdateManyMutationInput): Promise<JobProgress> {
  await prisma.importJob.updateMany({ where: { id: jobId, status: running }, data });
  const job = await prisma.importJob.findUnique({ where: { id: jobId }, select: progressSelect });
  if (!job) throw new AppError("NOT_FOUND");
  return { ...job, message: null };
}

async function pauseFor(jobId: string, error: unknown): Promise<JobProgress> {
  const mapped = toApiError(error);
  if (!mapped) throw error;
  const current = await prisma.importJob.findUnique({ where: { id: jobId }, select: { id: true } });
  if (!current) throw new AppError("NOT_FOUND");
  await recordJobError(jobId, "youtube", mapped.publicMessage);
  const job = await updateRunningJob(jobId, "DISCOVERING", { status: "PAUSED" });
  return { ...job, message: job.status === "PAUSED" ? mapped.publicMessage : null };
}

/**
 * Steps 4 to 6: one page of uploads and its metadata, so a page close loses nothing. The page
 * token is saved after each step, which is what makes resuming possible with no queue.
 */
export async function runDiscoveryStep(actor: Actor | null, rawJobId: unknown): Promise<JobProgress> {
  assertPermission(actor, "youtube.import");
  const jobId = parseId(rawJobId);
  const job = await prisma.importJob.findUnique({ where: { id: jobId }, include: { channel: { select: { uploadsPlaylistId: true, title: true } } } });
  if (!job) throw new AppError("NOT_FOUND");
  if (job.cancelRequestedAt) return finishCancelled(jobId);
  // A step that set off before someone pressed pause must not undo it. Only resuming does that.
  if (job.status === "PAUSED") return { ...(await prisma.importJob.findUniqueOrThrow({ where: { id: jobId }, select: progressSelect })), message: null };
  if (job.status !== "DISCOVERING") throw new AppError("CONFLICT");
  if (!job.channel.uploadsPlaylistId) throw new AppError("CONFLICT", strings.importer.noUploads);

  try {
    const page = await fetchUploadsPage(job.channel.uploadsPlaylistId, job.nextPageToken);
    const settings = await getYouTubeSettings();
    const now = new Date();

    const existing = await prisma.video.findMany({ where: { youtubeVideoId: { in: page.videoIds } }, select: { youtubeVideoId: true } });
    const imported = new Set(existing.map((video) => video.youtubeVideoId));
    // A sync reviews only what's new, and doesn't spend quota on the rest.
    const toFetch = job.type === "SYNC" ? page.videoIds.filter((id) => !imported.has(id)) : page.videoIds;
    const alreadySeen = await prisma.importCandidate.findMany({ where: { jobId, youtubeVideoId: { in: toFetch } }, select: { youtubeVideoId: true } });
    const seen = new Set(alreadySeen.map((candidate) => candidate.youtubeVideoId));

    // One request for the whole page, never one per video (§7.3).
    const videos = await fetchVideoBatch(
      toFetch.filter((id) => !seen.has(id)),
      // The same request either way, so this costs no extra quota.
      { includeStatistics: settings.statisticsEnabled },
    );

    const rows = videos.map((video) => ({
      jobId,
      youtubeVideoId: video.youtubeVideoId,
      title: video.title,
      channelTitle: video.channelTitle ?? job.channel.title,
      description: video.description,
      tags: video.tags,
      thumbnails: video.thumbnails,
      durationSeconds: video.durationSeconds,
      ytPublishedAt: video.ytPublishedAt,
      isEmbeddable: video.availability === "AVAILABLE",
      aspectRatio: video.aspectRatio,
      stats: settings.statisticsEnabled && video.statistics ? { ...video.statistics, fetchedAt: now } : null,
      classification: classifyByDuration(video.durationSeconds, settings.maxShortSeconds, video.aspectRatio),
      alreadyImported: imported.has(video.youtubeVideoId),
      expiresAt: candidateExpiry(now),
    }));

    // All at once, because writing a page one video at a time took most of each step.
    let added = 0;
    try {
      if (rows.length) added = (await prisma.importCandidate.createMany({ data: rows })).count;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      // Two steps raced on one page. Going one by one counts only what's really new, and the
      // unique index keeps each video to one.
      for (const data of rows) {
        try {
          await prisma.importCandidate.create({ data });
          added += 1;
        } catch (rowError) {
          if (!isUniqueConstraintError(rowError)) throw rowError;
        }
      }
    }

    // Uploads run newest first, so a sync can stop at the first page holding nothing new.
    const isSyncCaughtUp = job.type === "SYNC" && page.videoIds.length > 0 && toFetch.length === 0;
    const isDone = !page.nextPageToken || isSyncCaughtUp;

    const updated = await updateRunningJob(jobId, "DISCOVERING", { discoveredCount: { increment: added }, nextPageToken: isDone ? null : page.nextPageToken, status: isDone ? "READY_FOR_REVIEW" : "DISCOVERING" });
    if (updated.status === "READY_FOR_REVIEW" && isDone && job.type === "SYNC") await prisma.youTubeChannel.update({ where: { id: job.channelId }, data: { lastSyncedAt: now } });
    return updated;
  } catch (error) {
    return pauseFor(jobId, error);
  }
}

const filterSchema = z.strictObject({
  classification: z.enum(["SHORT_CANDIDATE", "LONG_FORM_CANDIDATE"]).optional(),
  imported: z.boolean().optional(),
  selected: z.boolean().optional(),
});

function candidateWhere(jobId: string, filter: z.infer<typeof filterSchema>): Prisma.ImportCandidateWhereInput {
  return {
    jobId,
    ...(filter.classification ? { classification: filter.classification } : {}),
    ...(filter.imported === undefined ? {} : { alreadyImported: filter.imported }),
    ...(filter.selected === undefined ? {} : { isSelected: filter.selected }),
  };
}

const listSchema = z.strictObject({ jobId: objectIdSchema, filter: filterSchema.default({}), cursor: z.string().optional() });

/** Step 7. Filters are the six in §7.2. */
export async function listCandidates(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "youtube.import");
  const parsed = listSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { jobId, filter, cursor } = parsed.data;
  const validCursor = parseOptionalCursor(cursor);

  const rows = await prisma.importCandidate.findMany({
    where: candidateWhere(jobId, filter),
    orderBy: { id: "asc" },
    take: CANDIDATE_PAGE_SIZE + 1,
    ...(validCursor ? { cursor: { id: validCursor }, skip: 1 } : {}),
    select: {
      id: true,
      youtubeVideoId: true,
      title: true,
      channelTitle: true,
      description: true,
      thumbnails: true,
      durationSeconds: true,
      ytPublishedAt: true,
      classification: true,
      alreadyImported: true,
      isEmbeddable: true,
      isSelected: true,
      result: true,
      resultMessage: true,
      assignment: { select: { kind: true, categoryId: true } },
    },
  });
  const [matching, selected] = await Promise.all([prisma.importCandidate.count({ where: candidateWhere(jobId, filter) }), prisma.importCandidate.count({ where: { jobId, isSelected: true } })]);
  const page = toCursorPage(rows, CANDIDATE_PAGE_SIZE);
  // Cards show a line or two, and a description can run to pages.
  const items = page.items.map((row) => ({ ...row, description: row.description?.slice(0, DESCRIPTION_PREVIEW_LENGTH) ?? null }));
  return { ...page, items, matching, selected };
}

const selectSchema = z.strictObject({
  jobId: objectIdSchema,
  isSelected: z.boolean(),
  candidateIds: z.array(objectIdSchema).max(CANDIDATE_PAGE_SIZE).optional(),
  /** Applies to everything the filter matches, across every page. */
  filter: filterSchema.optional(),
});

async function loadReviewableJob(jobId: string) {
  const job = await prisma.importJob.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!job) throw new AppError("NOT_FOUND");
  if (job.status !== "READY_FOR_REVIEW" && job.status !== "DISCOVERING" && job.status !== "PAUSED") throw new AppError("CONFLICT");
}

/** Step 8. Videos already imported, or that can't be embedded, can't be selected. */
export async function setCandidatesSelected(actor: Actor | null, rawInput: unknown): Promise<{ changed: number }> {
  assertPermission(actor, "youtube.import");
  const parsed = selectSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { jobId, isSelected, candidateIds, filter } = parsed.data;
  if (!candidateIds && !filter) throw new AppError("VALIDATION");
  await loadReviewableJob(jobId);

  const scope = candidateIds ? { jobId, id: { in: candidateIds } } : candidateWhere(jobId, filter!);
  const { count } = await prisma.importCandidate.updateMany({ where: { ...scope, ...(isSelected ? { alreadyImported: false, isEmbeddable: true } : {}) }, data: { isSelected } });
  return { changed: count };
}

const assignSchema = z.strictObject({
  jobId: objectIdSchema,
  kind: z.enum(["SHORT", "LONG_FORM"]).nullable().optional(),
  categoryId: objectIdSchema.nullable().optional(),
  topicIds: idListSchema,
  libraryIds: idListSchema,
  playlistIds: idListSchema,
});

/** Steps 9 and 10, for everything selected. Choosing a kind here is the human review detection can't replace (§7.2). */
export async function assignSelectedCandidates(actor: Actor | null, rawInput: unknown): Promise<{ changed: number }> {
  assertPermission(actor, "youtube.import");
  const parsed = assignSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { jobId, kind, categoryId, topicIds, libraryIds, playlistIds } = parsed.data;
  await loadReviewableJob(jobId);

  if (categoryId && !(await prisma.category.count({ where: { id: categoryId } }))) throw new AppError("VALIDATION");
  if ((await prisma.topic.count({ where: { id: { in: topicIds } } })) !== new Set(topicIds).size) throw new AppError("VALIDATION");
  if ((await prisma.library.count({ where: { id: { in: libraryIds } } })) !== new Set(libraryIds).size) throw new AppError("VALIDATION");
  // Only curated playlists take items, because YouTube's come from YouTube.
  if ((await prisma.playlist.count({ where: { id: { in: playlistIds }, type: "CURATED" } })) !== new Set(playlistIds).size) throw new AppError("VALIDATION");

  const { count } = await prisma.importCandidate.updateMany({
    where: { jobId, isSelected: true },
    data: { assignment: { set: { kind: kind ?? null, categoryId: categoryId ?? null, topicIds, libraryIds, playlistIds } } },
  });
  return { changed: count };
}

async function importCandidate(candidate: Prisma.ImportCandidateGetPayload<object>, job: { channelId: string; createdById: string | null }): Promise<"IMPORTED" | "DUPLICATE"> {
  const assignment = candidate.assignment;
  const kind = assignment?.kind ?? (candidate.classification === "SHORT_CANDIDATE" ? "SHORT" : "LONG_FORM");
  const topicIds = [...new Set(assignment?.topicIds ?? [])];
  const libraryIds = [...new Set(assignment?.libraryIds ?? [])];

  try {
    await withTransaction(async (tx) => {
      // Always a draft, so nothing reaches readers because of detection (§7.2).
      const video = await tx.video.create({
        data: {
          youtubeVideoId: candidate.youtubeVideoId,
          kind,
          classification: candidate.classification,
          reviewedAt: assignment?.kind ? new Date() : null,
          status: "DRAFT",
          channelId: job.channelId,
          categoryId: assignment?.categoryId ?? null,
          title: candidate.title,
          description: candidate.description,
          channelTitle: candidate.channelTitle,
          thumbnails: candidate.thumbnails,
          durationSeconds: candidate.durationSeconds,
          aspectRatio: candidate.aspectRatio,
          stats: candidate.stats,
          tags: candidate.tags,
          ytPublishedAt: candidate.ytPublishedAt,
          availability: "AVAILABLE",
          // When YouTube's data was fetched, not now, so the 30-day clock stays honest.
          metadataFetchedAt: candidate.createdAt,
          topicIds,
          libraryIds,
          feedKey: randomInt(MAX_FEED_KEY),
          titleSearch: normalizeArabicForSearch(candidate.title),
          searchText: buildSearchText([candidate.title, candidate.description, candidate.channelTitle, ...candidate.tags]),
          createdById: job.createdById,
        },
      });
      if (topicIds.length) await tx.videoTopic.createMany({ data: topicIds.map((topicId) => ({ videoId: video.id, topicId })) });
      if (libraryIds.length) await tx.videoLibrary.createMany({ data: libraryIds.map((libraryId) => ({ videoId: video.id, libraryId })) });
      for (const playlistId of new Set(assignment?.playlistIds ?? [])) {
        const last = await tx.playlistItem.findFirst({ where: { playlistId }, orderBy: { position: "desc" }, select: { position: true } });
        await tx.playlistItem.create({ data: { playlistId, videoId: video.id, position: (last?.position ?? -1) + 1 } });
        await tx.playlist.update({ where: { id: playlistId }, data: { itemCount: { increment: 1 } } });
      }
    });
    return "IMPORTED";
  } catch (error) {
    // Imported by someone else since the preview: the video exists once, which is what matters.
    if (isUniqueConstraintError(error)) return "DUPLICATE";
    throw error;
  }
}

/** Steps 11 and 12: a small batch per call, so progress shows, and cancelling or closing the page is safe. */
export async function runImportStep(actor: Actor | null, rawJobId: unknown): Promise<JobProgress> {
  assertPermission(actor, "youtube.import");
  const jobId = parseId(rawJobId);
  const job = await prisma.importJob.findUnique({ where: { id: jobId }, select: { status: true, channelId: true, createdById: true, cancelRequestedAt: true } });
  if (!job) throw new AppError("NOT_FOUND");
  if (job.cancelRequestedAt) return finishCancelled(jobId);
  if (job.status !== "READY_FOR_REVIEW" && job.status !== "IMPORTING") throw new AppError("CONFLICT");

  const batch = await prisma.importCandidate.findMany({ where: { jobId, isSelected: true, result: "PENDING" }, take: IMPORT_BATCH_SIZE, orderBy: { id: "asc" } });

  if (batch.length === 0) {
    const skipped = await prisma.importCandidate.updateMany({ where: { jobId, isSelected: false, result: "PENDING" }, data: { result: "SKIPPED" } });
    const updated = await withTransaction(async (tx) => {
      const completed = await tx.importJob.update({ where: { id: jobId }, data: { status: "COMPLETED", completedAt: new Date(), skippedCount: { increment: skipped.count } }, select: progressSelect });
      await recordAudit(tx, actor, {
        action: "import.complete",
        entityType: "ImportJob",
        entityId: jobId,
        metadata: { imported: completed.importedCount, duplicates: completed.duplicateCount, skipped: completed.skippedCount, failed: completed.failedCount },
      });
      return completed;
    });
    return { ...updated, message: null };
  }

  await prisma.importJob.updateMany({ where: { id: jobId, status: { in: ["READY_FOR_REVIEW", "IMPORTING"] } }, data: { status: "IMPORTING" } });
  const counts = { importedCount: 0, duplicateCount: 0, failedCount: 0 };

  for (const candidate of batch) {
    try {
      const outcome = await importCandidate(candidate, job);
      if (outcome === "IMPORTED") counts.importedCount += 1;
      else counts.duplicateCount += 1;
      await prisma.importCandidate.update({ where: { id: candidate.id }, data: { result: outcome } });
    } catch {
      // One bad item shouldn't stop the rest. The reason is safe, and the item is reported.
      counts.failedCount += 1;
      await prisma.importCandidate.update({ where: { id: candidate.id }, data: { result: "FAILED", resultMessage: strings.importer.itemFailed } });
    }
  }

  return updateRunningJob(jobId, "IMPORTING", { importedCount: { increment: counts.importedCount }, duplicateCount: { increment: counts.duplicateCount }, failedCount: { increment: counts.failedCount } });
}

/**
 * Takes effect at once, whether or not any page is working on the job, because waiting for a
 * next step meant a job nobody had open never stopped. A step already under way can't undo
 * this, since steps only move jobs that are still running. What's imported stays, as drafts.
 */
export async function cancelImportJob(actor: Actor | null, rawJobId: unknown): Promise<void> {
  assertPermission(actor, "youtube.import");
  const jobId = parseId(rawJobId);
  await withTransaction(async (tx) => {
    const job = await tx.importJob.findUnique({ where: { id: jobId }, select: { status: true } });
    if (!job) throw new AppError("NOT_FOUND");
    if (job.status === "COMPLETED" || job.status === "CANCELLED") throw new AppError("CONFLICT");
    const now = new Date();
    await tx.importJob.update({ where: { id: jobId }, data: { status: "CANCELLED", cancelRequestedAt: now, completedAt: now } });
    await recordAudit(tx, actor, { action: "import.cancel", entityType: "ImportJob", entityId: jobId });
  });
}

/**
 * Stops work on a job until someone resumes it, keeping its place. A job that's importing goes
 * back to review, because what hasn't been imported yet is still selected and waiting there.
 */
export async function pauseImportJob(actor: Actor | null, rawJobId: unknown): Promise<void> {
  assertPermission(actor, "youtube.import");
  const jobId = parseId(rawJobId);
  await withTransaction(async (tx) => {
    const job = await tx.importJob.findUnique({ where: { id: jobId }, select: { status: true } });
    if (!job) throw new AppError("NOT_FOUND");
    if (job.status !== "DISCOVERING" && job.status !== "IMPORTING") throw new AppError("CONFLICT");
    await tx.importJob.update({ where: { id: jobId }, data: { status: job.status === "IMPORTING" ? "READY_FOR_REVIEW" : "PAUSED" } });
    await recordAudit(tx, actor, { action: "import.pause", entityType: "ImportJob", entityId: jobId });
  });
}

/**
 * Puts a paused or cancelled job back to work. It continues from its saved page. A job cancelled
 * with no saved page goes through the channel's list again, but videos it already fetched aren't
 * fetched twice, so that costs only a little quota, and anything new is picked up too.
 */
export async function resumeImportJob(actor: Actor | null, rawJobId: unknown): Promise<JobProgress> {
  assertPermission(actor, "youtube.import");
  const jobId = parseId(rawJobId);
  return withTransaction(async (tx) => {
    const job = await tx.importJob.findUnique({ where: { id: jobId }, select: { status: true } });
    if (!job) throw new AppError("NOT_FOUND");
    if (job.status !== "PAUSED" && job.status !== "CANCELLED") throw new AppError("CONFLICT");
    const updated = await tx.importJob.update({ where: { id: jobId }, data: { status: "DISCOVERING", cancelRequestedAt: null, completedAt: null }, select: progressSelect });
    await recordAudit(tx, actor, { action: "import.resume", entityType: "ImportJob", entityId: jobId, metadata: { from: job.status } });
    return { ...updated, message: null };
  });
}

/**
 * Removes the job and its preview list, whatever state it's in. Videos it already imported are
 * ordinary drafts by now, and stay. The audit log keeps a record of what was removed.
 */
export async function deleteImportJob(actor: Actor | null, rawJobId: unknown): Promise<void> {
  assertPermission(actor, "youtube.import");
  const jobId = parseId(rawJobId);
  await withTransaction(async (tx) => {
    const job = await tx.importJob.findUnique({ where: { id: jobId }, select: { type: true, status: true, discoveredCount: true, importedCount: true, channel: { select: { title: true } } } });
    if (!job) throw new AppError("NOT_FOUND");
    await tx.importCandidate.deleteMany({ where: { jobId } });
    await tx.importJob.delete({ where: { id: jobId } });
    await recordAudit(tx, actor, {
      action: "import.delete",
      entityType: "ImportJob",
      entityId: jobId,
      metadata: { type: job.type, status: job.status, channel: job.channel.title, discovered: job.discoveredCount, imported: job.importedCount },
    });
  });
}

export async function getImportJob(actor: Actor | null, rawJobId: unknown) {
  assertPermission(actor, "youtube.import");
  const job = await prisma.importJob.findUnique({
    where: { id: parseId(rawJobId) },
    select: { id: true, type: true, ...progressSelect, errors: true, createdAt: true, completedAt: true, cancelRequestedAt: true, channel: { select: { id: true, title: true, handle: true, thumbnailUrl: true, youtubeChannelId: true } } },
  });
  if (!job) throw new AppError("NOT_FOUND");
  return job;
}

export interface JobSummary {
  total: number;
  shorts: number;
  longs: number;
  alreadyImported: number;
  notEmbeddable: number;
  selected: number;
  totalSeconds: number;
  oldest: string | null;
  newest: string | null;
}

/** Facts about what was fetched, all from stored data, so it costs no quota. */
export async function getJobSummary(actor: Actor | null, rawJobId: unknown): Promise<JobSummary> {
  assertPermission(actor, "youtube.import");
  const jobId = parseId(rawJobId);
  const where = { jobId };
  const [shorts, longs, alreadyImported, notEmbeddable, selected, totals] = await Promise.all([
    prisma.importCandidate.count({ where: { ...where, classification: "SHORT_CANDIDATE" } }),
    prisma.importCandidate.count({ where: { ...where, classification: "LONG_FORM_CANDIDATE" } }),
    prisma.importCandidate.count({ where: { ...where, alreadyImported: true } }),
    prisma.importCandidate.count({ where: { ...where, isEmbeddable: false } }),
    prisma.importCandidate.count({ where: { ...where, isSelected: true } }),
    prisma.importCandidate.aggregate({ where, _count: { _all: true }, _sum: { durationSeconds: true }, _min: { ytPublishedAt: true }, _max: { ytPublishedAt: true } }),
  ]);
  return {
    total: totals._count._all,
    shorts,
    longs,
    alreadyImported,
    notEmbeddable,
    selected,
    totalSeconds: totals._sum.durationSeconds ?? 0,
    oldest: totals._min.ytPublishedAt?.toISOString() ?? null,
    newest: totals._max.ytPublishedAt?.toISOString() ?? null,
  };
}

/** The numbers at the top of the importer. */
export async function getImporterOverview(actor: Actor | null) {
  assertPermission(actor, "youtube.import");
  const [channels, totals, needsReview, unfinished, quota] = await Promise.all([
    prisma.youTubeChannel.count(),
    prisma.importJob.aggregate({ _sum: { discoveredCount: true, importedCount: true } }),
    prisma.importJob.count({ where: { status: "READY_FOR_REVIEW" } }),
    prisma.importJob.count({ where: { status: { in: ["DISCOVERING", "IMPORTING", "PAUSED"] } } }),
    getQuotaUsage(),
  ]);
  return { channels, discovered: totals._sum.discoveredCount ?? 0, imported: totals._sum.importedCount ?? 0, needsReview, unfinished, quotaUnits: quota.units, quotaExhausted: quota.exhausted };
}

export async function listImportJobs(actor: Actor | null, options: { cursor?: unknown } = {}) {
  assertPermission(actor, "youtube.import");
  const cursor = parseOptionalCursor(options.cursor);
  const rows = await prisma.importJob.findMany({
    orderBy: { id: "desc" },
    take: 26,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      channelId: true,
      type: true,
      status: true,
      discoveredCount: true,
      importedCount: true,
      duplicateCount: true,
      failedCount: true,
      createdAt: true,
      updatedAt: true,
      channel: { select: { title: true, handle: true, thumbnailUrl: true, youtubeChannelId: true } },
    },
  });
  const page = toCursorPage(rows, 25);

  // One query for the whole page, rather than one per job.
  const groups = await prisma.importCandidate.groupBy({ by: ["jobId", "classification"], where: { jobId: { in: page.items.map((job) => job.id) } }, _count: { _all: true } });
  const countOf = (jobId: string, classification: string) => groups.find((group) => group.jobId === jobId && group.classification === classification)?._count._all ?? 0;
  return { ...page, items: page.items.map((job) => ({ ...job, shortCount: countOf(job.id, "SHORT_CANDIDATE"), longCount: countOf(job.id, "LONG_FORM_CANDIDATE") })) };
}
