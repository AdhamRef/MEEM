"use client";

/* eslint-disable @next/next/no-img-element -- Thumbnails load directly from YouTube by design, and aren't re-processed or re-hosted. */

import { ArrowUpLeft, ChevronDown, ChevronUp, ExternalLink, MessageCircle, MonitorPlay, Play, ThumbsUp, Tv, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { forwardRef, type CSSProperties, type ReactNode } from "react";
import { BrandMark } from "@/components/shared/brand-mark";
import { SaveButton, ShareButton } from "@/components/video/video-actions";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { formatCount } from "@/lib/format/video-time";
import { cn } from "@/lib/utils";
import { youtubeWatchUrl } from "@/lib/youtube/ids";
import { feedVideoRatio, statusMessage, type FeedCardProps } from "./feed-card";

function RailAction({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-0.5 [&_[data-slot=button]]:size-11 [&_[data-slot=button]]:rounded-full [&_[data-slot=button]]:bg-black/45 [&_[data-slot=button]]:text-white [&_[data-slot=button]]:backdrop-blur-sm [&_[data-slot=button]]:hover:bg-black/65 md:[&_[data-slot=button]]:size-12 md:[&_[data-slot=button]]:bg-white/10 [&_svg]:size-6">
      {children}
      {label ? (
        <span aria-hidden className="max-w-14 truncate text-[0.6875rem] leading-none font-medium text-white drop-shadow-sm [@media(max-height:680px)]:hidden">
          {label}
        </span>
      ) : null}
    </div>
  );
}

/**
 * OWNER'S DECISION, 2026-11-05: this layout deliberately doesn't follow YouTube's rules. Our
 * interface sits in front of the player, and a layer takes its touches and clicks, so YouTube's
 * own interface stays out of sight and swiping works. See FEED_IMMERSIVE_OVERLAY.
 */
export const ImmersiveFeedCard = forwardRef<HTMLElement, FeedCardProps>(function ImmersiveFeedCard(
  { video, isActive, isUpcoming, isNext, playback, errorCode, isMuted, isSoundLocked = false, isLeaving = false, isSaved, notice, hasPrevious, hasNext, onToggleSound, onTapVideo, onPrevious, onNext, onSavedChange, onNotice, slotRef },
  ref,
) {
  const message = isActive ? (statusMessage(playback, errorCode) ?? notice) : null;
  const sharePath = `/shorts/${video.id}`;
  const ctaLabel = video.cta?.label ?? strings.feed.ctaDefaults[video.cta?.type ?? "EXTERNAL_RESOURCE"];
  const ratio = feedVideoRatio(video);
  const isWide = ratio > 1;
  // The thumbnail stays until the first frame, so nobody sees a loading player.
  const showPoster = !isLeaving && (!isActive || (playback !== "playing" && playback !== "paused"));
  // Only on the card that's waiting, and its styles keep it out of sight unless the wait gets long.
  const showLoader = isActive && (playback === "loading" || playback === "idle");

  return (
    <article
      ref={ref}
      data-testid="feed-card"
      data-video-id={video.id}
      data-shape={isWide ? "wide" : "vertical"}
      aria-label={video.title}
      className="relative flex h-full snap-start snap-always items-center justify-center text-white md:gap-3"
      style={{ "--r": ratio } as CSSProperties}
    >
      <div
        data-testid="feed-stage"
        className="absolute inset-0 md:relative md:inset-auto md:aspect-(--r) md:w-[min(calc(100cqw-6rem),calc(100cqh*var(--r)))]"
      >
        <div
          ref={slotRef}
          data-testid="player-slot"
          className={cn("absolute inset-x-0 md:top-0 md:h-full", isWide ? "top-[calc(50%-50cqw/var(--r))] aspect-(--r) md:aspect-auto" : "top-0 h-full")}
        >
          {video.thumbnailUrl ? (
            <img
              src={video.thumbnailUrl}
              alt=""
              loading={isActive || isUpcoming || isNext ? "eager" : "lazy"}
              fetchPriority={isActive || isNext ? "high" : "auto"}
              decoding="async"
              referrerPolicy="strict-origin-when-cross-origin"
              data-testid="feed-poster"
              data-visible={showPoster}
              // Above the player, at the video's own size. YouTube's thumbnails have bars around a
              // vertical video, which cropping to its shape removes. It goes at once, with no fade.
              className={cn("absolute inset-0 z-20 m-auto aspect-(--r) w-[min(100%,calc(100cqh*var(--r)))] object-cover", (isActive || isNext) && showPoster && "feed-poster-drift", showPoster ? "opacity-100" : "pointer-events-none opacity-0")}
            />
          ) : showPoster ? (
            <div aria-hidden className="absolute inset-0 z-20 bg-black" />
          ) : null}
        </div>

        {/* Takes touches and clicks, so YouTube's interface stays hidden and a swipe scrolls the feed. */}
        <button
          type="button"
          onClick={onTapVideo}
          disabled={!isActive}
          aria-label={isMuted ? strings.feed.soundOn : playback === "paused" ? strings.feed.playVideo : strings.feed.pauseVideo}
          data-testid="video-tap"
          className="absolute inset-0 z-20 flex items-center justify-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          {showLoader ? (
            <span aria-hidden className="feed-loader-late absolute flex size-20 items-center justify-center rounded-full bg-black/60" data-testid="video-loader">
              <span className="feed-loader-ring absolute inset-0 rounded-full" />
              <BrandMark className="feed-loader-logo size-12" />
            </span>
          ) : null}
          {isActive && (playback === "paused" || playback === "blocked") ? (
            <span className="feed-pop flex size-20 items-center justify-center rounded-full bg-black/45" data-testid="paused-indicator">
              <Play aria-hidden className="ms-1 size-10 fill-white" />
            </span>
          ) : null}
        </button>

        {isActive && isSoundLocked ? (
          <p className="pointer-events-none absolute inset-x-0 top-[calc(var(--feed-tabs-height)+0.75rem)] z-30 flex justify-center" data-testid="sound-hint">
            <span className="feed-pop flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium backdrop-blur-sm">
              <VolumeX aria-hidden className="size-4" />
              {strings.feed.tapForSound}
            </span>
          </p>
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col gap-1.5 bg-linear-to-t from-black/75 to-transparent ps-3 pe-16 pt-16 pb-3 md:pe-3" data-testid="feed-caption">
          <div className="flex min-w-0 items-center gap-2">
            {video.channelImageUrl ? (
              <img src={video.channelImageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-9 shrink-0 rounded-full border border-white/30 object-cover" />
            ) : (
              <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15">
                <Tv className="size-4" strokeWidth={1.5} />
              </span>
            )}
            <p className="min-w-0 flex-1 truncate text-sm font-semibold drop-shadow-sm">
              <bdi>{video.channelTitle}</bdi>
            </p>
          </div>
          <h2 dir="auto" className="line-clamp-2 text-start text-sm leading-snug drop-shadow-sm">
            {video.title}
          </h2>
          {video.topics[0] ? <p className="text-xs text-white/85">{video.topics[0].title}</p> : null}
          {video.viewCount !== null ? (
            <p className="text-xs text-white/85" data-testid="view-count">
              <bdi>{video.viewCount.toLocaleString("ar")}</bdi> {strings.feed.views}
            </p>
          ) : null}
          {message ? (
            <p role="status" className="text-xs text-white" data-testid="card-status">
              {message}
            </p>
          ) : (
            <span role="status" className="sr-only" data-testid="card-status" />
          )}
        </div>
      </div>

      <div className="absolute end-1 bottom-2 z-30 flex w-14 flex-col items-center gap-2 md:static md:h-full md:w-18 md:justify-end md:py-3" data-testid="action-rail">
        {video.cta ? (
          <RailAction label={ctaLabel}>
            <Button asChild size="icon" title={ctaLabel} data-testid="video-cta">
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
          <Button variant="ghost" size="icon" onClick={onToggleSound} disabled={!isActive} aria-label={isMuted ? strings.feed.soundOn : strings.feed.soundOff} title={isMuted ? strings.feed.soundOn : strings.feed.soundOff} data-testid="sound">
            {isMuted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
          </Button>
        </RailAction>
        <RailAction label={isSaved ? strings.feed.saved : strings.feed.save}>
          <SaveButton videoId={video.id} isSaved={isSaved} callbackPath={sharePath} onChange={onSavedChange} onFailure={onNotice} />
        </RailAction>
        {video.likeCount !== null ? (
          // A stored count from YouTube, and not a button, since nothing can be liked from here.
          <RailAction label={formatCount(video.likeCount)}>
            <span data-slot="button" role="img" aria-label={`${video.likeCount} ${strings.feed.likes}`} className="inline-flex items-center justify-center" data-testid="feed-likes">
              <ThumbsUp aria-hidden />
            </span>
          </RailAction>
        ) : null}
        <RailAction label={video.commentCount !== null ? formatCount(video.commentCount) : strings.feed.comments}>
          <Button asChild variant="ghost" size="icon" aria-label={strings.feed.comments} title={strings.feed.comments}>
            <Link href={`/videos/${video.id}#comments`}>
              <MessageCircle aria-hidden />
            </Link>
          </Button>
        </RailAction>
        <RailAction label={strings.feed.share}>
          <ShareButton path={sharePath} title={video.title} onResult={onNotice} />
        </RailAction>
        {/* YouTube stays credited on each video, and one tap away. */}
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
        <div className="hidden flex-col items-center gap-2 md:flex">
          <RailAction>
            <Button variant="ghost" size="icon" onClick={onPrevious} disabled={!hasPrevious} aria-label={strings.feed.previous} title={strings.feed.previous} data-testid="previous">
              <ChevronUp aria-hidden />
            </Button>
          </RailAction>
          <RailAction>
            <Button variant="ghost" size="icon" onClick={onNext} disabled={!hasNext} aria-label={strings.feed.next} title={strings.feed.next} data-testid="next">
              <ChevronDown aria-hidden />
            </Button>
          </RailAction>
        </div>
      </div>
    </article>
  );
});
