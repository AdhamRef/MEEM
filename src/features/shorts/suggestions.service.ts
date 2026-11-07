import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { VideoCard } from "./types";
import { publicVideoFilter, toVideoCards, videoCardSelect, type VideoCardRow } from "./video-cards";

const UP_NEXT_LIMIT = 20;
const SAME_CHANNEL_LIMIT = 8;
const SHORTS_LIMIT = 12;

export interface VideoSuggestions {
  upNext: VideoCard[];
  /** The channel's Shorts, for a shelf beside long videos. */
  shorts: VideoCard[];
}

/**
 * Starts after a pivot in the stable random feed order and wraps around, so each video gets its
 * own spread of suggestions with no popularity bias (statistics are never used for ranking).
 */
async function byFeedOrder(where: Prisma.VideoWhereInput, pivot: number, take: number): Promise<VideoCardRow[]> {
  if (take <= 0) return [];
  const after = await prisma.video.findMany({ where: { ...where, feedKey: { gt: pivot } }, orderBy: { feedKey: "asc" }, take, select: videoCardSelect });
  if (after.length >= take) return after;
  const before = await prisma.video.findMany({ where: { ...where, feedKey: { lte: pivot } }, orderBy: { feedKey: "asc" }, take: take - after.length, select: videoCardSelect });
  return [...after, ...before];
}

/** Alternates two lists, so the same channel and related topics both stay near the top. */
function interleave<T>(first: T[], second: T[]): T[] {
  const result: T[] = [];
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
    if (first[index]) result.push(first[index]!);
    if (second[index]) result.push(second[index]!);
  }
  return result;
}

/**
 * What to watch next, from stored data only, so it costs no quota: the channel's recent videos,
 * videos from channels sharing its topics, then anything else, never repeating one.
 */
export async function listVideoSuggestions(video: Pick<VideoCard, "id" | "channelId" | "topics">): Promise<VideoSuggestions> {
  const current = await prisma.video.findUnique({ where: { id: video.id }, select: { feedKey: true } });
  const pivot = current?.feedKey ?? 0;
  const longForm = { ...publicVideoFilter, kind: "LONG_FORM", id: { not: video.id } } satisfies Prisma.VideoWhereInput;

  const [sameChannel, shortsRows, topicChannels] = await Promise.all([
    video.channelId ? prisma.video.findMany({ where: { ...longForm, channelId: video.channelId }, orderBy: [{ ytPublishedAt: "desc" }, { id: "desc" }], take: SAME_CHANNEL_LIMIT, select: videoCardSelect }) : [],
    video.channelId ? prisma.video.findMany({ where: { ...publicVideoFilter, kind: "SHORT", channelId: video.channelId }, orderBy: [{ ytPublishedAt: "desc" }, { id: "desc" }], take: SHORTS_LIMIT, select: videoCardSelect }) : [],
    video.topics.length ? prisma.channelTopic.findMany({ where: { topicId: { in: video.topics.map((topic) => topic.id) } }, select: { channelId: true }, take: 200 }) : [],
  ]);

  const seen = new Set([video.id, ...sameChannel.map((row) => row.id)]);
  const relatedChannelIds = [...new Set(topicChannels.map((link) => link.channelId))].filter((id) => id !== video.channelId);
  const topical = relatedChannelIds.length ? await byFeedOrder({ ...longForm, channelId: { in: relatedChannelIds }, id: { notIn: [...seen] } }, pivot, UP_NEXT_LIMIT - sameChannel.length) : [];
  for (const row of topical) seen.add(row.id);

  const combined = interleave(sameChannel, topical);
  const fill = await byFeedOrder({ ...longForm, id: { notIn: [...seen] } }, pivot, UP_NEXT_LIMIT - combined.length);

  const [upNext, shorts] = await Promise.all([toVideoCards([...combined, ...fill]), toVideoCards(shortsRows)]);
  return { upNext, shorts };
}
