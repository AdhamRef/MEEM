"use client";

/* eslint-disable @next/next/no-img-element -- YouTube thumbnails load directly from YouTube by design. */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * TEMPORARY Phase 1 device test. It answers three questions on real phones:
 *  1. Can people move between videos by swiping, given nothing may cover the player?
 *  2. Does muted autoplay start when a video becomes the active one?
 *  3. Which player strategy keeps sound on after one tap:
 *     "recreate" (a new player per video) or "reuse" (one player, moved and reloaded)?
 *
 * Nothing is ever drawn in front of the player, in line with YouTube's policy.
 */

type Mode = "recreate" | "reuse";

interface YTPlayer {
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  playVideo(): void;
  pauseVideo(): void;
  loadVideoById(id: string): void;
  destroy(): void;
}

interface YTEvent {
  data?: number;
  target: YTPlayer;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: {
          videoId: string;
          width: string;
          height: string;
          playerVars: Record<string, string | number>;
          events: Record<string, (event: YTEvent) => void>;
        },
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const STATE_NAMES: Record<number, string> = {
  [-1]: "unstarted",
  0: "ended",
  1: "playing",
  2: "paused",
  3: "buffering",
  5: "cued",
};

function loadYouTubeApi(): Promise<void> {
  return new Promise((resolve) => {
    if (window.YT?.Player) return resolve();
    window.onYouTubeIframeAPIReady = () => resolve();
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
}

export function FeedSpike() {
  const [idsText, setIdsText] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("recreate");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [apiReady, setApiReady] = useState(false);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const wantsSoundRef = useRef(false);
  // Player methods don't exist until onReady, and someone can swipe before that.
  const playerReadyRef = useRef(false);
  const pendingVideoRef = useRef<string | null>(null);

  const log = useCallback((message: string) => {
    const time = new Date().toLocaleTimeString("en-GB");
    setLogs((current) => [`${time} ${message}`, ...current].slice(0, 40));
  }, []);

  useEffect(() => {
    loadYouTubeApi().then(() => {
      setApiReady(true);
      log("IFrame API ready");
    });
  }, [log]);

  // Active only when more than half the slide is visible, as YouTube's policy requires.
  useEffect(() => {
    if (ids.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveIndex(Number((entry.target as HTMLElement).dataset.index));
          }
        }
      },
      { root: scrollerRef.current, threshold: 0.6 },
    );
    slideRefs.current.forEach((slide) => slide && observer.observe(slide));
    return () => observer.disconnect();
  }, [ids]);

