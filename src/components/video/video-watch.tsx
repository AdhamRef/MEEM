"use client";

import { ExternalLink, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { recordGuestSignal } from "@/features/recommendations/guest-signals";
import { useRecordView } from "@/components/knowledge/view-recorder";
import { signalFromWatch } from "@/features/recommendations/watch-rules";
import { formatDuration, resumePosition } from "@/features/playlists/rules";
import type { VideoCard } from "@/features/shorts/types";
import { useActivePlayer } from "@/hooks/useActivePlayer";
import { cn } from "@/lib/utils";
import { SaveButton, ShareButton, YouTubeAttribution } from "./video-actions";
import { YouTubeComments } from "./youtube-comments";

/** One video on its own page. It doesn't autoplay, because the person chose to come here. */
export function VideoWatch({ video, related }: { video: VideoCard; related?: ReactNode }) {
  const { status: sessionStatus } = useSession();
  const mountRef = useRef<HTMLDivElement>(null);
  const [isSaved, setIsSaved] = useState(false);
  // A check that was already on its way must not undo what the person just pressed.
  const hasToggledSave = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const isGuestRef = useRef(true);
  useRecordView("VIDEO", video.id);

  useEffect(() => {
    isGuestRef.current = sessionStatus !== "authenticated";
  });

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
        if (video.category) recordGuestSignal(window.localStorage, video.category.id, signal, new Date());
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

  const { state, errorCode, getPosition, resumeAt } = useActivePlayer({
    mountRef,
    videoId: video.youtubeVideoId,
    isInView: true,
    autoplay: false,
    strategy: "recreate",
    onWatchFinished: handleWatchFinished,
  });

  // Only long videos: nobody resumes a clip of a minute.
  const tracksProgress = sessionStatus === "authenticated" && video.kind === "LONG_FORM";
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

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 pb-8 md:px-4 md:pt-6">
      <div
        ref={mountRef}
        data-testid="player-mount"
        className={cn("mx-auto bg-black", video.kind === "SHORT" ? "aspect-9/16 max-h-[75dvh] min-h-[200px] max-w-full" : "aspect-video min-h-[200px] w-full")}
      />

      <div className="space-y-3 px-4 md:px-0">
        {video.category ? <Badge variant="secondary">{video.category.title}</Badge> : null}
        {video.viewCount !== null || video.likeCount !== null ? (
          <p className="flex flex-wrap gap-x-4 text-xs text-text-secondary" data-testid="video-statistics">
            {video.viewCount !== null ? (
              <span>
                <bdi>{video.viewCount.toLocaleString("ar")}</bdi> {strings.feed.views}
              </span>
            ) : null}
            {video.likeCount !== null ? (
              <span>
                <bdi>{video.likeCount.toLocaleString("ar")}</bdi> {strings.feed.likes}
              </span>
            ) : null}
          </p>
        ) : null}
        <h1 dir="auto" className="text-start text-xl leading-snug font-semibold">
          {video.title}
        </h1>
        <YouTubeAttribution youtubeVideoId={video.youtubeVideoId} channelTitle={video.channelTitle} />

        <div role="status" className={cn("text-sm", playerMessage || notice ? "text-text-secondary" : "sr-only")}>
          {playerMessage ?? notice}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <SaveButton videoId={video.id} isSaved={isSaved} callbackPath={path} onChange={(next) => {
              hasToggledSave.current = true;
              setIsSaved(next);
            }} onFailure={setNotice} />
          <ShareButton path={path} title={video.title} onResult={setNotice} />
          {resumeSeconds !== null ? (
            <Button
              type="button"
              variant="secondary"
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
            <Button asChild variant="secondary" data-testid="video-cta">
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

        {video.description ? (
          <p dir="auto" className="text-start text-sm whitespace-pre-line text-text-secondary">
            {video.description}
          </p>
        ) : null}

        {related}

        <YouTubeComments videoId={video.id} youtubeVideoId={video.youtubeVideoId} />
      </div>
    </div>
  );
}
