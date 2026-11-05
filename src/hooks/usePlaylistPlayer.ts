"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { parseYouTubeVideoId } from "@/lib/youtube/ids";
import { loadYouTubeIframeApi, PLAYER_STATE, type YouTubePlayer } from "@/lib/youtube/iframe-api";

export type PlaylistPlayerState = "loading" | "ready" | "playing" | "paused" | "ended" | "error";

export interface PlaybackReport {
  youtubeVideoId: string;
  positionSeconds: number;
  durationSeconds: number | null;
  didEnd: boolean;
}

interface PlaylistPlayerOptions {
  /** Nothing may ever be placed in front of this element. */
  mountRef: RefObject<HTMLElement | null>;
  /** The videos, in order. */
  youtubeVideoIds: string[];
  /** When set, YouTube's own playlist player is used. Otherwise each video is loaded in turn. */
  youtubePlaylistId: string | null;
  onReport: (report: PlaybackReport) => void;
}

const REPORT_INTERVAL_MS = 20_000;

/**
 * The one player on a playlist page. It never starts by itself, and a video ending stays on
 * YouTube's end screen, with "next" offered outside the player. Moving on is the person's choice.
 */
export function usePlaylistPlayer({ mountRef, youtubeVideoIds, youtubePlaylistId, onReport }: PlaylistPlayerOptions) {
  const [state, setState] = useState<PlaylistPlayerState>("loading");
  const [errorCode, setErrorCode] = useState<number | null>(null);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(youtubeVideoIds[0] ?? null);

  const playerRef = useRef<YouTubePlayer | null>(null);
  const isReadyRef = useRef(false);
  const currentRef = useRef<string | null>(youtubeVideoIds[0] ?? null);
  const onReportRef = useRef(onReport);
  const idsRef = useRef(youtubeVideoIds);

  useEffect(() => {
    onReportRef.current = onReport;
    idsRef.current = youtubeVideoIds;
  });

  const report = useCallback((didEnd = false) => {
    const player = playerRef.current;
    const youtubeVideoId = currentRef.current;
    if (!player || !isReadyRef.current || !youtubeVideoId) return;
    try {
      const positionSeconds = player.getCurrentTime();
      const duration = player.getDuration();
      onReportRef.current({ youtubeVideoId, positionSeconds, durationSeconds: duration > 0 ? duration : null, didEnd });
    } catch {
      // The player is being torn down. There's nothing to report.
    }
  }, []);

  /** In YouTube's playlist player, it decides what plays, so the current video is read back from it. */
  const syncCurrentFromPlayer = useCallback((player: YouTubePlayer) => {
    const fromUrl = parseYouTubeVideoId(player.getVideoUrl());
    if (!fromUrl || fromUrl === currentRef.current) return;
    currentRef.current = fromUrl;
    setCurrentVideoId(fromUrl);
  }, []);

  useEffect(() => {
    let isCancelled = false;
    const firstId = idsRef.current[0];
    if (!firstId) return;

    loadYouTubeIframeApi().then(
      (youtube) => {
        const mount = mountRef.current;
        if (isCancelled || !mount) return;
        const element = document.createElement("div");
        mount.replaceChildren(element);

        playerRef.current = new youtube.Player(element, {
          ...(youtubePlaylistId ? {} : { videoId: firstId }),
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 0,
            playsinline: 1,
            controls: 1,
            enablejsapi: 1,
            origin: window.location.origin,
            ...(youtubePlaylistId ? { listType: "playlist", list: youtubePlaylistId } : {}),
          },
          events: {
            onReady: () => {
              isReadyRef.current = true;
              setState("ready");
            },
            onStateChange: ({ data, target }) => {
              if (youtubePlaylistId) syncCurrentFromPlayer(target);
              if (data === PLAYER_STATE.PLAYING) {
                setErrorCode(null);
                setState("playing");
              } else if (data === PLAYER_STATE.PAUSED) {
                setState("paused");
                report();
              } else if (data === PLAYER_STATE.ENDED) {
                setState("ended");
                report(true);
              }
            },
            onError: ({ data }) => {
              setErrorCode(data ?? null);
              setState("error");
            },
            onAutoplayBlocked: () => setState("paused"),
          },
        });
      },
      () => {
        if (!isCancelled) setState("error");
      },
    );

    const frameMount = mountRef.current;
    return () => {
      isCancelled = true;
      report();
      try {
        playerRef.current?.destroy();
      } catch {
        // Nothing to clean up if YouTube already removed it.
      }
      playerRef.current = null;
      isReadyRef.current = false;
      frameMount?.replaceChildren();
    };
  }, [youtubePlaylistId, mountRef, report, syncCurrentFromPlayer]);

  useEffect(() => {
    if (state !== "playing") return;
    const timer = setInterval(() => report(), REPORT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [state, report]);

  // Nothing plays in the background, and what was watched is saved before someone leaves.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (!document.hidden || !isReadyRef.current) return;
      report();
      playerRef.current?.pauseVideo();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [report]);

  /** Always from a person's click, so playing with sound is allowed by browsers. */
  const playVideo = useCallback(
    (youtubeVideoId: string, startSeconds = 0) => {
      const player = playerRef.current;
      if (!player || !isReadyRef.current) return;
      if (youtubeVideoId !== currentRef.current) report();
      setErrorCode(null);

      if (youtubePlaylistId) {
        const index = idsRef.current.indexOf(youtubeVideoId);
        if (index < 0) return;
        player.playVideoAt(index);
        if (startSeconds > 0) player.seekTo(startSeconds, true);
      } else {
        player.loadVideoById({ videoId: youtubeVideoId, startSeconds });
      }
      currentRef.current = youtubeVideoId;
      setCurrentVideoId(youtubeVideoId);
    },
    [report, youtubePlaylistId],
  );

  return { state, errorCode, currentVideoId, isReady: state !== "loading", playVideo };
}