  const createPlayer = useCallback(
    (videoId: string) => {
      const mount = mountRef.current;
      if (!mount || !window.YT) return;
      mount.replaceChildren();
      const element = document.createElement("div");
      mount.appendChild(element);
      playerReadyRef.current = false;
      pendingVideoRef.current = null;

      playerRef.current = new window.YT.Player(element, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1,
          mute: 1,
          playsinline: 1,
          controls: 1,
          rel: 0,
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            log(`player ready ${videoId}, wantsSound=${wantsSoundRef.current}`);
            playerReadyRef.current = true;
            if (wantsSoundRef.current) event.target.unMute();
            if (pendingVideoRef.current) {
              log(`reuse: loading pending ${pendingVideoRef.current}`);
              event.target.loadVideoById(pendingVideoRef.current);
              pendingVideoRef.current = null;
            } else {
              event.target.playVideo();
            }
            setIsMuted(event.target.isMuted());
          },
          onStateChange: (event) => {
            const name = STATE_NAMES[event.data ?? -1] ?? String(event.data);
            log(`state: ${name}, muted=${event.target.isMuted()}`);
            setIsMuted(event.target.isMuted());
          },
          onAutoplayBlocked: () => log("AUTOPLAY BLOCKED"),
          onError: (event) => log(`ERROR code ${event.data}`),
        },
      });
    },
    [log],
  );

  // Positions the single player area over the active slide's reserved space.
  useEffect(() => {
    const mount = mountRef.current;
    const slide = slideRefs.current[activeIndex];
    const videoId = ids[activeIndex];
    if (!apiReady || !mount || !slide || !videoId) return;

    const slot = slide.querySelector<HTMLElement>("[data-slot]");
    if (!slot) return;

    // Slides are not positioned, so the slot's offset is already relative to the scroller.
    mount.style.top = `${slot.offsetTop}px`;
    mount.style.height = `${slot.offsetHeight}px`;
    mount.style.width = `${slot.offsetWidth}px`;
    mount.style.insetInlineStart = `${slot.offsetLeft}px`;

    if (mode === "reuse" && playerRef.current) {
      if (!playerReadyRef.current) {
        pendingVideoRef.current = videoId;
        return;
      }
      log(`reuse: loadVideoById ${videoId}`);
      playerRef.current.loadVideoById(videoId);
      if (wantsSoundRef.current) playerRef.current.unMute();
      return;
    }

    if (playerRef.current) {
      log("recreate: destroying previous player");
      playerRef.current.destroy();
      playerRef.current = null;
    }
    createPlayer(videoId);
  }, [activeIndex, apiReady, createPlayer, ids, log, mode]);

  // No background play: pause whenever the page is hidden.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) playerRef.current?.pauseVideo();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const start = () => {
    const parsed = idsText
      .split(/[\s,]+/)
      .map((value) => value.match(/([\w-]{11})(?:[?&/].*)?$/)?.[1])
      .filter((value): value is string => Boolean(value));
    playerRef.current?.destroy();
    playerRef.current = null;
    setActiveIndex(0);
    setIds(parsed);
    log(`loaded ${parsed.length} ids in ${mode} mode`);
  };

  const toggleSound = () => {
    const player = playerRef.current;
    if (!player || !playerReadyRef.current) return;
    if (player.isMuted()) {
      player.unMute();
      wantsSoundRef.current = true;
    } else {
      player.mute();
      wantsSoundRef.current = false;
    }
    setIsMuted(player.isMuted());
  };

  const goTo = (index: number) => {
    slideRefs.current[index]?.scrollIntoView({ behavior: "smooth" });
  };

  if (ids.length === 0) {
    return (
      <main dir="ltr" style={{ padding: 16, fontFamily: "system-ui", background: "#090B10", color: "#F4F5F7", minHeight: "100dvh" }}>
        <h1 style={{ fontSize: 20 }}>Feed device test</h1>
        <p>Paste at least 3 Short URLs or video IDs, separated by spaces or new lines.</p>
        <textarea
          aria-label="Video IDs"
          value={idsText}
          onChange={(event) => setIdsText(event.target.value)}
          rows={6}
          style={{ width: "100%", background: "#11151D", color: "inherit", border: "1px solid #252C38", padding: 8 }}
        />
        <fieldset style={{ border: 0, padding: 0, margin: "12px 0" }}>
          <legend>Player strategy</legend>
          {(["recreate", "reuse"] as const).map((value) => (
            <label key={value} style={{ display: "block", padding: "8px 0" }}>
              <input type="radio" checked={mode === value} onChange={() => setMode(value)} /> {value}
            </label>
          ))}
        </fieldset>
        <button type="button" onClick={start} disabled={!apiReady} style={{ padding: "12px 20px", background: "#2BB3A3", color: "#090B10", border: 0, borderRadius: 8 }}>
          {apiReady ? "Start test" : "Loading YouTube API..."}
        </button>
      </main>
    );
  }

  return (
    <div
      ref={scrollerRef}
      dir="ltr"
      style={{
        position: "relative",
        height: "100dvh",
        overflowY: "auto",
        scrollSnapType: "y mandatory",
        background: "#090B10",
        color: "#F4F5F7",
        fontFamily: "system-ui",
      }}
    >
      <div ref={mountRef} style={{ position: "absolute", background: "#000" }} />

      {ids.map((id, index) => (
        <section
          key={`${id}-${index}`}
          ref={(element) => {
            slideRefs.current[index] = element;
          }}
          data-index={index}
          style={{ height: "100dvh", scrollSnapAlign: "start", scrollSnapStop: "always", display: "flex", flexDirection: "column" }}
        >
          <div data-slot style={{ height: "68dvh", minHeight: 200, width: "100%", background: "#000" }}>
            {index !== activeIndex && (
              <img
                src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
                alt=""
                loading="lazy"
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            )}
          </div>

          {/* Everything below sits outside the player, so it is also the swipe area. */}
          <div style={{ flex: 1, minHeight: 0, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <strong>
              Video {index + 1} of {ids.length} ({mode})
            </strong>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={toggleSound} style={{ padding: "10px 14px" }}>
                {isMuted ? "Turn sound on" : "Turn sound off"}
              </button>
              <button type="button" onClick={() => goTo(Math.max(index - 1, 0))} style={{ padding: "10px 14px" }}>
                Previous
              </button>
              <button type="button" onClick={() => goTo(Math.min(index + 1, ids.length - 1))} style={{ padding: "10px 14px" }}>
                Next
              </button>
            </div>
            <pre style={{ flex: 1, overflow: "auto", margin: 0, fontSize: 11, background: "#11151D", padding: 8 }}>{logs.join("\n")}</pre>
          </div>
        </section>
      ))}
    </div>
  );
}
