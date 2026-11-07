import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { objectIdSchema } from "@/features/topics/schemas";
import { AppError } from "@/lib/errors";
import { assertSignedIn, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { applySignal, type RecommendationSignal, type ScoringConfig } from "./scoring";
import { getScoringConfig } from "./settings.service";

const MS_PER_DAY = 86_400_000;
/** Raw activity is only needed for recent patterns, so it's removed on a schedule. */
const ACTIVITY_RETENTION_DAYS = 90;
const REPEAT_WINDOW_DAYS = 7;
const REPEAT_THRESHOLD = 3;

export const videoSignalSchema = z.strictObject({
  videoId: objectIdSchema,
  signal: z.enum(["completion", "earlySkip"]),
});

export async function applyTopicSignal(
  tx: Prisma.TransactionClient,
  userId: string,
  topicId: string,
  signal: RecommendationSignal,
  config: ScoringConfig,
  now: Date,
): Promise<void> {
  const existing = await tx.userInterest.findUnique({
    where: { userId_topicId: { userId, topicId } },
    select: { behaviourScore: true, lastSignalAt: true },
  });
  const next = applySignal(existing ?? { behaviourScore: 0, lastSignalAt: null }, signal, now, config);

  await tx.userInterest.upsert({
    where: { userId_topicId: { userId, topicId } },
    update: next,
    create: { userId, topicId, ...next },
  });
}

/** A video's topics are its channel's. Unpublished ones take no signals. */
export async function topicIdsOfChannel(channelId: string | null): Promise<string[]> {
  if (!channelId) return [];
  const links = await prisma.channelTopic.findMany({ where: { channelId, topic: { status: "PUBLISHED", isArchived: false } }, select: { topicId: true } });
  return links.map((link) => link.topicId);
}

/**
 * Records what was observed while watching. The signal concerns the topics of the video's channel
 * and nothing else, and no conclusion is drawn about the person (§9.2). A channel with no public
 * topic counts for nothing, and a signal about a video that isn't public is refused.
 */
export async function recordVideoSignal(actor: Actor | null, rawInput: unknown, now = new Date()): Promise<void> {
  assertSignedIn(actor);
  const parsed = videoSignalSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { videoId, signal } = parsed.data;

  const video = await prisma.video.findFirst({
    where: { id: videoId, status: "PUBLISHED", isArchived: false },
    select: { channelId: true },
  });
  if (!video) throw new AppError("NOT_FOUND");

  const config = await getScoringConfig();
  const { channelId } = video;
  const topicIds = await topicIdsOfChannel(channelId);

  await withTransaction(async (tx) => {
    await tx.userActivity.create({
      data: {
        userId: actor.id,
        entityType: "VIDEO",
        entityId: videoId,
        action: signal === "completion" ? "COMPLETE" : "EARLY_SKIP",
        channelId,
        occurredAt: now,
        expiresAt: new Date(now.getTime() + ACTIVITY_RETENTION_DAYS * MS_PER_DAY),
      },
    });
    if (topicIds.length === 0) return;

    for (const topicId of topicIds) await applyTopicSignal(tx, actor.id, topicId, signal, config, now);

    if (signal === "completion") {
      const recentCompletions = await tx.userActivity.count({
        where: { userId: actor.id, action: "COMPLETE", channelId, occurredAt: { gte: new Date(now.getTime() - REPEAT_WINDOW_DAYS * MS_PER_DAY) } },
      });
      if (recentCompletions >= REPEAT_THRESHOLD) {
        for (const topicId of topicIds) await applyTopicSignal(tx, actor.id, topicId, "repeatedEngagement", config, now);
      }
    }
  });
}
