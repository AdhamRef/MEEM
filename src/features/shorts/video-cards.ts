import type { Prisma } from "@prisma/client";
import { getYouTubeSettings } from "@/features/youtube/settings.service";
import { prisma } from "@/lib/prisma";
import { pickThumbnailUrl } from "@/lib/youtube/normalize";
import type { VideoCard, VideoCardCta } from "./types";

/**
 * Every public video query uses this. A video whose YouTube data was withdrawn has
 * availability UNKNOWN and so leaves public pages automatically.
 */
export const publicVideoFilter = { status: "PUBLISHED", isArchived: false, availability: "AVAILABLE" } satisfies Prisma.VideoWhereInput;

export const videoCardSelect = {
  id: true,
  youtubeVideoId: true,
  kind: true,
  title: true,
  description: true,
  channelId: true,
  channelTitle: true,
  thumbnails: true,
  durationSeconds: true,
  aspectRatio: true,
  ytPublishedAt: true,
  categoryId: true,
  topicIds: true,
  cta: true,
  stats: true,
  feedKey: true,
} satisfies Prisma.VideoSelect;

export type VideoCardRow = Prisma.VideoGetPayload<{ select: typeof videoCardSelect }>;

function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Only CTA types whose destination exists are shown, and only when the target is public, so
 * a CTA can never lead nowhere.
 */
async function resolveCtas(rows: VideoCardRow[]): Promise<Map<string, VideoCardCta>> {
  const fullVideoIds = rows.flatMap((row) => (row.cta?.type === "FULL_VIDEO" && row.cta.targetId ? [row.cta.targetId] : []));
  const resourceIds = rows.flatMap((row) => (row.cta?.type === "EXTERNAL_RESOURCE" && row.cta.targetId ? [row.cta.targetId] : []));

  const articleIds = rows.flatMap((row) => (row.cta?.type === "INTERNAL_ARTICLE" && row.cta.targetId ? [row.cta.targetId] : []));
  const topicIds = rows.flatMap((row) => (row.cta?.type === "TOPIC" && row.cta.targetId ? [row.cta.targetId] : []));

  const playlistIds = rows.flatMap((row) => ((row.cta?.type === "CURATED_PLAYLIST" || row.cta?.type === "YOUTUBE_PLAYLIST") && row.cta.targetId ? [row.cta.targetId] : []));

  const [videos, resources, articles, topics, playlists] = await Promise.all([
    fullVideoIds.length ? prisma.video.findMany({ where: { id: { in: fullVideoIds }, ...publicVideoFilter }, select: { id: true } }) : [],
    resourceIds.length
      ? prisma.externalResource.findMany({ where: { id: { in: resourceIds }, status: "PUBLISHED", isArchived: false }, select: { id: true, url: true } })
      : [],
    articleIds.length ? prisma.article.findMany({ where: { id: { in: articleIds }, status: "PUBLISHED", isArchived: false }, select: { id: true, slug: true } }) : [],
    topicIds.length ? prisma.topic.findMany({ where: { id: { in: topicIds }, status: "PUBLISHED", isArchived: false }, select: { id: true, slug: true } }) : [],
    playlistIds.length ? prisma.playlist.findMany({ where: { id: { in: playlistIds }, status: "PUBLISHED", isArchived: false, title: { not: "" } }, select: { id: true, slug: true } }) : [],
  ]);
  const playlistSlugs = new Map(playlists.map((playlist) => [playlist.id, playlist.slug]));
  const articleSlugs = new Map(articles.map((article) => [article.id, article.slug]));
  const topicSlugs = new Map(topics.map((topic) => [topic.id, topic.slug]));
  const publicVideos = new Set(videos.map((video) => video.id));
  const resourceUrls = new Map(resources.map((resource) => [resource.id, resource.url]));

  const ctas = new Map<string, VideoCardCta>();
  for (const { id, cta } of rows) {
    if (cta?.type === "FULL_VIDEO" && cta.targetId && publicVideos.has(cta.targetId)) {
      ctas.set(id, { type: "FULL_VIDEO", label: cta.label, href: `/videos/${cta.targetId}`, isExternal: false });
    } else if (cta?.type === "EXTERNAL_RESOURCE") {
      const href = safeExternalUrl(cta.targetId ? resourceUrls.get(cta.targetId) : cta.externalUrl);
      if (href) ctas.set(id, { type: "EXTERNAL_RESOURCE", label: cta.label, href, isExternal: true });
    } else if (cta?.type === "INTERNAL_ARTICLE" && cta.targetId && articleSlugs.has(cta.targetId)) {
      ctas.set(id, { type: "INTERNAL_ARTICLE", label: cta.label, href: `/articles/${encodeURIComponent(articleSlugs.get(cta.targetId)!)}`, isExternal: false });
    } else if (cta?.type === "TOPIC" && cta.targetId && topicSlugs.has(cta.targetId)) {
      ctas.set(id, { type: "TOPIC", label: cta.label, href: `/topics/${encodeURIComponent(topicSlugs.get(cta.targetId)!)}`, isExternal: false });
    } else if ((cta?.type === "CURATED_PLAYLIST" || cta?.type === "YOUTUBE_PLAYLIST") && cta.targetId && playlistSlugs.has(cta.targetId)) {
      ctas.set(id, { type: cta.type, label: cta.label, href: `/playlists/${encodeURIComponent(playlistSlugs.get(cta.targetId)!)}`, isExternal: false });
    }
  }
  return ctas;
}

export async function toVideoCards(rows: VideoCardRow[]): Promise<VideoCard[]> {
  if (rows.length === 0) return [];

  const categoryIds = [...new Set(rows.flatMap((row) => (row.categoryId ? [row.categoryId] : [])))];
  const topicIds = [...new Set(rows.flatMap((row) => row.topicIds))];
  const channelIds = [...new Set(rows.flatMap((row) => (row.channelId ? [row.channelId] : [])))];

  const [channels, categories, topics, ctas, settings] = await Promise.all([
    channelIds.length ? prisma.youTubeChannel.findMany({ where: { id: { in: channelIds } }, select: { id: true, thumbnailUrl: true } }) : [],
    prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, title: true, slug: true } }),
    topicIds.length ? prisma.topic.findMany({ where: { id: { in: topicIds }, status: "PUBLISHED", isArchived: false }, select: { id: true, title: true } }) : [],
    resolveCtas(rows),
    getYouTubeSettings(),
  ]);
  const channelImageById = new Map(channels.map((channel) => [channel.id, channel.thumbnailUrl]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const topicTitleById = new Map(topics.map((topic) => [topic.id, topic.title]));

  return rows.map((row) => ({
    id: row.id,
    youtubeVideoId: row.youtubeVideoId,
    kind: row.kind,
    title: row.title,
    description: row.description,
    channelTitle: row.channelTitle,
    channelImageUrl: row.channelId ? (channelImageById.get(row.channelId) ?? null) : null,
    thumbnailUrl: pickThumbnailUrl(row.thumbnails),
    durationSeconds: row.durationSeconds,
    aspectRatio: row.aspectRatio,
    uploadedAt: row.ytPublishedAt?.toISOString() ?? null,
    category: row.categoryId ? (categoryById.get(row.categoryId) ?? null) : null,
    topics: row.topicIds.flatMap((id) => {
      const title = topicTitleById.get(id);
      return title ? [title] : [];
    }),
    cta: ctas.get(row.id) ?? null,
    viewCount: settings.statisticsEnabled && row.stats?.viewCount != null ? Number(row.stats.viewCount) : null,
  }));
}
