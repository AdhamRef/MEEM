"use client";

/* eslint-disable @next/next/no-img-element -- Channel images load directly from YouTube by design. */
import { ExternalLink, Keyboard, RectangleHorizontal, RotateCcw, Square, Tv } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ExploreShortCard } from "@/components/explore/explore-cards";
import { Button } from "@/components/ui/button";
import { FEED_IMMERSIVE_OVERLAY } from "@/config/feed";
import { strings } from "@/config/strings.ar";
import { recordGuestSignal } from "@/features/recommendations/guest-signals";
import { useRecordView } from "@/components/knowledge/view-recorder";
import { signalFromWatch } from "@/features/recommendations/watch-rules";
import { formatDuration, resumePosition } from "@/features/playlists/rules";
import { extractChapters } from "@/features/shorts/description";
import type { VideoCard } from "@/features/shorts/types";
import { useActivePlayer } from "@/hooks/useActivePlayer";
import { cn } from "@/lib/utils";
import { ImmersiveVideoFrame } from "./immersive-video-frame";
import { EndScreen } from "./end-screen";
import { AutoplaySwitch, UpNextItem } from "./up-next";
import { SaveButton, ShareButton, YouTubeAttribution } from "./video-actions";
import { VideoDescription } from "./video-description";
import { YouTubeComments } from "./youtube-comments";

const w = strings.watch;
const THEATER_KEY = "watch.theater";
const AUTOPLAY_KEY = "watch.autoplay";
const THEATER_WIDTH = "lg:w-[min(100%,calc((100dvh-9rem)*16/9))]";

/** A remembered preference. Storage can be missing or refused, and then the default applies. */
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "1";
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Kept for this visit only.
  }
}

interface VideoWatchProps {
  video: VideoCard;
  related?: ReactNode;
  upNext?: VideoCard[];
  channelShorts?: VideoCard[];
}

/**
 * One video on its own page, laid out like YouTube's: the player, then its title, channel, actions,
 * and description, with suggestions beside it on wide screens and below it on phones. Everything
 * shown is stored data, so the page itself spends no quota. Only comments, opened on request, do.
 *
 * OWNER'S DECISION, 2026-11-06, under the same switch as the feed (FEED_IMMERSIVE_OVERLAY):
 * YouTube's interface is cropped away, our own controls sit over the player, it starts by itself,
 * and the next video can follow automatically. With the switch off, it follows YouTube's rules:
 * the player's own controls, waiting for a click, and YouTube's end screen.
 */
