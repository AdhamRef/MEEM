/* eslint-disable @next/next/no-img-element -- Covers come from configurable storage, and thumbnails load directly from YouTube by design. */
import { BookOpen, ExternalLink, Library, ListVideo, Tag } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { strings } from "@/config/strings.ar";
import type { ArticleCardData, LibraryCardData, ResourceCardData, TopicCardData } from "@/features/content/cards";
import type { PlaylistCardData } from "@/features/playlists/playlist-filters";
import type { VideoCard } from "@/features/shorts/types";
import { pickThumbnailUrl } from "@/lib/youtube/normalize";

const cardClass = "group flex h-full flex-col overflow-hidden rounded-2xl border bg-surface outline-none transition-colors hover:bg-surface-elevated focus-visible:ring-3 focus-visible:ring-ring/50";

function Cover({ src, icon: Icon }: { src: string | null; icon: typeof BookOpen }) {
  return src ? (
    <img src={src} alt="" loading="lazy" decoding="async" className="aspect-16/9 w-full object-cover" />
  ) : (
    <div className="flex aspect-16/9 w-full items-center justify-center bg-surface-elevated text-text-secondary">
      <Icon aria-hidden className="size-7" strokeWidth={1.5} />
    </div>
  );
}

export const slugHref = (base: string, slug: string) => `/${base}/${encodeURIComponent(slug)}`;

export function ArticleCard({ article }: { article: ArticleCardData }) {
  return (
    <Link href={slugHref("articles", article.slug)} className={cardClass} data-testid="article-card">
      <Cover src={article.coverImage} icon={BookOpen} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 dir="auto" className="text-start text-base leading-snug font-semibold">
          {article.title}
        </h3>
        {article.excerpt ? (
          <p dir="auto" className="line-clamp-2 text-start text-sm text-text-secondary">
            {article.excerpt}
          </p>
        ) : null}
        {article.readingMinutes > 0 ? <p className="mt-auto pt-1 text-xs text-text-secondary">{strings.articles.readingTime(article.readingMinutes)}</p> : null}
      </div>
    </Link>
  );
}

export function TopicCard({ topic }: { topic: TopicCardData }) {
  return (
    <Link href={slugHref("topics", topic.slug)} className={cardClass} data-testid="topic-card">
      {topic.coverImage ? <Cover src={topic.coverImage} icon={Tag} /> : null}
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 dir="auto" className="text-start text-base leading-snug font-semibold">
          {topic.title}
        </h3>
        {topic.introduction ? (
          <p dir="auto" className="line-clamp-2 text-start text-sm text-text-secondary">
            {topic.introduction}
          </p>
        ) : null}
      </div>
    </Link>
  );
}

export function LibraryCard({ library }: { library: LibraryCardData }) {
  return (
    <Link href={slugHref("libraries", library.slug)} className={cardClass} data-testid="library-card">
      <Cover src={library.coverImage} icon={Library} />
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 dir="auto" className="text-start text-base leading-snug font-semibold">
          {library.name}
        </h3>
        {library.description ? (
          <p dir="auto" className="line-clamp-2 text-start text-sm text-text-secondary">
            {library.description}
          </p>
        ) : null}
      </div>
    </Link>
  );
}

/** A YouTube playlist credits its source. A curated one credits YouTube on each item inside. */
export function PlaylistCard({ playlist }: { playlist: PlaylistCardData }) {
  const cover = playlist.coverImage ?? pickThumbnailUrl(playlist.thumbnails);
  return (
    <Link href={slugHref("playlists", playlist.slug)} className={cardClass} data-testid="playlist-card">
      {playlist.type === "YOUTUBE" && cover ? (
        <img src={cover} alt="" loading="lazy" decoding="async" referrerPolicy="strict-origin-when-cross-origin" className="aspect-16/9 w-full object-cover" />
      ) : (
        <Cover src={cover} icon={ListVideo} />
      )}
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 dir="auto" className="text-start text-base leading-snug font-semibold">
          {playlist.title}
        </h3>
        {playlist.description ? (
          <p dir="auto" className="line-clamp-2 text-start text-sm text-text-secondary">
            {playlist.description}
          </p>
        ) : null}
        {playlist.type === "YOUTUBE" ? (
          <p className="mt-auto pt-1 text-xs text-text-secondary">
            {playlist.channelTitle ? (
              <>
                <bdi>{playlist.channelTitle}</bdi> ·{" "}
              </>
            ) : null}
            {strings.feed.source}
          </p>
        ) : null}
      </div>
    </Link>
  );
}

