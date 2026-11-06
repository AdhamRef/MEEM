"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { feedBufferAheadForDevice } from "@/config/feed";
import { FeedPlayerPool, type PoolEvents, type PoolTarget } from "@/lib/youtube/feed-player-pool";
import type { PlaybackState } from "./useActivePlayer";

interface FeedPlayerPoolOptions {
  /** One element per possible player, each placed over the card it's assigned to. */
  mountsRef: RefObject<(HTMLElement | null)[]>;
  active: PoolTarget | null;
  /** The cards coming up, nearest first. */
  upcoming: PoolTarget[];
  isInView: boolean;
  place: PoolEvents["place"];
  onWatchFinished: PoolEvents["onWatchFinished"];
}

/** Connects the feed's player pool to React, which holds only what's shown on screen. */
export function useFeedPlayerPool({ mountsRef, active, upcoming, isInView, place, onWatchFinished }: FeedPlayerPoolOptions) {
  const [playback, setPlayback] = useState<{ videoId: string | null; state: PlaybackState; errorCode: number | null }>({ videoId: null, state: "idle", errorCode: null });
  const [isMuted, setIsMuted] = useState(true);
  const [isSoundLocked, setIsSoundLocked] = useState(false);
  const [leavingKey, setLeavingKey] = useState<string | null>(null);

  const poolRef = useRef<FeedPlayerPool | null>(null);
  const latestRef = useRef({ place, onWatchFinished, active, upcoming, isInView });
  useEffect(() => {
    latestRef.current = { place, onWatchFinished, active, upcoming, isInView };
  });

  useEffect(() => {
    const mounts = mountsRef.current.filter((mount): mount is HTMLElement => mount !== null).slice(0, 1 + feedBufferAheadForDevice());
    const pool = new FeedPlayerPool(mounts, {
      place: (mount, index) => latestRef.current.place(mount, index),
      onPlayback: (videoId, state, errorCode) => setPlayback({ videoId, state, errorCode }),
      onMuted: setIsMuted,
      onSoundLocked: setIsSoundLocked,
      onLeaving: setLeavingKey,
      onWatchFinished: (videoId, watch) => latestRef.current.onWatchFinished(videoId, watch),
    });
    poolRef.current = pool;
    return () => {
      poolRef.current = null;
      pool.destroy();
    };
  }, [mountsRef]);

  const signature = [active?.key ?? "", ...upcoming.map((target) => target.key)].join("|");
  useEffect(() => {
    poolRef.current?.setTargets(latestRef.current.active, latestRef.current.upcoming);
  }, [signature]);

  useEffect(() => {
    poolRef.current?.setInView(isInView);
  }, [isInView]);

  const videoId = active?.videoId ?? null;
  const isCurrent = playback.videoId === videoId;
  return {
    state: !videoId ? ("idle" as const) : isCurrent ? playback.state : ("loading" as const),
    errorCode: isCurrent ? playback.errorCode : null,
    isMuted,
    isSoundLocked,
    leavingKey,
    beginWithSound: useCallback(() => poolRef.current?.beginWithSound(), []),
    toggleSound: useCallback(() => poolRef.current?.toggleSound(), []),
    togglePlay: useCallback(() => poolRef.current?.togglePlay(), []),
    reposition: useCallback(() => poolRef.current?.reposition(), []),
  };
}
