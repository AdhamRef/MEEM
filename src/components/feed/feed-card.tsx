"use client";

/* eslint-disable @next/next/no-img-element -- Thumbnails load directly from YouTube by design, and aren't re-processed or re-hosted. */

import { ArrowUpLeft, ChevronDown, ChevronUp, ExternalLink, MessageCircle, MonitorPlay, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { forwardRef, type CSSProperties, type ReactNode } from "react";
import { SaveButton, ShareButton } from "@/components/video/video-actions";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import type { VideoCard } from "@/features/shorts/types";
import type { PlaybackState } from "@/hooks/useActivePlayer";
import { cn } from "@/lib/utils";
import { youtubeWatchUrl } from "@/lib/youtube/ids";

export interface FeedCardProps {
  video: VideoCard;
  isActive: boolean;
  /** Cards coming up load their thumbnails ahead of time. No player is created for them. */
  isUpcoming: boolean;
  /** The card a swipe reveals next, or the first card before anything is active. */
  isNext: boolean;
  playback: PlaybackState;
  errorCode: number | null;
  isMuted: boolean;
  isSaved: boolean;
  notice: string | null;
  hasPrevious: boolean;
  hasNext: boolean;
  onToggleSound: () => void;
  /** A tap on the video, used by the immersive layout. */
  onTapVideo: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSavedChange: (isSaved: boolean) => void;
  onNotice: (message: string) => void;
  slotRef: (element: HTMLElement | null) => void;
}

/** The real shape when known. Until then, what a video of this kind usually is. */
export const feedVideoRatio = (video: VideoCard) => video.aspectRatio ?? (video.kind === "SHORT" ? 9 / 16 : 16 / 9);

export function statusMessage(playback: PlaybackState, errorCode: number | null): string | null {
  if (playback === "ended") return strings.feed.ended;
  if (playback === "blocked") return strings.feed.autoplayBlocked;
  if (playback === "error") return errorCode === null ? strings.feed.playerLoadFailed : strings.feed.playerFailed;
  return null;
}

/** A round button with its name underneath. The names hide on short screens, where room runs out. */
function RailAction({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-0.5 [&_[data-slot=button]]:size-11 [&_[data-slot=button]]:rounded-full [&_[data-slot=button]]:bg-white/10 [&_[data-slot=button]]:text-white [&_[data-slot=button]]:hover:bg-white/20 md:[&_[data-slot=button]]:size-12 [&_svg]:size-5 md:[&_svg]:size-6">
      {children}
      {label ? (
        <span aria-hidden className="max-w-14 truncate text-[0.6875rem] leading-none text-white/80 [@media(max-height:760px)]:hidden">
          {label}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Laid out like a vertical video app, with one difference that YouTube requires: the actions
 * sit beside the player, never on top of it, because nothing may be placed in front of a
 * YouTube player. The column is also where a swipe can start for certain, since the player
 * may keep touches that begin on it.
 */
export const FeedCard = forwardRef<HTMLElement, FeedCardProps>(function FeedCard(
  { video, isActive, isUpcoming, playback, errorCode, isMuted, isSaved, notice, hasPrevious, hasNext, onToggleSound, onPrevious, onNext, onSavedChange, onNotice, slotRef },
  ref,
) {
  const message = isActive ? (statusMessage(playback, errorCode) ?? notice) : null;
  const sharePath = `/shorts/${video.id}`;
  const ctaLabel = video.cta?.label ?? strings.feed.ctaDefaults[video.cta?.type ?? "EXTERNAL_RESOURCE"];
  const ratio = feedVideoRatio(video);
  const isWide = ratio > 1;

  return (
    <article
      ref={ref}
      data-testid="feed-card"
      data-video-id={video.id}
      aria-label={video.title}
      data-shape={isWide ? "wide" : "vertical"}
      style={{ "--status": message ? "1.75rem" : "0rem" } as CSSProperties}
      className={cn(
        // Sizes against the card itself, so the video always takes the largest size that fits.
        "flex h-full snap-start snap-always flex-col bg-black text-white [container-type:size]",
        // A vertical video keeps the buttons beside it. On a phone, a wide one needs the full
        // width, so its buttons go underneath. Desktop always has room beside it.
        isWide ? "[--rail-h:4.75rem] [--rail-w:0rem] md:[--rail-h:0rem] md:[--rail-w:5.25rem]" : "[--rail-h:0rem] [--rail-w:3.75rem] md:[--rail-w:5.25rem]",
      )}
    >
      <div className={cn("flex min-h-0 flex-1 items-center justify-center md:gap-3", isWide ? "flex-col md:flex-row" : "flex-row")}>
      <div
        ref={slotRef}
        data-testid="player-slot"
        className="min-h-[200px] min-w-[200px] shrink-0 bg-black"
        style={{ aspectRatio: ratio, width: `min(calc(100cqw - var(--rail-w)), calc((100cqh - var(--rail-h) - var(--status)) * ${ratio}))` }}
      >
        {!isActive && video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt=""
            loading={isUpcoming ? "eager" : "lazy"}
            referrerPolicy="strict-origin-when-cross-origin"
            // YouTube's thumbnails are wide, with bars around a vertical video. Cropping removes the bars.
            className={cn("size-full", isWide ? "object-contain" : "object-cover")}
          />
        ) : null}
      </div>

      <div
        className={cn(
          "flex shrink-0 gap-2 overflow-auto md:gap-2.5",
          isWide ? "h-(--rail-h) w-full flex-row items-center justify-around px-1 md:h-full md:w-18 md:flex-col md:justify-end md:px-0" : "h-full w-(--rail-w) flex-col items-center justify-end py-2 md:w-18",
        )}
        data-testid="action-rail"
      >
        {video.viewCount !== null ? (
          <p className="text-center text-[0.6875rem] text-white/80" data-testid="view-count">
            <bdi>{video.viewCount.toLocaleString("ar")}</bdi> {strings.feed.views}
          </p>
        ) : null}
        {video.cta ? (
          <RailAction label={ctaLabel}>
            <Button asChild variant="default" size="icon" title={ctaLabel} data-testid="video-cta">
              {video.cta.isExternal ? (
                <a href={video.cta.href} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden />
                  <span className="sr-only">{ctaLabel}</span>
                </a>
              ) : (
                <Link href={video.cta.href}>
                  <ArrowUpLeft aria-hidden />
                  <span className="sr-only">{ctaLabel}</span>
                </Link>
              )}
            </Button>
          </RailAction>
        ) : null}
        <RailAction label={isMuted ? strings.feed.soundOffLabel : strings.feed.soundOnLabel}>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSound}
            disabled={!isActive}
            aria-label={isMuted ? strings.feed.soundOn : strings.feed.soundOff}
            title={isMuted ? strings.feed.soundOn : strings.feed.soundOff}
            data-testid="sound"
          >
            {isMuted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
          </Button>
        </RailAction>
        <RailAction label={isSaved ? strings.feed.saved : strings.feed.save}>
          <SaveButton videoId={video.id} isSaved={isSaved} callbackPath={sharePath} onChange={onSavedChange} onFailure={onNotice} />
        </RailAction>
        <RailAction label={strings.feed.comments}>
          <Button asChild variant="ghost" size="icon" aria-label={strings.feed.comments} title={strings.feed.comments}>
            <Link href={`/videos/${video.id}#comments`}>
              <MessageCircle aria-hidden />
            </Link>
          </Button>
        </RailAction>
        <RailAction label={strings.feed.share}>
          <ShareButton path={sharePath} title={video.title} onResult={onNotice} />
        </RailAction>
        {/* YouTube must be credited on each item, and the player alone may not always show it. */}
        <div data-testid="youtube-attribution">
          <RailAction label="YouTube">
            <Button asChild variant="ghost" size="icon" title={strings.feed.watchOnYouTube}>
              <a href={youtubeWatchUrl(video.youtubeVideoId)} target="_blank" rel="noopener noreferrer">
                <MonitorPlay aria-hidden />
                <span className="sr-only">
                  {video.channelTitle ? <bdi>{video.channelTitle}</bdi> : null} {strings.feed.source} {strings.feed.watchOnYouTube}
                </span>
              </a>
            </Button>
          </RailAction>
        </div>
        <RailAction>
          <Button variant="ghost" size="icon" onClick={onPrevious} disabled={!hasPrevious} aria-label={strings.feed.previous} title={strings.feed.previous} data-testid="previous">
            <ChevronUp aria-hidden />
          </Button>
        </RailAction>
        <RailAction>
          <Button
            variant={isActive && playback === "ended" ? "default" : "ghost"}
            size="icon"
            onClick={onNext}
            disabled={!hasNext}
            aria-label={strings.feed.next}
            title={strings.feed.next}
            data-testid="next"
          >
            <ChevronDown aria-hidden />
          </Button>
        </RailAction>
      </div>

      </div>

      {/* The player shows its own title and channel, so the video gets this room. Screen readers still need them. */}
      <div className="sr-only">
        <h2 dir="auto">{video.title}</h2>
        {video.channelTitle ? <p dir="auto">{video.channelTitle}</p> : null}
        {video.category ? <p>{video.category.title}</p> : null}
        {video.topics.length ? <p>{video.topics.slice(0, 2).join("، ")}</p> : null}
      </div>

      {/* Only takes up room when there's something to say. */}
      <div role="status" className={cn("flex h-(--status) shrink-0 items-center justify-center px-3 text-xs text-white/80", !message && "sr-only")} data-testid="card-status">
        {message}
      </div>
    </article>
  );
});
