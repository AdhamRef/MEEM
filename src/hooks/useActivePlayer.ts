"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { WatchSummary } from "@/features/recommendations/watch-rules";
import { loadYouTubeIframeApi, PLAYER_STATE, type YouTubePlayer } from "@/lib/youtube/iframe-api";

export type PlaybackState = "idle" | "loading" | "playing" | "paused" | "ended" | "blocked" | "error";

interface ActivePlayerOptions {
  /** Where the player goes. Nothing may ever be placed in front of this element. */
  mountRef: RefObject<HTMLElement | null>;
  /** Null until a video should exist, so a player is only ever created for an active card. */
  videoId: string | null;
  /** False once the card is less than half visible, which pauses it. */
  isInView: boolean;
  autoplay: boolean;
  /** YouTube's documented `controls` setting. The feed turns it off, and other pages keep it. */
  showControls?: boolean;
  /** Starts a video again when it ends, as a vertical video app does. */
  loopOnEnd?: boolean;
  strategy: "reuse" | "recreate";
  onWatchFinished?: (videoId: string, watch: Omit<WatchSummary, "durationSeconds">) => void;
}

interface WatchTracker {
  videoId: string;
  didStartPlaying: boolean;
  didEnd: boolean;
}

/**
 * Manages the one YouTube player a page may have. Autoplay always starts muted. Sound comes
 * only from a person's action, and the player's own controls and end screen stay untouched.
 */
