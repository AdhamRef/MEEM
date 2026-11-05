import { strings } from "@/config/strings.ar";
import { pickThumbnailUrl } from "@/lib/youtube/normalize";
import type { ResolvedContent } from "./resolve";

export interface ContentSummary {
  title: string;
  href: string;
  imageUrl: string | null;
  /** Credits the source on every item that shows YouTube's content (R4). */
  source: string;
}

const path = (base: string, slug: string) => `/${base}/${encodeURIComponent(slug)}`;
const youtubeSource = (channelTitle: string | null) => [channelTitle, strings.feed.source].filter(Boolean).join(" · ");
const t = strings.library.types;

/** One shape for lists that show different kinds of content in the same row. */
export function summarizeContent(item: ResolvedContent): ContentSummary {
  switch (item.type) {
    case "VIDEO": {
      const { video } = item;
      return { title: video.title, href: video.kind === "SHORT" ? `/shorts/${video.id}` : `/videos/${video.id}`, imageUrl: video.thumbnailUrl, source: youtubeSource(video.channelTitle) };
    }
    case "ARTICLE":
      return { title: item.article.title, href: path("articles", item.article.slug), imageUrl: item.article.coverImage, source: t.ARTICLE };
    case "TOPIC":
      return { title: item.topic.title, href: path("topics", item.topic.slug), imageUrl: item.topic.coverImage, source: t.TOPIC };
    case "LIBRARY":
      return { title: item.library.name, href: path("libraries", item.library.slug), imageUrl: item.library.coverImage, source: t.LIBRARY };
    case "PLAYLIST": {
      const { playlist } = item;
      return {
        title: playlist.title,
        href: path("playlists", playlist.slug),
        imageUrl: playlist.coverImage ?? pickThumbnailUrl(playlist.thumbnails),
        source: playlist.type === "YOUTUBE" ? `${t.PLAYLIST} · ${youtubeSource(playlist.channelTitle)}` : t.PLAYLIST,
      };
    }
    case "RESOURCE":
      return { title: item.resource.title, href: path("resources", item.resource.slug), imageUrl: item.resource.coverImage, source: `${strings.content.external} · ${item.resource.sourceName}` };
  }
}
