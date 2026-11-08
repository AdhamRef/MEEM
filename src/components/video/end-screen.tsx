"use client";

/* eslint-disable @next/next/no-img-element -- Thumbnails load directly from YouTube by design, and aren't re-processed or re-hosted. */
import { RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { strings } from "@/config/strings.ar";
import type { VideoCard } from "@/features/shorts/types";
import { formatDuration } from "@/lib/format/video-time";
import { cn } from "@/lib/utils";
import { AutoplaySwitch } from "./up-next";

const w = strings.watch;
const COUNTDOWN_SECONDS = 8;
const RING_RADIUS = 18;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
export const END_SCREEN_COUNT = 6;

interface EndScreenProps {
  suggestions: VideoCard[];
  isAutoplayOn: boolean;
  onAutoplayChange: (next: boolean) => void;
  onReplay: () => void;
  onPlay: (video: VideoCard) => void;
}

/**
 * Over the finished video, under the owner's exception for video pages (FEED_IMMERSIVE_OVERLAY):
 * six suggestions on a blurred backdrop, as YouTube shows them. With autoplay on, the first one
 * counts down and plays, unless the countdown is stopped.
 */
export function EndScreen({ suggestions, isAutoplayOn, onAutoplayChange, onReplay, onPlay }: EndScreenProps) {
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);
  const [isStopped, setIsStopped] = useState(false);
  const next = suggestions[0];
  const isCounting = isAutoplayOn && !isStopped && next !== undefined;

  useEffect(() => {
    if (!isCounting) return;
    if (remaining <= 0) {
      onPlay(next);
      return;
    }
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [isCounting, remaining, next, onPlay]);

  return (
    <div className="flex size-full flex-col gap-2 overflow-hidden bg-black/55 p-2.5 text-white backdrop-blur-xl sm:gap-3 sm:p-4" data-testid="end-screen">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold sm:text-base">{w.endTitle}</p>
        <div className="flex items-center gap-1">
          <div className="hidden text-white/80 sm:block">
            <AutoplaySwitch
              isOn={isAutoplayOn}
              onChange={(value) => {
                setIsStopped(false);
                setRemaining(COUNTDOWN_SECONDS);
                onAutoplayChange(value);
              }}
            />
          </div>
          <button type="button" onClick={onReplay} className="flex h-9 items-center gap-1.5 rounded-full bg-white/15 px-3 text-xs font-semibold outline-none transition-colors hover:bg-white/25 focus-visible:ring-3 focus-visible:ring-ring/50" data-testid="end-replay">
            <RotateCcw aria-hidden className="size-4" />
            {w.replay}
          </button>
        </div>
      </div>

      <ul className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        {suggestions.slice(0, END_SCREEN_COUNT).map((video, index) => {
          const isNext = index === 0 && isCounting;
          const duration = formatDuration(video.durationSeconds);
          return (
            // Two on a phone, where the player is short. All six from a small tablet up.
            <li key={video.id} className={cn("relative min-h-0", index > 1 && "max-sm:hidden")}>
              <Link
                href={`/videos/${video.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  onPlay(video);
                }}
                className={cn(
                  "group relative flex size-full overflow-hidden rounded-xl bg-white/10 outline-none ring-1 ring-white/10 transition-transform duration-300 hover:scale-[1.03] focus-visible:ring-3 focus-visible:ring-ring/60 motion-reduce:transform-none",
                  isNext && "ring-2 ring-white",
                )}
                data-testid="end-suggestion"
              >
                {video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="strict-origin-when-cross-origin" className="absolute inset-0 size-full object-cover" /> : null}
                <span aria-hidden className="absolute inset-0 bg-linear-to-t from-black/90 via-black/30 to-transparent" />
                {duration ? (
                  <span dir="ltr" className="absolute end-1.5 top-1.5 rounded bg-black/75 px-1 text-[10px] font-semibold">
                    {duration}
                  </span>
                ) : null}
                <span className="relative mt-auto w-full p-2">
                  <span dir="auto" className="line-clamp-2 text-start text-[11px] leading-snug font-semibold sm:text-xs">
                    {video.title}
                  </span>
                  {video.channelTitle ? <span className="mt-0.5 block truncate text-[10px] text-white/70">{video.channelTitle}</span> : null}
                </span>

                {isNext ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/35" aria-live="polite">
                    <span className="relative flex size-12 items-center justify-center">
                      <svg aria-hidden viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
                        <circle cx="22" cy="22" r={RING_RADIUS} fill="none" stroke="rgb(255 255 255 / 0.25)" strokeWidth="3" />
                        <circle
                          cx="22"
                          cy="22"
                          r={RING_RADIUS}
                          fill="none"
                          stroke="white"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeDasharray={RING_LENGTH}
                          strokeDashoffset={RING_LENGTH * (remaining / COUNTDOWN_SECONDS)}
                          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
                        />
                      </svg>
                      <span className="text-sm font-bold tabular-nums">{remaining}</span>
                    </span>
                    <span className="sr-only">{w.autoplayNext(remaining)}</span>
                  </span>
                ) : null}
              </Link>
              {isNext ? (
                <button
                  type="button"
                  aria-label={w.cancel}
                  onClick={() => setIsStopped(true)}
                  className="absolute start-1.5 top-1.5 z-10 flex size-7 items-center justify-center rounded-full bg-black/70 outline-none hover:bg-black focus-visible:ring-3 focus-visible:ring-ring/50"
                  data-testid="end-cancel"
                >
                  <X aria-hidden className="size-4" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
