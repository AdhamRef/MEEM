import { z } from "zod";
import { publicContentFilter } from "@/features/content/common";
import { publicVideoFilter } from "@/features/shorts/video-cards";
import { prisma } from "@/lib/prisma";
import { objectIdSchema } from "./schemas";

/** Well above any realistic list. They only exist so a query is never unbounded. */
const MAX_TOPICS = 200;
const MAX_CHANNELS = 1000;

export interface CatalogueTopic {
  id: string;
  title: string;
  slug: string;
  introduction: string | null;
  coverImage: string | null;
  channelIds: string[];
}

export interface CatalogueChannel {
  id: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
  /** How many of its videos are public on this site. Our own count, not a YouTube statistic. */
  videoCount: number;
  topicIds: string[];
}

/** Everything the first-visit choices and the interests page offer. */
export interface InterestCatalogue {
  topics: CatalogueTopic[];
  channels: CatalogueChannel[];
}

const videoCountsSchema = z.array(z.object({ _id: z.object({ $oid: objectIdSchema }).nullish(), count: z.number().int() }));

async function publicVideoCountsByChannel(): Promise<Map<string, number>> {
  // Raw, because Prisma's groupBy panics on MongoDB when a grouped field is missing from a document.
  const raw = await prisma.video.aggregateRaw({ pipeline: [{ $match: publicVideoFilter }, { $group: { _id: "$channelId", count: { $sum: 1 } } }] });
  return new Map(videoCountsSchema.parse(raw).flatMap(({ _id, count }) => (_id ? [[_id.$oid, count] as const] : [])));
}

/**
 * Only channels with something to watch, and only topics with such a channel, so nobody can
 * choose something that would leave their feed empty. A channel whose YouTube data was withdrawn
 * has no name to show, so it isn't offered until a refresh restores it.
 */
export async function getInterestCatalogue(): Promise<InterestCatalogue> {
  const [topics, channels, links, counts] = await Promise.all([
    prisma.topic.findMany({
      where: publicContentFilter,
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      take: MAX_TOPICS,
      select: { id: true, title: true, slug: true, introduction: true, coverImage: true },
    }),
    prisma.youTubeChannel.findMany({ where: { title: { not: "" } }, orderBy: { title: "asc" }, take: MAX_CHANNELS, select: { id: true, title: true, handle: true, thumbnailUrl: true } }),
    prisma.channelTopic.findMany({ take: MAX_CHANNELS * 10, select: { channelId: true, topicId: true } }),
    publicVideoCountsByChannel(),
  ]);

  const publicTopicIds = new Set(topics.map((topic) => topic.id));
  const watchable = channels.flatMap((channel) => {
    const videoCount = counts.get(channel.id) ?? 0;
    if (videoCount === 0) return [];
    return [{ ...channel, videoCount, topicIds: links.filter((link) => link.channelId === channel.id && publicTopicIds.has(link.topicId)).map((link) => link.topicId) }];
  });

  return {
    topics: topics.flatMap((topic) => {
      const channelIds = watchable.filter((channel) => channel.topicIds.includes(topic.id)).map((channel) => channel.id);
      return channelIds.length ? [{ ...topic, channelIds }] : [];
    }),
    channels: watchable,
  };
}

export interface TopicOption {
  id: string;
  title: string;
  slug: string;
}

const topicOptionSelect = { id: true, title: true, slug: true } as const;

/** For filtering by topic where anything can belong to one, such as search. */
export async function listPublicTopicOptions(): Promise<TopicOption[]> {
  return prisma.topic.findMany({ where: publicContentFilter, orderBy: [{ displayOrder: "asc" }, { id: "asc" }], take: MAX_TOPICS, select: topicOptionSelect });
}

/** For filtering videos, where a topic with no channels could only ever show nothing. */
export async function listBrowsableTopics(): Promise<TopicOption[]> {
  return prisma.topic.findMany({ where: { ...publicContentFilter, channels: { some: {} } }, orderBy: [{ displayOrder: "asc" }, { id: "asc" }], take: MAX_TOPICS, select: topicOptionSelect });
}
