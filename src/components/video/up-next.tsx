"use client";

/* eslint-disable @next/next/no-img-element -- Thumbnails load directly from YouTube by design, and aren't re-processed or re-hosted. */
import { Play, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import type { VideoCard } from "@/features/shorts/types";
import { formatCount, formatDuration, formatTimeAgo } from "@/lib/format/video-time";
import { cn } from "@/lib/utils";

const w = strings.watch;
const COUNTDOWN_SECONDS = 6;

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

/** Over the ended video: what plays next, with a countdown that can be stopped or skipped. */
export function AutoplayCountdown({ next, onPlay, onCancel }: { next: VideoCard; onPlay: () => void; onCancel: () => void }) {
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    if (remaining <= 0) {
      onPlay();
      return;
    }
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, onPlay]);

  return (
    <div className="flex size-full items-center justify-center bg-black/75 p-4 text-white backdrop-blur-sm" data-testid="autoplay-countdown">
      <div className="w-full max-w-sm space-y-3 text-center">
        <p className="text-sm text-white/80" aria-live="polite">
          {w.nextIn(remaining)}
        </p>
        <div className="flex items-center gap-3 text-start">
          {next.thumbnailUrl ? <img src={next.thumbnailUrl} alt="" decoding="async" referrerPolicy="strict-origin-when-cross-origin" className="aspect-video w-32 shrink-0 rounded-lg object-cover" /> : null}
          <div className="min-w-0">
            <p dir="auto" className="line-clamp-2 text-sm font-semibold">
              {next.title}
            </p>
            {next.channelTitle ? <p className="truncate text-xs text-white/70">{next.channelTitle}</p> : null}
          </div>
        </div>
        <div className="flex justify-center gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} data-testid="autoplay-cancel">
            <X aria-hidden data-icon="inline-start" />
            {w.cancel}
          </Button>
          <Button type="button" onClick={onPlay} data-testid="autoplay-play">
            <Play aria-hidden data-icon="inline-start" className="fill-current" />
            {w.playNow}
          </Button>
        </div>
      </div>
    </div>
  );
}
