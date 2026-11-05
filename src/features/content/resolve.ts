import type { ContentType } from "@prisma/client";
import { publicPlaylistFilter, playlistCardSelect, type PlaylistCardData } from "@/features/playlists/playlist-filters";
import type { VideoCard } from "@/features/shorts/types";
import { publicVideoFilter, toVideoCards, videoCardSelect } from "@/features/shorts/video-cards";
import { prisma } from "@/lib/prisma";
import { articleCardSelect, libraryCardSelect, resourceCardSelect, topicCardSelect, type ArticleCardData, type LibraryCardData, type ResourceCardData, type TopicCardData } from "./cards";
import { publicContentFilter } from "./common";

export interface ContentRef {
  entityType: ContentType;
  entityId: string;
}

export type ResolvedContent =
  | { type: "VIDEO"; video: VideoCard }
  | { type: "ARTICLE"; article: ArticleCardData }
  | { type: "TOPIC"; topic: TopicCardData }
  | { type: "LIBRARY"; library: LibraryCardData }
  | { type: "PLAYLIST"; playlist: PlaylistCardData }
  | { type: "RESOURCE"; resource: ResourceCardData };

export const contentKey = (ref: ContentRef) => `${ref.entityType}:${ref.entityId}`;

/**
 * What these references point at, for references that lead to public content only. Anything
 * unpublished, archived, or withdrawn is simply missing from the result, so it can't appear
 * on a page however it was reached. Each type is one query, whatever the number of items.
 */
export async function resolvePublicContent(refs: ContentRef[]): Promise<Map<string, ResolvedContent>> {
  const idsOf = (type: ContentType) => [...new Set(refs.filter((ref) => ref.entityType === type).map((ref) => ref.entityId))];
  const [videoIds, articleIds, topicIds, libraryIds, playlistIds, resourceIds] = (["VIDEO", "ARTICLE", "TOPIC", "LIBRARY", "PLAYLIST", "RESOURCE"] as const).map(idsOf) as [string[], string[], string[], string[], string[], string[]];

  const [videoRows, articles, topics, libraries, playlists, resources] = await Promise.all([
    videoIds.length ? prisma.video.findMany({ where: { id: { in: videoIds }, ...publicVideoFilter }, select: videoCardSelect }) : [],
    articleIds.length ? prisma.article.findMany({ where: { id: { in: articleIds }, ...publicContentFilter }, select: articleCardSelect }) : [],
    topicIds.length ? prisma.topic.findMany({ where: { id: { in: topicIds }, ...publicContentFilter }, select: topicCardSelect }) : [],
    libraryIds.length ? prisma.library.findMany({ where: { id: { in: libraryIds }, ...publicContentFilter }, select: libraryCardSelect }) : [],
    playlistIds.length ? prisma.playlist.findMany({ where: { id: { in: playlistIds }, ...publicPlaylistFilter }, select: playlistCardSelect }) : [],
    resourceIds.length ? prisma.externalResource.findMany({ where: { id: { in: resourceIds }, ...publicContentFilter }, select: resourceCardSelect }) : [],
  ]);
  const videos = await toVideoCards(videoRows);

  const resolved = new Map<string, ResolvedContent>();
  for (const video of videos) resolved.set(`VIDEO:${video.id}`, { type: "VIDEO", video });
  for (const article of articles) resolved.set(`ARTICLE:${article.id}`, { type: "ARTICLE", article });
  for (const topic of topics) resolved.set(`TOPIC:${topic.id}`, { type: "TOPIC", topic });
  for (const library of libraries) resolved.set(`LIBRARY:${library.id}`, { type: "LIBRARY", library });
  for (const playlist of playlists) resolved.set(`PLAYLIST:${playlist.id}`, { type: "PLAYLIST", playlist });
  for (const resource of resources) resolved.set(`RESOURCE:${resource.id}`, { type: "RESOURCE", resource });
  return resolved;
}

/** The same references in the same order, leaving out whatever isn't public. */
export async function resolveInOrder(refs: ContentRef[]): Promise<ResolvedContent[]> {
  const resolved = await resolvePublicContent(refs);
  return refs.flatMap((ref) => {
    const item = resolved.get(contentKey(ref));
    return item ? [item] : [];
  });
}
