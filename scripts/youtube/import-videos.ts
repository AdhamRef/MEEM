import "../load-env";
import { PrismaClient } from "@prisma/client";
import { importVideosByInput } from "../../src/features/youtube/video-import.service";

/**
 * Development only: fills a local feed with real videos, using the YouTube API.
 * It skips the human review that real publishing requires, so it refuses to run in production.
 *
 *   npm run youtube:import-dev -- <video ID or URL> [more...]
 */
if (process.env.NODE_ENV === "production") {
  console.error("This command is for local development only.");
  process.exit(1);
}

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  console.error("Usage: npm run youtube:import-dev -- <video ID or URL> [more...]");
  process.exit(1);
}

const prisma = new PrismaClient();

try {

  const report = await importVideosByInput(inputs);
  const now = new Date();
  await prisma.video.updateMany({
    where: { youtubeVideoId: { in: report.imported } },
    data: { kind: "SHORT", reviewedAt: now, status: "PUBLISHED", publishedAt: now },
  });

  console.log(`Imported and published: ${report.imported.length}`);
  console.log(`Already stored, left unchanged: ${report.duplicates.length}`);
  if (report.notFound.length) console.log(`Not found on YouTube: ${report.notFound.join(", ")}`);
  if (report.invalid.length) console.log(`Not valid IDs or URLs: ${report.invalid.join(", ")}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
