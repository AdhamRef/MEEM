import { randomInt } from "node:crypto";
import { recordAudit } from "@/features/admin/audit";
import { AppError, isUniqueConstraintError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { parseYouTubeVideoId } from "@/lib/youtube/ids";
import { classifyByDuration, type NormalizedVideo } from "@/lib/youtube/normalize";
import { chunk, fetchVideoBatch, VIDEOS_PER_REQUEST } from "@/lib/youtube/videos";
import { getYouTubeSettings } from "./settings.service";
import { youtubeFields } from "./video-persistence";

export interface VideoImportReport {
  imported: string[];
  duplicates: string[];
  notFound: string[];
  invalid: string[];
}

const MAX_FEED_KEY = 2 ** 31 - 1;

/** Remembered for one import, since a playlist usually comes from one channel. */
async function findOrCreateChannel(video: NormalizedVideo, now: Date, known: Map<string, string>): Promise<string | null> {
  if (!video.channelYoutubeId) return null;
  const cached = known.get(video.channelYoutubeId);
  if (cached) return cached;

  const data = { title: video.channelTitle ?? video.channelYoutubeId, metadataFetchedAt: now };
  const channel = await prisma.youTubeChannel.upsert({
    where: { youtubeChannelId: video.channelYoutubeId },
    update: data,
    create: { youtubeChannelId: video.channelYoutubeId, ...data },
    select: { id: true },
  });
  known.set(video.channelYoutubeId, channel.id);
  return channel.id;
}

/**
 * Stores new videos as drafts, so nothing is published without a person reviewing it.
 * IDs already stored cost no API call. The unique index catches anything imported at the
 * same moment, because createMany has no skipDuplicates on MongoDB.
 */
export async function importVideosByInput(inputs: string[], createdById?: string): Promise<VideoImportReport> {
  const report: VideoImportReport = { imported: [], duplicates: [], notFound: [], invalid: [] };

  const ids = new Set<string>();
  for (const input of inputs) {
    const id = parseYouTubeVideoId(input);
    if (id) ids.add(id);
    else report.invalid.push(input);
  }
  if (ids.size === 0) return report;

  const existing = await prisma.video.findMany({ where: { youtubeVideoId: { in: [...ids] } }, select: { youtubeVideoId: true } });
  report.duplicates = existing.map((video) => video.youtubeVideoId);
  const known = new Set(report.duplicates);
  const newIds = [...ids].filter((id) => !known.has(id));

  const settings = await getYouTubeSettings();
  const now = new Date();
  const knownChannels = new Map<string, string>();

  for (const batch of chunk(newIds, VIDEOS_PER_REQUEST)) {
    const videos = await fetchVideoBatch(batch, { includeStatistics: settings.statisticsEnabled });
    const returned = new Set(videos.map((video) => video.youtubeVideoId));
    report.notFound.push(...batch.filter((id) => !returned.has(id)));

    for (const video of videos) {
      const classification = classifyByDuration(video.durationSeconds, settings.maxShortSeconds, video.aspectRatio);
      try {
        await prisma.video.create({
          data: {
            ...youtubeFields(video, { includeStatistics: settings.statisticsEnabled, now }),
            youtubeVideoId: video.youtubeVideoId,
            classification,
            kind: classification === "SHORT_CANDIDATE" ? "SHORT" : "LONG_FORM",
            status: "DRAFT",
            feedKey: randomInt(MAX_FEED_KEY),
            channelId: await findOrCreateChannel(video, now, knownChannels),
            createdById,
          },
        });
        report.imported.push(video.youtubeVideoId);
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        report.duplicates.push(video.youtubeVideoId);
      }
    }
  }

  return report;
}

export async function importVideos(actor: Actor | null, rawInputs: unknown): Promise<VideoImportReport> {
  assertPermission(actor, "youtube.import");
  if (!Array.isArray(rawInputs) || rawInputs.length > 500 || !rawInputs.every((input) => typeof input === "string")) {
    throw new AppError("VALIDATION");
  }

  const report = await importVideosByInput(rawInputs as string[], actor.id);
  await recordAudit(prisma, actor, {
    action: "youtube.import_videos",
    entityType: "Video",
    metadata: { imported: report.imported.length, duplicates: report.duplicates.length, notFound: report.notFound.length, invalid: report.invalid.length },
  });
  return report;
}
