"use client";

/* eslint-disable @next/next/no-img-element -- Thumbnails load directly from YouTube by design, and aren't re-processed or re-hosted. */
import { Check, ChevronLeft, ChevronRight, ExternalLink, Play, RectangleHorizontal, RotateCcw, Square } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { YouTubeAttribution } from "@/components/video/video-actions";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import type { PublicPlaylistItem } from "@/features/playlists/playlists.service";
import type { PlaylistProgress } from "@/features/playlists/progress.service";
import { formatDuration, isWatchComplete, resumePosition } from "@/features/playlists/rules";
import { usePlaylistPlayer, type PlaybackReport } from "@/hooks/usePlaylistPlayer";
import { signInHref } from "@/lib/auth/callback-url";
import { cn } from "@/lib/utils";

const p = strings.playlists;
const MIN_REPORT_SECONDS = 3;

type ProgressMap = Map<string, PlaylistProgress["items"][number]>;

interface PlaylistExperienceProps {
  playlistId: string;
  /** Set for a YouTube playlist, which plays through YouTube's own playlist player. */
  youtubePlaylistId: string | null;
  path: string;
  items: PublicPlaylistItem[];
}

/** Any item can be played in any order, because nobody is held to a set path (§15.3). */
export function PlaylistExperience({ playlistId, youtubePlaylistId, path, items }: PlaylistExperienceProps) {
  const { status } = useSession();
  const isSignedIn = status === "authenticated";
  const mountRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState<ProgressMap>(new Map());
  const [lastVideoId, setLastVideoId] = useState<string | null>(null);

  const [isTheater, setIsTheater] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  const videoIdByYouTubeId = useMemo(() => new Map(items.map((item) => [item.youtubeVideoId, item.videoId])), [items]);
  const youtubeVideoIds = useMemo(() => items.map((item) => item.youtubeVideoId), [items]);

  useEffect(() => {
    if (!isSignedIn) return;
    fetch(`/api/progress?playlistId=${playlistId}`)
      .then((response) => (response.ok ? (response.json() as Promise<PlaylistProgress>) : null))
      .then((data) => {
        if (!data) return;
        setProgress(new Map(data.items.map((item) => [item.videoId, item])));
        setLastVideoId(data.lastVideoId);
      })
      .catch(() => {
        // Shown with no progress. Nothing else depends on it.
      });
  }, [isSignedIn, playlistId]);

  const isSignedInRef = useRef(isSignedIn);
  useEffect(() => {
    isSignedInRef.current = isSignedIn;
  });

  const handleReport = useCallback(
    ({ youtubeVideoId, positionSeconds, durationSeconds, didEnd }: PlaybackReport) => {
      const videoId = videoIdByYouTubeId.get(youtubeVideoId);
      if (!videoId || !isSignedInRef.current || (positionSeconds < MIN_REPORT_SECONDS && !didEnd)) return;

      setLastVideoId(videoId);
      setProgress((current) => {
        const next = new Map(current);
        const isCompleted = (current.get(videoId)?.isCompleted ?? false) || isWatchComplete(positionSeconds, durationSeconds, didEnd);
        next.set(videoId, { videoId, positionSeconds: Math.round(positionSeconds), durationSeconds: durationSeconds === null ? null : Math.round(durationSeconds), isCompleted });
        return next;
      });
      void fetch("/api/progress", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, playlistId, positionSeconds, durationSeconds, didEnd }),
        keepalive: true,
      }).catch(() => {});
    },
    [playlistId, videoIdByYouTubeId],
  );

  const { state, errorCode, currentVideoId, isReady, playVideo } = usePlaylistPlayer({ mountRef, youtubeVideoIds, youtubePlaylistId, onReport: handleReport });

  const currentIndex = Math.max(0, items.findIndex((item) => item.youtubeVideoId === currentVideoId));
  const current = items[currentIndex];
  const previous = items[currentIndex - 1];
  const next = items[currentIndex + 1];

  const lastItem = lastVideoId ? items.find((item) => item.videoId === lastVideoId) : undefined;
  const resumeSeconds = lastItem ? resumePosition(progress.get(lastItem.videoId)) : null;
  const showResume = lastItem && resumeSeconds !== null && lastItem.youtubeVideoId !== currentVideoId;

  // Keeps the playing item in view in the list, as YouTube's playlist panel does, without moving the page.
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !item) return;
    list.scrollTo({ top: item.offsetTop - list.offsetTop - 8, behavior: "smooth" });
  }, [currentVideoId]);

  const message = state === "error" ? (errorCode === null ? strings.feed.playerLoadFailed : strings.feed.playerFailed) : state === "ended" ? (next ? p.endedNext : p.endedLast) : null;

  return (
    <div className={cn("lg:grid lg:items-start lg:gap-6", isTheater ? "lg:grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]")} data-testid="playlist-experience" data-theater={isTheater || undefined}>
      <div className="sticky top-(--top-bar-height) z-10 -mx-4 bg-background md:top-0 md:mx-0 lg:static">
        {/* Kept empty apart from the player, with YouTube's own controls. Everything else sits outside it. */}
        <div className={cn("bg-black md:overflow-hidden md:rounded-xl", isTheater && "lg:rounded-2xl")}>
          <div ref={mountRef} data-testid="player-mount" className={cn("mx-auto aspect-video min-h-[200px] w-full bg-black", isTheater && "lg:w-[min(100%,calc((100dvh-10rem)*16/9))]")} />
        </div>

        <div className="space-y-2 px-4 py-3 md:px-0">
          <div className="flex flex-wrap items-center gap-1">
            <Button type="button" variant="secondary" disabled={!previous || !isReady} onClick={() => previous && playVideo(previous.youtubeVideoId)} data-testid="playlist-previous">
              <ChevronRight aria-hidden data-icon="inline-start" />
              {p.previous}
            </Button>
            <Button type="button" variant={state === "ended" && next ? "default" : "secondary"} disabled={!next || !isReady} onClick={() => next && playVideo(next.youtubeVideoId)} data-testid="playlist-next">
              {p.next}
              <ChevronLeft aria-hidden data-icon="inline-end" />
            </Button>
            <Button type="button" variant="ghost" className="ms-auto hidden lg:inline-flex" aria-pressed={isTheater} onClick={() => setIsTheater((value) => !value)} data-testid="playlist-theater">
              {isTheater ? <Square aria-hidden data-icon="inline-start" /> : <RectangleHorizontal aria-hidden data-icon="inline-start" />}
              {isTheater ? strings.watch.exitTheater : strings.watch.theater}
            </Button>
            {showResume ? (
              <Button type="button" variant="ghost" disabled={!isReady} onClick={() => playVideo(lastItem.youtubeVideoId, resumeSeconds)} data-testid="playlist-resume">
                <RotateCcw aria-hidden data-icon="inline-start" />
                {p.resume}
              </Button>
            ) : null}
          </div>

          {current ? (
            // Hidden on phones, where the player stays pinned and space is short. The list marks the current item.
            <div className="hidden space-y-1 md:block">
              <p className="text-xs font-semibold text-brand">
                {p.nowPlaying} · <bdi dir="ltr">{p.position(currentIndex + 1, items.length)}</bdi>
              </p>
              <p dir="auto" className="text-start text-base leading-snug font-semibold sm:text-lg" data-testid="playlist-current">
                {current.title}
              </p>
              <YouTubeAttribution youtubeVideoId={current.youtubeVideoId} channelTitle={current.channelTitle} />
            </div>
          ) : null}

          <p role="status" className={message ? "text-sm text-text-secondary" : "sr-only"} data-testid="playlist-message">
            {message}
          </p>
        </div>
      </div>

      <div className="mt-2 lg:mt-0">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 lg:mt-0">
          <h2 className="font-semibold">{p.contents}</h2>
          <span className="text-xs text-text-secondary" data-testid="playlist-count">
            {p.itemCount(items.length)}
          </span>
        </div>

        {status === "unauthenticated" ? (
          <p className="mb-2 text-xs text-text-secondary">
            <Link href={signInHref(path)} className="text-brand underline-offset-4 hover:underline" data-testid="progress-signin">
              {p.signInForProgress}
            </Link>
          </p>
        ) : null}
        {isSignedIn && youtubePlaylistId ? <p className="mb-2 text-xs text-text-secondary">{p.youtubeProgressNote}</p> : null}

        <ol ref={listRef} className={cn("space-y-1 overflow-y-auto rounded-2xl border bg-surface p-1.5", isTheater ? "max-h-[32rem] lg:grid lg:grid-cols-2 lg:gap-1 lg:space-y-0" : "max-h-[70dvh]")} data-testid="playlist-items">
          {items.map((item, index) => {
            const itemProgress = progress.get(item.videoId);
            const isCurrent = item.youtubeVideoId === currentVideoId;
            const percent = itemProgress?.durationSeconds ? Math.min(100, (itemProgress.positionSeconds / itemProgress.durationSeconds) * 100) : 0;
            const duration = formatDuration(item.durationSeconds);

            return (
              <li key={item.videoId}>
                <button
                  type="button"
                  disabled={!isReady}
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => playVideo(item.youtubeVideoId, isCurrent ? 0 : (resumePosition(itemProgress) ?? 0))}
                  data-testid="playlist-item"
                  className={cn("flex min-h-11 w-full gap-3 rounded-lg p-2 text-start outline-none hover:bg-surface-elevated focus-visible:ring-3 focus-visible:ring-ring/50", isCurrent && "bg-surface-elevated")}
                >
                  <span className="flex w-5 shrink-0 items-center justify-center text-xs text-text-secondary tabular-nums">{isCurrent ? <Play aria-hidden className="size-3.5 text-brand" /> : index + 1}</span>
                  <span className="relative w-24 shrink-0 overflow-hidden rounded-md bg-black">
                    {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="strict-origin-when-cross-origin" className="aspect-video w-full object-cover" /> : <span className="block aspect-video w-full" />}
                    {percent > 0 && !itemProgress?.isCompleted ? (
                      <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-black/60" data-testid="item-progress">
                        <span className="block h-full bg-brand" style={{ inlineSize: `${percent}%` }} />
                      </span>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="line-clamp-2 block text-start text-sm leading-snug font-medium">
                      {item.title}
                    </span>
                    <span className="mt-1 block text-xs text-text-secondary">
                      {item.channelTitle ? (
                        <>
                          <bdi>{item.channelTitle}</bdi> ·{" "}
                        </>
                      ) : null}
                      {strings.feed.source}
                      {duration ? (
                        <>
                          {" "}
                          · <bdi dir="ltr">{duration}</bdi>
                        </>
                      ) : null}
                    </span>
                    {item.note ? (
                      <span dir="auto" className="mt-1 block text-start text-xs text-text-secondary">
                        {item.note}
                      </span>
                    ) : null}
                  </span>
                  {itemProgress?.isCompleted ? <Check role="img" aria-label={p.completed} className="size-4 shrink-0 self-center text-brand" data-testid="item-completed" /> : null}
                </button>
              </li>
            );
          })}
        </ol>

        {youtubePlaylistId ? (
          <a href={`https://www.youtube.com/playlist?list=${encodeURIComponent(youtubePlaylistId)}`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-6 items-center gap-1 text-sm text-brand underline-offset-4 hover:underline" data-testid="playlist-on-youtube">
            {p.openOnYouTube}
            <ExternalLink aria-hidden className="size-3" />
          </a>
        ) : null}
      </div>
    </div>
  );
}
