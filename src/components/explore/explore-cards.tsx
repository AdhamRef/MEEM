/* eslint-disable @next/next/no-img-element -- Thumbnails load directly from YouTube by design, and aren't re-processed or re-hosted. */
import { Tv } from "lucide-react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { strings } from "@/config/strings.ar";
import type { VideoCard } from "@/features/shorts/types";
import { formatDuration, formatTimeAgo } from "@/lib/format/video-time";
import { cn } from "@/lib/utils";
import { VideoCardMenu } from "./video-card-menu";

export const videoGridClass = "grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 sm:gap-y-8 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";
export const shortsGridClass = "grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8";

function ChannelAvatar({ video }: { video: VideoCard }) {
  return video.channelImageUrl ? (
    <img src={video.channelImageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="strict-origin-when-cross-origin" className="size-9 shrink-0 rounded-full bg-surface-elevated object-cover" />
  ) : (
    <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-text-secondary">
      <Tv className="size-4" strokeWidth={1.5} />
    </span>
  );
}

/** A video in the grid: a large thumbnail with its length, then the channel, title, and when it was published. */
export function ExploreVideoCard({ video, now, isInShelf = false }: { video: VideoCard; now: Date; isInShelf?: boolean }) {
  const duration = formatDuration(video.durationSeconds);
  const uploaded = formatTimeAgo(video.uploadedAt, now);
  const href = `/videos/${video.id}`;

  return (
    <article className="group min-w-0" data-testid="video-tile">
      <Link href={href} tabIndex={-1} aria-hidden className={cn("relative block overflow-hidden bg-surface-elevated sm:mx-0 sm:rounded-xl", isInShelf ? "rounded-xl" : "-mx-4")}>
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="strict-origin-when-cross-origin" className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transform-none" />
        ) : (
          <div className="aspect-video w-full" />
        )}
        {duration ? (
          <span dir="ltr" className="absolute end-2 bottom-2 rounded-md bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white" data-testid="video-duration">
            {duration}
          </span>
        ) : null}
      </Link>
      <div className="mt-3 flex gap-3">
        <ChannelAvatar video={video} />
        <div className="min-w-0 flex-1">
          <h3 dir="auto" className="line-clamp-2 text-start text-sm leading-snug font-medium">
            <Link href={href} className="rounded outline-none hover:text-brand focus-visible:ring-3 focus-visible:ring-ring/50">
              {video.title}
            </Link>
          </h3>
          <p className="mt-1 truncate text-xs text-text-secondary">
            {video.channelTitle ? (
              <>
                <bdi>{video.channelTitle}</bdi> ·{" "}
              </>
            ) : null}
            {strings.feed.source}
          </p>
          {uploaded || video.viewCount !== null ? (
            <p className="truncate text-xs text-text-secondary" suppressHydrationWarning>
              {video.viewCount !== null ? (
                <>
                  <bdi>{video.viewCount.toLocaleString("ar")}</bdi> {strings.feed.views}
                  {uploaded ? " · " : ""}
                </>
              ) : null}
              {uploaded}
            </p>
          ) : null}
        </div>
        <VideoCardMenu video={video} />
      </div>
    </article>
  );
}

/** A tall card for a Short, which opens over the page so people keep their place. */
export function ExploreShortCard({ video }: { video: VideoCard }) {
  return (
    <article className="group min-w-0" data-testid="video-tile">
      <Link href={`/shorts/${video.id}`} scroll={false} className="block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <span className="block overflow-hidden rounded-xl bg-surface-elevated">
          {video.thumbnailUrl ? (
            <img src={video.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="strict-origin-when-cross-origin" className="aspect-9/16 w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transform-none" />
          ) : (
            <span className="block aspect-9/16 w-full" />
          )}
        </span>
        <span dir="auto" className="mt-2 line-clamp-2 text-start text-sm leading-snug font-medium">
          {video.title}
        </span>
      </Link>
      <p className="mt-1 truncate text-xs text-text-secondary">
        {video.channelTitle ? (
          <>
            <bdi>{video.channelTitle}</bdi> ·{" "}
          </>
        ) : null}
        {strings.feed.source}
      </p>
    </article>
  );
}

export function VideoCardSkeleton() {
  return (
    <div className="min-w-0">
      <Skeleton className="-mx-4 aspect-video rounded-none sm:mx-0 sm:rounded-xl" />
      <div className="mt-3 flex gap-3">
        <Skeleton className="size-9 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    </div>
  );
}