export function useActivePlayer({ mountRef, videoId, isInView, autoplay, strategy, onWatchFinished, showControls = true, loopOnEnd = false }: ActivePlayerOptions) {
  // Tagged with its video, so moving on shows "loading" rather than the last video's state.
  const [playback, setPlayback] = useState<{ videoId: string | null; state: PlaybackState; errorCode: number | null }>({ videoId: null, state: "idle", errorCode: null });
  const playbackStateRef = useRef<PlaybackState>("idle");
  useEffect(() => {
    playbackStateRef.current = playback.state;
  }, [playback.state]);
  const [isMuted, setIsMuted] = useState(true);

  const playerRef = useRef<YouTubePlayer | null>(null);
  // Player methods don't exist until onReady, and people can move on before that.
  const isReadyRef = useRef(false);
  const pendingVideoRef = useRef<string | null>(null);
  const wantsSoundRef = useRef(false);
  const trackerRef = useRef<WatchTracker | null>(null);
  const pausedForViewRef = useRef(false);
  const isMutedRef = useRef(true);
  const isInViewRef = useRef(isInView);
  const onWatchFinishedRef = useRef(onWatchFinished);

  useEffect(() => {
    onWatchFinishedRef.current = onWatchFinished;
    isInViewRef.current = isInView;
    isMutedRef.current = isMuted;
  });

  const finishWatch = useCallback(() => {
    const tracker = trackerRef.current;
    trackerRef.current = null;
    if (!tracker) return;

    let watchedSeconds = 0;
    if (isReadyRef.current) {
      try {
        watchedSeconds = playerRef.current?.getCurrentTime() ?? 0;
      } catch {
        // The player is being torn down. The summary just reports what's known.
      }
    }
    onWatchFinishedRef.current?.(tracker.videoId, { didStartPlaying: tracker.didStartPlaying, didEnd: tracker.didEnd, watchedSeconds });
  }, []);

  const destroyPlayer = useCallback(() => {
    finishWatch();
    try {
      playerRef.current?.destroy();
    } catch {
      // Nothing to clean up if YouTube already removed it.
    }
    playerRef.current = null;
    isReadyRef.current = false;
    pendingVideoRef.current = null;
    mountRef.current?.replaceChildren();
  }, [finishWatch, mountRef]);

  useEffect(() => {
    // No active video means no player. Merely hiding one would leave it playing in the background.
    if (!videoId) {
      destroyPlayer();
      return;
    }
    let isCancelled = false;

    if (playerRef.current && strategy === "reuse") {
      finishWatch();
      trackerRef.current = { videoId, didStartPlaying: false, didEnd: false };
      if (isReadyRef.current) {
        playerRef.current.loadVideoById(videoId);
        if (wantsSoundRef.current) playerRef.current.unMute();
      } else {
        pendingVideoRef.current = videoId;
      }
      return;
    }

    destroyPlayer();
    trackerRef.current = { videoId, didStartPlaying: false, didEnd: false };

    loadYouTubeIframeApi().then(
      (youtube) => {
        const mount = mountRef.current;
        if (isCancelled || !mount) return;

        const element = document.createElement("div");
        mount.replaceChildren(element);

        playerRef.current = new youtube.Player(element, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: autoplay ? 1 : 0,
            mute: autoplay ? 1 : 0,
            playsinline: 1,
            controls: showControls ? 1 : 0,
            enablejsapi: 1,
            // A documented setting: no annotations over the video.
            iv_load_policy: 3,
            origin: window.location.origin,
          },
          events: {
            onReady: ({ target }) => {
              isReadyRef.current = true;
              if (wantsSoundRef.current) target.unMute();
              const pending = pendingVideoRef.current;
              pendingVideoRef.current = null;
              if (pending) target.loadVideoById(pending);
              else if (autoplay && isInViewRef.current) target.playVideo();
              setIsMuted(target.isMuted());
            },
            onStateChange: ({ data, target }) => {
              setIsMuted(target.isMuted());
              const tracker = trackerRef.current;
              if (!tracker) return;
              const report = (state: PlaybackState) => setPlayback({ videoId: tracker.videoId, state, errorCode: null });
              if (data === PLAYER_STATE.PLAYING) {
                tracker.didStartPlaying = true;
                report("playing");
              } else if (data === PLAYER_STATE.PAUSED) {
                report("paused");
              } else if (data === PLAYER_STATE.ENDED) {
                tracker.didEnd = true;
                if (loopOnEnd) {
                  target.seekTo(0, true);
                  target.playVideo();
                } else {
                  report("ended");
                }
              }
            },
            onError: ({ data }) => setPlayback({ videoId: trackerRef.current?.videoId ?? null, state: "error", errorCode: data ?? null }),
            onAutoplayBlocked: () => setPlayback({ videoId: trackerRef.current?.videoId ?? null, state: "blocked", errorCode: null }),
          },
        });
      },
      () => {
        if (!isCancelled) setPlayback({ videoId, state: "error", errorCode: null });
      },
    );

    return () => {
      isCancelled = true;
    };
  }, [videoId, autoplay, strategy, showControls, loopOnEnd, destroyPlayer, finishWatch, mountRef]);

  // Pauses once less than half the player is visible, and resumes only a pause made here.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !isReadyRef.current) return;

    if (!isInView) {
      pausedForViewRef.current = true;
      player.pauseVideo();
    } else if (pausedForViewRef.current) {
      pausedForViewRef.current = false;
      player.playVideo();
    }
  }, [isInView]);

  // Nothing plays in the background (policy III.E). It stays paused on return until asked.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && isReadyRef.current) playerRef.current?.pauseVideo();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => destroyPlayer, [destroyPlayer]);

  /** A real control outside the player, using the documented mute and unMute methods. */
  const toggleSound = useCallback(() => {
    const player = playerRef.current;
    if (!player || !isReadyRef.current) return;
    // Acts on what the button shows. The player reports its state late, so asking it could undo a quick second tap.
    if (isMutedRef.current) {
      player.unMute();
      wantsSoundRef.current = true;
      setIsMuted(false);
    } else {
      player.mute();
      wantsSoundRef.current = false;
      setIsMuted(true);
    }
  }, []);

  /** From a person's tap, using the documented playVideo and pauseVideo methods. */
  const togglePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player || !isReadyRef.current) return;
    // Acts on what's shown, like the sound button.
    if (playbackStateRef.current === "playing") player.pauseVideo();
    else player.playVideo();
  }, []);

  /** What's been watched, or null while no player can answer. */
  const getPosition = useCallback((): { positionSeconds: number; durationSeconds: number | null } | null => {
    const player = playerRef.current;
    if (!player || !isReadyRef.current) return null;
    try {
      const duration = player.getDuration();
      return { positionSeconds: player.getCurrentTime(), durationSeconds: duration > 0 ? duration : null };
    } catch {
      return null;
    }
  }, []);

  /** From a person's click, using the documented seekTo and playVideo methods. */
  const resumeAt = useCallback((seconds: number) => {
    const player = playerRef.current;
    if (!player || !isReadyRef.current) return;
    player.seekTo(seconds, true);
    player.playVideo();
  }, []);

  const isCurrent = playback.videoId === videoId;
  return {
    getPosition,
    resumeAt,
    state: !videoId ? ("idle" as const) : isCurrent ? playback.state : ("loading" as const),
    errorCode: isCurrent ? playback.errorCode : null,
    isMuted,
    toggleSound,
    togglePlay,
  };
}