/** Marked as external everywhere it appears (§12.4). */
export function ResourceCard({ resource }: { resource: ResourceCardData }) {
  return (
    <Link href={slugHref("resources", resource.slug)} className={cardClass} data-testid="resource-card">
      {resource.coverImage ? <Cover src={resource.coverImage} icon={ExternalLink} /> : null}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Badge variant="secondary" className="self-start">
          <ExternalLink aria-hidden />
          {strings.content.external}
        </Badge>
        <h3 dir="auto" className="text-start text-base leading-snug font-semibold">
          {resource.title}
        </h3>
        <p dir="auto" className="text-start text-xs text-text-secondary">
          {strings.resources.from} {resource.sourceName}
        </p>
      </div>
    </Link>
  );
}

/**
 * Compact video card. YouTube is credited on each item that shows its content. A Short opens
 * over the current page, through the modal route, so readers keep their place (§12.6).
 */
export function VideoTile({ video }: { video: VideoCard }) {
  const isShort = video.kind === "SHORT";
  return (
    <Link href={isShort ? `/shorts/${video.id}` : `/videos/${video.id}`} scroll={false} className={cardClass} data-testid="video-tile">
      {video.thumbnailUrl ? (
        <img
          src={video.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="strict-origin-when-cross-origin"
          className={isShort ? "aspect-9/16 w-full bg-black object-contain" : "aspect-video w-full bg-black object-cover"}
        />
      ) : null}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 dir="auto" className="line-clamp-2 text-start text-sm leading-snug font-medium">
          {video.title}
        </h3>
        <p className="mt-auto pt-1 text-xs text-text-secondary">
          {video.channelTitle ? (
            <>
              <bdi>{video.channelTitle}</bdi> ·{" "}
            </>
          ) : null}
          {strings.feed.source}
        </p>
      </div>
    </Link>
  );
}

export function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mb-4 text-lg font-semibold">
      {children}
    </h2>
  );
}

/** Renders nothing when it has no items, so empty sections are hidden (§11.1). */
export function ContentSection({ id, title, isEmpty, children }: { id: string; title: string; isEmpty: boolean; children: ReactNode }) {
  if (isEmpty) return null;
  return (
    <section aria-labelledby={id} data-testid={`section-${id}`}>
      <SectionHeading id={id}>{title}</SectionHeading>
      {children}
    </section>
  );
}

export const cardGridClass = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";

/** A horizontal strip that keeps the page short when many Shorts are linked. */
export function ShortsStrip({ videos }: { videos: VideoCard[] }) {
  return (
    <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0" data-testid="shorts-strip">
      {videos.map((video) => (
        <li key={video.id} className="w-40 shrink-0 snap-start">
          <VideoTile video={video} />
        </li>
      ))}
    </ul>
  );
}

export function SectionPager({ param, nextCursor, isPaged, pathname }: { param: string; nextCursor: string | null; isPaged: boolean; pathname: string }) {
  if (!nextCursor && !isPaged) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-4 text-sm">
      {nextCursor ? (
        <Link href={`${pathname}?${param}=${nextCursor}#${param}`} className="text-brand underline-offset-4 hover:underline" data-testid={`more-${param}`}>
          {strings.content.showMore}
        </Link>
      ) : null}
      {isPaged ? (
        <Link href={`${pathname}#${param}`} className="text-text-secondary underline-offset-4 hover:underline">
          {strings.content.backToStart}
        </Link>
      ) : null}
    </div>
  );
}