export function VideoWatch({ video, related, upNext = [], channelShorts = [] }: VideoWatchProps) {
  const { status: sessionStatus } = useSession();
  const router = useRouter();
  const [now] = useState(() => new Date());
  const isLong = video.kind === "LONG_FORM";
  const mountRef = useRef<HTMLDivElement>(null);
  const [isSaved, setIsSaved] = useState(false);
  // A check that was already on its way must not undo what the person just pressed.
  const hasToggledSave = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const isGuestRef = useRef(true);
  const [isTheater, setIsTheater] = useState(false);
  const [isAutoplayOn, setIsAutoplayOn] = useState(true);
  const chapters = useMemo(() => extractChapters(video.description, video.durationSeconds), [video.description, video.durationSeconds]);
  useRecordView("VIDEO", video.id);

  useEffect(() => {
    isGuestRef.current = sessionStatus !== "authenticated";
  });

  useEffect(() => {
    // Read after hydration, so the server's render and the first one in the browser agree.
    /* eslint-disable react-hooks/set-state-in-effect -- Stored preferences, only readable in the browser. */
    setIsTheater(readFlag(THEATER_KEY, false));
    setIsAutoplayOn(readFlag(AUTOPLAY_KEY, true));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const toggleTheater = useCallback(() => {
    setIsTheater((current) => {
      writeFlag(THEATER_KEY, !current);
      return !current;
    });
  }, []);

  const changeAutoplay = (next: boolean) => {
    setIsAutoplayOn(next);
    writeFlag(AUTOPLAY_KEY, next);
  };

  const nextVideo = upNext[0];
  const playVideo = useCallback((target: VideoCard) => router.push(`/videos/${target.id}`), [router]);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    fetch(`/api/favorites?ids=${video.id}`)
      .then((response) => (response.ok ? (response.json() as Promise<{ savedIds: string[] }>) : { savedIds: [] }))
      .then(({ savedIds }) => {
        if (!hasToggledSave.current) setIsSaved(savedIds.includes(video.id));
      })
      .catch(() => {
        // Shown as not saved. Saving again is harmless.
      });
  }, [sessionStatus, video.id]);

  const handleWatchFinished = useCallback(
    (_youtubeVideoId: string, watch: { didStartPlaying: boolean; didEnd: boolean; watchedSeconds: number }) => {
      const signal = signalFromWatch({ ...watch, durationSeconds: video.durationSeconds });
      if (!signal) return;
      if (isGuestRef.current) {
        for (const topic of video.topics) recordGuestSignal(window.localStorage, topic.id, signal, new Date());
        return;
      }
      void fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: video.id, signal }),
        keepalive: true,
      }).catch(() => {});
    },
    [video],
  );

  const { state, errorCode, getPosition, resumeAt, isMuted, toggleSound, togglePlay, setPlaybackRate } = useActivePlayer({
    mountRef,
    videoId: video.youtubeVideoId,
    isInView: true,
    autoplay: FEED_IMMERSIVE_OVERLAY,
    showControls: !FEED_IMMERSIVE_OVERLAY,
    holdUntilFirstFrame: FEED_IMMERSIVE_OVERLAY,
    startWithSound: FEED_IMMERSIVE_OVERLAY,
    strategy: "recreate",
    onWatchFinished: handleWatchFinished,
  });

  // Only long videos: nobody resumes a clip of a minute.
  const tracksProgress = sessionStatus === "authenticated" && isLong;
  const [resumeSeconds, setResumeSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!tracksProgress) return;
    fetch(`/api/progress?videoId=${video.id}`)
      .then((response) => (response.ok ? (response.json() as Promise<{ progress: { positionSeconds: number; isCompleted: boolean } | null }>) : { progress: null }))
      .then(({ progress }) => setResumeSeconds(resumePosition(progress)))
      .catch(() => {
        // No resume offer. Everything else still works.
      });
  }, [tracksProgress, video.id]);

  useEffect(() => {
    if (!tracksProgress) return;
    const report = (didEnd = false) => {
      const position = getPosition();
      if (!position || (position.positionSeconds < 3 && !didEnd)) return;
      void fetch("/api/progress", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: video.id, ...position, didEnd }),
        keepalive: true,
      }).catch(() => {});
    };
    if (state === "paused") report();
    if (state === "ended") report(true);
    if (state !== "playing") return;
    const timer = setInterval(() => report(), 20_000);
    return () => {
      clearInterval(timer);
      report();
    };
  }, [tracksProgress, state, video.id, getPosition]);

  const playerMessage = state === "error" ? (errorCode === null ? strings.feed.playerLoadFailed : strings.feed.playerFailed) : null;
  const ctaLabel = video.cta?.label ?? strings.feed.ctaDefaults[video.cta?.type ?? "EXTERNAL_RESOURCE"];
  const path = `/videos/${video.id}`;
  const theaterFrame = isTheater && isLong;

  // Only where the owner's exception applies. Elsewhere YouTube's end screen stays, with no auto-skip (R5).
  const endScreen = FEED_IMMERSIVE_OVERLAY && upNext.length ? <EndScreen suggestions={upNext} isAutoplayOn={isAutoplayOn} onAutoplayChange={changeAutoplay} onReplay={() => resumeAt(0)} onPlay={playVideo} /> : undefined;

  const player = FEED_IMMERSIVE_OVERLAY ? (
    <ImmersiveVideoFrame
      mountRef={mountRef}
      video={video}
      state={state}
      isMuted={isMuted}
      getPosition={getPosition}
      resumeAt={resumeAt}
      toggleSound={toggleSound}
      togglePlay={togglePlay}
      setPlaybackRate={setPlaybackRate}
      isTheater={theaterFrame}
      onToggleTheater={isLong ? toggleTheater : undefined}
      chapters={chapters}
      endScreen={endScreen}
      className={theaterFrame ? THEATER_WIDTH : undefined}
    />
  ) : (
    <div
      ref={mountRef}
      data-testid="player-mount"
      className={cn(
        "mx-auto bg-black",
        video.kind === "SHORT" ? "aspect-9/16 max-h-[75dvh] min-h-[200px] max-w-full" : "aspect-video min-h-[200px] w-full md:overflow-hidden md:rounded-xl",
        theaterFrame && cn("md:rounded-none", THEATER_WIDTH),
      )}
    />
  );

  const sidePadding = theaterFrame ? "lg:ps-6 lg:pe-0" : "md:px-0";
  // The Short shown over another page has no suggestions, and keeps a single column.
  const hasSide = upNext.length > 0 || channelShorts.length > 0;

  return (
    <div className={cn("mx-auto w-full pb-10", theaterFrame ? "max-w-none" : hasSide ? "max-w-[1720px] md:px-4 md:pt-6 lg:px-6" : "max-w-4xl md:px-4 md:pt-6")} data-testid="video-watch" data-theater={theaterFrame || undefined}>
      {/*
        One grid, so the player keeps its place in the page and is never remounted when the layout
        changes. In theater mode it spans both columns on a black band.
      */}
      {/*
        The side column spans every row, and a tall one used to stretch them all, pushing the title
        and the comments far apart. Only the last row takes the slack now. On phones, the order is
        player, details, comments, then suggestions, as on YouTube.
      */}
      <div className={cn("flex flex-col", hasSide && "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)] lg:grid-rows-[auto_auto_1fr] lg:gap-x-6", theaterFrame && "lg:gap-y-4")}>
        {/* Pinned while the page scrolls under it, except in theater mode, where it would fill the screen. The wrapper is what sticks, because a sticky element only moves within its parent. */}
        <div className={cn("sticky top-(--top-bar-height) z-20 order-1 md:top-0 lg:order-none lg:row-start-1 lg:self-start", theaterFrame ? "bg-black lg:static lg:col-span-2" : "lg:col-start-1")}>{player}</div>

        <div className={cn("order-2 min-w-0 space-y-4 px-4 pt-3 lg:order-none lg:col-start-1 lg:row-start-2", sidePadding)}>
          <h1 dir="auto" className="text-start text-lg leading-snug font-bold sm:text-xl">
            {video.title}
          </h1>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {video.channelImageUrl ? (
                <img src={video.channelImageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-10 shrink-0 rounded-full bg-surface-elevated object-cover" />
              ) : (
                <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-text-secondary">
                  <Tv className="size-5" strokeWidth={1.5} />
                </span>
              )}
              <div className="min-w-0">
                <YouTubeAttribution youtubeVideoId={video.youtubeVideoId} channelTitle={video.channelTitle} />
                {video.likeCount !== null || video.commentCount !== null ? (
                  <p className="flex flex-wrap gap-x-3 text-xs text-text-secondary" data-testid="video-statistics">
                    {video.likeCount !== null ? (
                      <span>
                        <bdi>{video.likeCount.toLocaleString("ar")}</bdi> {strings.feed.likes}
                      </span>
                    ) : null}
                    {video.commentCount !== null ? (
                      <a href="#comments" className="rounded outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
                        <bdi>{video.commentCount.toLocaleString("ar")}</bdi> {strings.feed.commentsCount}
                      </a>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SaveButton
                withLabel
                videoId={video.id}
                isSaved={isSaved}
                callbackPath={path}
                onChange={(next) => {
                  hasToggledSave.current = true;
                  setIsSaved(next);
                }}
                onFailure={setNotice}
              />
              <ShareButton withLabel path={path} title={video.title} onResult={setNotice} />
              {isLong && !FEED_IMMERSIVE_OVERLAY ? (
                <Button type="button" variant="secondary" className="hidden rounded-full lg:inline-flex" aria-pressed={theaterFrame} onClick={toggleTheater} data-testid="theater-toggle">
                  {theaterFrame ? <Square aria-hidden data-icon="inline-start" /> : <RectangleHorizontal aria-hidden data-icon="inline-start" />}
                  {theaterFrame ? w.exitTheater : w.theater}
                </Button>
              ) : null}
              {resumeSeconds !== null ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="rounded-full"
                  onClick={() => {
                    resumeAt(resumeSeconds);
                    setResumeSeconds(null);
                  }}
                  data-testid="video-resume"
                >
                  <RotateCcw aria-hidden data-icon="inline-start" />
                  {strings.playlists.resumeFrom} <bdi dir="ltr">{formatDuration(resumeSeconds)}</bdi>
                </Button>
              ) : null}
              {video.cta ? (
                <Button asChild className="rounded-full" data-testid="video-cta">
                  {video.cta.isExternal ? (
                    <a href={video.cta.href} target="_blank" rel="noopener noreferrer">
                      {ctaLabel}
                      <ExternalLink aria-hidden data-icon="inline-end" />
                    </a>
                  ) : (
                    <Link href={video.cta.href}>{ctaLabel}</Link>
                  )}
                </Button>
              ) : null}
            </div>
          </div>

          <div role="status" className={cn("text-sm", playerMessage || notice ? "text-text-secondary" : "sr-only")}>
            {playerMessage ?? notice}
          </div>

          {video.topics.length ? (
            <ul className="flex flex-wrap gap-2" aria-label={strings.navigation.topics}>
              {video.topics.map((topic) => (
                <li key={topic.id}>
                  <Link href={`/topics/${topic.slug}`} className="inline-flex min-h-9 items-center rounded-full border bg-surface px-3 text-xs font-medium outline-none hover:bg-surface-elevated focus-visible:ring-3 focus-visible:ring-ring/50">
                    # {topic.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          <VideoDescription
            description={video.description}
            durationSeconds={video.durationSeconds}
            viewCount={video.viewCount}
            uploadedAt={video.uploadedAt}
            chapters={chapters}
            onSeek={state === "error" ? null : resumeAt}
          />

          {FEED_IMMERSIVE_OVERLAY && isLong ? (
            <details className="hidden text-xs text-text-secondary lg:block">
              <summary className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <Keyboard aria-hidden className="size-4" />
                {w.shortcuts}
              </summary>
              <p className="mt-1">{w.shortcutsList}</p>
            </details>
          ) : null}

          {related}
        </div>

        {hasSide ? (
        <aside
          aria-labelledby="up-next-title"
          className={cn("order-4 min-w-0 space-y-4 px-4 pt-6 lg:order-none lg:col-start-2 lg:self-start", theaterFrame ? "lg:row-span-2 lg:row-start-2 lg:ps-0 lg:pe-6 lg:pt-3" : "lg:row-span-3 lg:row-start-1 lg:px-0 lg:pt-0")}
          data-testid="up-next"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 id="up-next-title" className="text-base font-semibold">
              {w.suggested}
            </h2>
            {FEED_IMMERSIVE_OVERLAY && nextVideo ? <AutoplaySwitch isOn={isAutoplayOn} onChange={changeAutoplay} /> : null}
          </div>
          {upNext.length ? (
            <ol className="space-y-1" data-testid="up-next-list">
              {upNext.map((item) => (
                <UpNextItem key={item.id} video={item} now={now} />
              ))}
            </ol>
          ) : null}

          {channelShorts.length ? (
            <section aria-labelledby="channel-shorts-title" className="space-y-3 border-t pt-4" data-testid="channel-shorts">
              <h2 id="channel-shorts-title" className="text-base font-semibold">
                {w.channelShorts}
              </h2>
              <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0">
                {channelShorts.map((short) => (
                  <li key={short.id} className="w-36 shrink-0 snap-start lg:w-auto">
                    <ExploreShortCard video={short} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
        ) : null}

        <div className={cn("order-3 min-w-0 px-4 pt-6 lg:order-none lg:col-start-1 lg:row-start-3", sidePadding)}>
          <YouTubeComments videoId={video.id} youtubeVideoId={video.youtubeVideoId} />
        </div>
      </div>
    </div>
  );
}
