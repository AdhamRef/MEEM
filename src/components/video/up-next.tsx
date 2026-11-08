"use client";

/* eslint-disable @next/next/no-img-element -- Thumbnails load directly from YouTube by design, and aren't re-processed or re-hosted. */
import Link from "next/link";
import { strings } from "@/config/strings.ar";
import type { VideoCard } from "@/features/shorts/types";
import { formatCount, formatDuration, formatTimeAgo } from "@/lib/format/video-time";
import { cn } from "@/lib/utils";

const w = strings.watch;

/** A compact row, as in YouTube's side column: thumbnail with its length, then title, channel, and age. */
export function UpNextItem({ video, now }: { video: VideoCard; now: Date }) {
  const duration = formatDuration(video.durationSeconds);
  const uploaded = formatTimeAgo(video.uploadedAt, now);
  return (
    <li>
      <Link href={`/videos/${video.id}`} className="group flex gap-2.5 rounded-xl p-1 outline-none hover:bg-surface-elevated focus-visible:ring-3 focus-visible:ring-ring/50" data-testid="up-next-item">
        <span className="relative w-40 shrink-0 overflow-hidden rounded-lg bg-surface-elevated sm:w-44">
          {video.thumbnailUrl ? (
            <img src={video.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="strict-origin-when-cross-origin" className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-[1.04] motion-reduce:transform-none" />
          ) : (
            <span className="block aspect-video w-full" />
          )}
          {duration ? (
            <span dir="ltr" className="absolute end-1 bottom-1 rounded bg-black/80 px-1 py-px text-[11px] font-medium text-white">
              {duration}
            </span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1 py-0.5">
          <span dir="auto" className="line-clamp-2 text-start text-sm leading-snug font-medium group-hover:text-brand">
            {video.title}
          </span>
          <span className="mt-1 block truncate text-xs text-text-secondary">
            {video.channelTitle ? <bdi>{video.channelTitle}</bdi> : null}
            {video.channelTitle ? " · " : ""}
            {strings.feed.source}
          </span>
          {uploaded || video.viewCount !== null ? (
            <span className="block truncate text-xs text-text-secondary" suppressHydrationWarning>
              {video.viewCount !== null ? `${formatCount(video.viewCount)} ${strings.feed.views}` : null}
              {video.viewCount !== null && uploaded ? " · " : ""}
              {uploaded}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

export function AutoplaySwitch({ isOn, onChange }: { isOn: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-text-secondary">
      <span>{w.autoplay}</span>
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label={isOn ? w.autoplayOn : w.autoplayOff}
        onClick={() => onChange(!isOn)}
        className={cn("relative inline-flex h-6 w-10 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50", isOn ? "bg-brand" : "bg-surface-elevated")}
        data-testid="autoplay-switch"
      >
        <span className={cn("absolute size-5 rounded-full bg-white shadow transition-[inset-inline-start]", isOn ? "start-[1.125rem]" : "start-0.5")} />
      </button>
    </label>
  );
}
