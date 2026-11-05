import "../load-env";
import { prisma } from "../../src/lib/prisma";
import { fetchVideoBatch, VIDEOS_PER_REQUEST } from "../../src/lib/youtube/videos";

/**
 * Asks YouTube for the real shape of videos and previews stored before shape was recorded.
 * A wide video isn't a Short, so one labelled that way only by its length becomes long-form,
 * and leaves the vertical feed. Safe to run again: it only reads what's missing. Costs 1 quota
 * unit per 50 items, and the requests go through the normal client, which counts them.
 *
 * Usage: npm run youtube:backfill-shapes
 */
const isWide = (ratio: number) => ratio > 1;

function groupByRatio(videos: { youtubeVideoId: string; aspectRatio: number | null }[]): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  for (const video of videos) {
    if (video.aspectRatio === null) continue;
    groups.set(video.aspectRatio, [...(groups.get(video.aspectRatio) ?? []), video.youtubeVideoId]);
  }
  return groups;
}

/** The importer may be writing to the same records, which MongoDB reports as a conflict. */
async function withRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

async function backfillVideos(): Promise<void> {
  let afterId: string | undefined;
  let updated = 0;
  let movedToLong = 0;

  for (;;) {
    const rows = await prisma.video.findMany({
      where: { availability: "AVAILABLE", OR: [{ aspectRatio: null }, { aspectRatio: { isSet: false } }], ...(afterId ? { id: { gt: afterId } } : {}) },
      orderBy: { id: "asc" },
      take: VIDEOS_PER_REQUEST,
      select: { id: true, youtubeVideoId: true },
    });
    if (rows.length === 0) break;
    afterId = rows.at(-1)!.id;

    const fetched = await fetchVideoBatch(rows.map((row) => row.youtubeVideoId), { includeStatistics: false });
    for (const [aspectRatio, ids] of groupByRatio(fetched)) {
      updated += (await prisma.video.updateMany({ where: { youtubeVideoId: { in: ids } }, data: { aspectRatio } })).count;
      if (isWide(aspectRatio)) {
        movedToLong += (await prisma.video.updateMany({ where: { youtubeVideoId: { in: ids }, kind: "SHORT" }, data: { kind: "LONG_FORM", classification: "LONG_FORM_CANDIDATE" } })).count;
      }
    }
    console.log(`Videos: ${updated} measured, ${movedToLong} wide ones moved out of Shorts`);
  }
}

async function backfillPreviews(): Promise<void> {
  let afterId: string | undefined;
  let updated = 0;

  for (;;) {
    const rows = await prisma.importCandidate.findMany({
      where: { OR: [{ aspectRatio: null }, { aspectRatio: { isSet: false } }], ...(afterId ? { id: { gt: afterId } } : {}) },
      orderBy: { id: "asc" },
      take: VIDEOS_PER_REQUEST,
      select: { id: true, youtubeVideoId: true },
    });
    if (rows.length === 0) break;
    afterId = rows.at(-1)!.id;

    const fetched = await fetchVideoBatch([...new Set(rows.map((row) => row.youtubeVideoId))], { includeStatistics: false });
    for (const [aspectRatio, ids] of groupByRatio(fetched)) {
      const where = { id: { in: rows.map((row) => row.id) }, youtubeVideoId: { in: ids } };
      updated += (await withRetry(() => prisma.importCandidate.updateMany({ where, data: { aspectRatio, ...(isWide(aspectRatio) ? { classification: "LONG_FORM_CANDIDATE" as const } : {}) } }))).count;
    }
    console.log(`Previews: ${updated} measured`);
  }
}

try {
  await backfillVideos();
  await backfillPreviews();
  const kinds = await prisma.video.groupBy({ by: ["kind", "status"], _count: { _all: true } });
  console.log("Now:", JSON.stringify(kinds.map((row) => [row.kind, row.status, row._count._all])));
  await prisma.auditLog.create({ data: { actorEmail: "system:backfill", action: "youtube.backfill_shapes", entityType: "Video" } });
} catch (error) {
  console.error("Stopped:", error instanceof Error ? error.message.slice(-300) : "unknown error");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
