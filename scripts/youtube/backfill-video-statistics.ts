import "../load-env";
import { backfillVideoStatistics } from "../../src/features/youtube/metadata-refresh.service";
import { prisma } from "../../src/lib/prisma";

/**
 * Fetches likes and comment counts for videos stored before they were collected. Safe to run
 * again: it only reads what's missing. Costs 1 quota unit per 50 videos, counted by the normal client.
 *
 * Usage: npm run youtube:backfill-stats
 */
const BATCHES_PER_ROUND = 20;

async function main(): Promise<void> {
  let total = 0;
  for (;;) {
    const report = await backfillVideoStatistics(BATCHES_PER_ROUND);
    total += report.updated;
    console.log(`Updated ${total} so far. ${report.remaining} left.`);
    if (report.stoppedBy) {
      console.log(`Stopped: ${report.stoppedBy}. Run it again later to continue.`);
      return;
    }
    // Nothing updated means what's left has no statistics to give, such as videos YouTube no longer returns.
    if (report.remaining === 0 || report.updated === 0) return;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "The backfill failed.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
