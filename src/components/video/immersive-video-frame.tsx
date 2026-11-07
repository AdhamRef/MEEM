"use client";

/* eslint-disable @next/next/no-img-element -- Thumbnails load directly from YouTube by design, and aren't re-processed or re-hosted. */

import { Maximize, Minimize, Pause, Play, RectangleHorizontal, RotateCcw, Square, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { BrandMark } from "@/components/shared/brand-mark";
import { Button } from "@/components/ui/button";
import { FEED_CROP_PIXELS } from "@/config/feed";
import { strings } from "@/config/strings.ar";
import { formatDuration } from "@/features/playlists/rules";
import { chapterAt, type Chapter } from "@/features/shorts/description";
import type { VideoCard } from "@/features/shorts/types";
import type { PlaybackState } from "@/hooks/useActivePlayer";
import { cn } from "@/lib/utils";

interface ImmersiveVideoFrameProps {
  mountRef: RefObject<HTMLDivElement | null>;
  video: VideoCard;
  state: PlaybackState;
  isMuted: boolean;
  getPosition: () => { positionSeconds: number; durationSeconds: number | null } | null;
  resumeAt: (seconds: number) => void;
  toggleSound: () => void;
  togglePlay: () => void;
  setPlaybackRate?: (rate: number) => void;
  /** Offered for long videos, where the page has room to widen the player. */
  isTheater?: boolean;
  onToggleTheater?: () => void;
  chapters?: Chapter[];
  /** Shown over the ended video, such as what plays next. */
  endScreen?: ReactNode;
  className?: string;
}

const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2, 0.75] as const;
const SEEK_STEP = 5;
const LONG_SEEK_STEP = 10;

/** Typing in a field, or a shortcut meant for something else, mustn't control the video. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.closest("[role=dialog],[role=menu]") !== null;
}

const CONTROLS_HIDE_MS = 3000;
const POSITION_CHECK_MS = 250;
const subscribeToNothing = () => () => {};
const clock = (seconds: number) => formatDuration(Math.floor(seconds)) ?? "0:00";

/**
 * OWNER'S DECISION, 2026-11-06, under FEED_IMMERSIVE_OVERLAY: a video page's player, with YouTube's
 * interface cropped out of view and our own controls in front. It stays at the top while the page
 * scrolls. Every control works through YouTube's documented player methods.
 */
export function ImmersiveVideoFrame({ mountRef, video, state, isMuted, getPosition, resumeAt, toggleSound, togglePlay, setPlaybackRate, isTheater = false, onToggleTheater, chapters = [], endScreen, className }: ImmersiveVideoFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ positionSeconds: 0, durationSeconds: video.durationSeconds });
  const [areControlsShown, setAreControlsShown] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rateIndex, setRateIndex] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // iPhones have no fullscreen for page elements, so the button isn't offered there.
  const canFullscreen = useSyncExternalStore(subscribeToNothing, () => document.fullscreenEnabled === true, () => false);

  const ratio = video.aspectRatio ?? (video.kind === "SHORT" ? 9 / 16 : 16 / 9);
  const isPlaying = state === "playing";
  const showPoster = state === "idle" || state === "loading" || state === "blocked" || state === "ended";

  // Only the frame's height grows, which is where YouTube's bars land and get clipped.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const fit = () => {
      const box = mount.getBoundingClientRect();
      const videoWidth = Math.min(box.width, box.height * ratio);
      mount.style.setProperty("--frame-w", `${videoWidth}px`);
      mount.style.setProperty("--frame-h", `${videoWidth / ratio + 2 * FEED_CROP_PIXELS}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(mount);
    return () => observer.disconnect();
  }, [mountRef, ratio]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      const current = getPosition();
      if (current) setPosition((previous) => ({ positionSeconds: current.positionSeconds, durationSeconds: current.durationSeconds ?? previous.durationSeconds }));
    }, POSITION_CHECK_MS);
    return () => clearInterval(timer);
  }, [isPlaying, getPosition]);

  const revealControls = useCallback(() => {
    setAreControlsShown(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setAreControlsShown(false), CONTROLS_HIDE_MS);
  }, []);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const onTap = () => {
    // On a touch screen, the first tap brings the controls back, as hidden ones can't be aimed at.
    if (!areControlsShown && isPlaying && window.matchMedia("(pointer: coarse)").matches) {
      revealControls();
      return;
    }
    revealControls();
    if (state === "ended") resumeAt(0);
    else togglePlay();
  };

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frameRef.current?.requestFullscreen();
  }, []);

  const cycleRate = () => {
    const next = (rateIndex + 1) % PLAYBACK_RATES.length;
    setRateIndex(next);
    setPlaybackRate?.(PLAYBACK_RATES[next]!);
    revealControls();
  };

  const seekBy = useCallback(
    (delta: number) => {
      const current = getPosition();
      if (!current) return;
      const end = current.durationSeconds ?? Number.POSITIVE_INFINITY;
      const target = Math.max(0, Math.min(end - 1, current.positionSeconds + delta));
      setPosition((previous) => ({ ...previous, positionSeconds: target }));
      resumeAt(target);
      revealControls();
    },
    [getPosition, resumeAt, revealControls],
  );

  // The shortcuts people know from YouTube. Arrows follow the seek bar, which runs left to right.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const actions: Record<string, () => void> = {
        " ": togglePlay,
        k: togglePlay,
        m: toggleSound,
        arrowright: () => seekBy(SEEK_STEP),
        arrowleft: () => seekBy(-SEEK_STEP),
        l: () => seekBy(LONG_SEEK_STEP),
        j: () => seekBy(-LONG_SEEK_STEP),
        ...(canFullscreen ? { f: toggleFullscreen } : {}),
        ...(onToggleTheater ? { t: onToggleTheater } : {}),
      };
      const action = actions[key];
      if (!action) return;
      // A space on a focused button already presses it.
      if (key === " " && event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      action();
      revealControls();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, toggleSound, seekBy, toggleFullscreen, canFullscreen, onToggleTheater, revealControls]);

  const chapterIndex = chapterAt(chapters, position.positionSeconds);
  const currentChapter = chapterIndex >= 0 ? chapters[chapterIndex] : undefined;
  const rate = PLAYBACK_RATES[rateIndex]!;

  const isVisible = areControlsShown || !isPlaying;
  const duration = position.durationSeconds ?? 0;
  const iconClass = "size-10 rounded-full text-white hover:bg-white/15 hover:text-white";

  return (
    <div
      ref={frameRef}
      data-testid="video-frame"
      onPointerMove={(event) => {
        if (event.pointerType === "mouse") revealControls();
      }}
      className={cn("sticky top-(--top-bar-height) z-20 mx-auto w-full overflow-hidden bg-black md:top-0", isTheater ? "md:rounded-none" : "md:rounded-xl", video.kind === "SHORT" ? "aspect-9/16 max-h-[75dvh] min-h-[200px] max-w-full" : "aspect-video min-h-[200px]", className)}
    >
      <div ref={mountRef} data-testid="player-mount" data-immersive-player className="absolute inset-0 overflow-hidden bg-black" />

      {video.thumbnailUrl && showPoster ? <img src={video.thumbnailUrl} alt="" decoding="async" referrerPolicy="strict-origin-when-cross-origin" data-testid="video-poster" className="absolute inset-0 z-10 size-full object-cover" /> : null}

      {/* Takes touches and clicks, so YouTube's interface stays out of sight. */}
      <button
        type="button"
        onClick={onTap}
        aria-label={state === "ended" ? strings.feed.replay : isPlaying ? strings.feed.pauseVideo : strings.feed.playVideo}
        data-testid="video-tap"
        className="absolute inset-0 z-20 flex items-center justify-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        {state === "loading" || state === "idle" ? (
          <span aria-hidden className="feed-loader-late absolute flex size-16 items-center justify-center rounded-full bg-black/60" data-testid="video-loader">
            <span className="feed-loader-ring absolute inset-0 rounded-full" />
            <BrandMark className="feed-loader-logo size-10" />
          </span>
        ) : null}
        {state === "paused" || state === "blocked" ? (
          <span className="feed-pop flex size-16 items-center justify-center rounded-full bg-black/55" data-testid="paused-indicator">
            <Play aria-hidden className="ms-1 size-8 fill-white text-white" />
          </span>
        ) : null}
        {state === "ended" ? (
          <span className="feed-pop flex size-16 items-center justify-center rounded-full bg-black/55" data-testid="replay-indicator">
            <RotateCcw aria-hidden className="size-8 text-white" />
          </span>
        ) : null}
      </button>

      {state === "ended" && endScreen ? <div className="absolute inset-0 z-40">{endScreen}</div> : null}

      <div
        data-testid="video-controls"
        className={cn("absolute inset-x-0 bottom-0 z-30 flex items-center gap-1 bg-linear-to-t from-black/80 to-transparent px-2 pt-8 pb-1 text-white transition-opacity duration-200", isVisible ? "opacity-100" : "pointer-events-none opacity-0")}
      >
        <Button type="button" variant="ghost" size="icon" className={iconClass} aria-label={isPlaying ? strings.feed.pauseVideo : strings.feed.playVideo} onClick={togglePlay} data-testid="control-play">
          {isPlaying ? <Pause aria-hidden className="fill-current" /> : <Play aria-hidden className="fill-current" />}
        </Button>
        <input
          type="range"
          dir="ltr"
          min={0}
          max={duration}
          step={1}
          value={Math.min(position.positionSeconds, duration)}
          disabled={duration === 0}
          aria-label={strings.feed.seek}
          aria-valuetext={clock(position.positionSeconds)}
          data-testid="control-seek"
          onChange={(event) => {
            const seconds = Number(event.target.value);
            setPosition((previous) => ({ ...previous, positionSeconds: seconds }));
            resumeAt(seconds);
            revealControls();
          }}
          className="h-1 min-w-0 flex-1 cursor-pointer accent-(--accent)"
        />
        <bdi dir="ltr" className="shrink-0 px-1 text-xs tabular-nums" data-testid="control-time">
          {clock(position.positionSeconds)} / {clock(duration)}
        </bdi>
        {currentChapter ? (
          <span dir="auto" className="hidden max-w-48 truncate px-1 text-xs text-white/85 sm:inline" data-testid="control-chapter">
            {currentChapter.title}
          </span>
        ) : null}
        {setPlaybackRate && video.kind === "LONG_FORM" ? (
          <Button type="button" variant="ghost" className="h-10 min-w-12 shrink-0 rounded-full px-2 text-xs font-semibold text-white tabular-nums hover:bg-white/15 hover:text-white" aria-label={strings.watch.speed(`${rate}×`)} onClick={cycleRate} data-testid="control-speed">
            <bdi dir="ltr">{rate}×</bdi>
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon" className={iconClass} aria-label={isMuted ? strings.feed.soundOn : strings.feed.soundOff} onClick={toggleSound} data-testid="sound">
          {isMuted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
        </Button>
        {onToggleTheater && !isFullscreen ? (
          <Button type="button" variant="ghost" size="icon" className={cn(iconClass, "hidden md:inline-flex")} aria-label={isTheater ? strings.watch.exitTheater : strings.watch.theater} aria-pressed={isTheater} onClick={onToggleTheater} data-testid="control-theater">
            {isTheater ? <Square aria-hidden /> : <RectangleHorizontal aria-hidden />}
          </Button>
        ) : null}
        {canFullscreen ? (
          <Button type="button" variant="ghost" size="icon" className={iconClass} aria-label={isFullscreen ? strings.feed.exitFullscreen : strings.feed.enterFullscreen} onClick={toggleFullscreen} data-testid="control-fullscreen">
            {isFullscreen ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
