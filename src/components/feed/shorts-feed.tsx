"use client";

import { Clapperboard, RotateCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { usePreferences } from "@/components/preferences/preferences-provider";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { preconnect } from "react-dom";
import { FEED_ACTIVE_THRESHOLD, FEED_BUFFER_AHEAD, FEED_CROP_PIXELS, FEED_IMMERSIVE_OVERLAY, FEED_LOAD_AHEAD, FEED_PAUSE_THRESHOLD, FEED_PLAYER_STRATEGY, FEED_PRELOAD_THUMBNAILS } from "@/config/feed";
import { strings } from "@/config/strings.ar";
import { readGuestBehaviour, recordGuestSignal } from "@/features/recommendations/guest-signals";
import { sendView } from "@/components/knowledge/view-recorder";
import { addSessionMomentum, emptySessionMomentum, sessionMomentumParams } from "@/features/recommendations/session-momentum";
import { signalFromWatch } from "@/features/recommendations/watch-rules";
import type { VideoCard } from "@/features/shorts/types";
import { useActivePlayer } from "@/hooks/useActivePlayer";
import { useFeedPlayerPool } from "@/hooks/useFeedPlayerPool";
import type { PoolEvents, PoolTarget } from "@/lib/youtube/feed-player-pool";
import { loadYouTubeIframeApi } from "@/lib/youtube/iframe-api";
import { cn } from "@/lib/utils";
import { FeedCard, feedVideoRatio } from "./feed-card";
import { ImmersiveFeedCard } from "./feed-card-immersive";
import { FeedLoader } from "./feed-loader";
import { InterestsDrawer } from "./interests-drawer";

const Card = FEED_IMMERSIVE_OVERLAY ? ImmersiveFeedCard : FeedCard;
import { useFeedPages } from "./use-feed-pages";

interface TopicTab {
  id: string;
  title: string;
}

interface ShortsFeedProps {
  /** A shared video to show first. */
  initialVideo?: VideoCard;
}

interface FeedPlayerOptions {
  mountsRef: RefObject<(HTMLElement | null)[]>;
  active: PoolTarget | null;
  upcoming: PoolTarget[];
  isInView: boolean;
  place: PoolEvents["place"];
  onWatchFinished: PoolEvents["onWatchFinished"];
}

/** The layout that follows YouTube's rules: one player, moved to the active card, starting muted. */
function useSingleFeedPlayer({ mountsRef, active, isInView, place, onWatchFinished }: FeedPlayerOptions) {
  const mountRef = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return mountsRef.current[0] ?? null;
      },
      set current(_value) {},
    }),
    [mountsRef],
  );
  const player = useActivePlayer({
    mountRef,
    videoId: active?.videoId ?? null,
    isInView,
    autoplay: true,
    strategy: FEED_PLAYER_STRATEGY,
    showControls: false,
    onWatchFinished: (videoId, watch) => onWatchFinished(videoId, { ...watch, timesEnded: watch.didEnd ? 1 : 0 }),
  });
  const reposition = useCallback(() => {
    const mount = mountRef.current;
    if (mount && active) place(mount, active.index);
  }, [mountRef, active, place]);
  useEffect(reposition, [reposition]);
  return { ...player, isSoundLocked: false, leavingKey: null, unlockSound: () => {}, reposition };
}

// Chosen once, so the same hook runs on every render. See FEED_BUFFER_AHEAD.
const useFeedPlayer = FEED_BUFFER_AHEAD > 0 ? useFeedPlayerPool : useSingleFeedPlayer;

/** How far a finger has to move for the swipe that brings sound to change card. */
const SOUND_SWIPE_DISTANCE = 40;

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;


export function ShortsFeed({ initialVideo }: ShortsFeedProps) {
  const { status: preferencesStatus, isGuest, selectedTopicIds, channelChoices } = usePreferences();
  const { status: sessionStatus } = useSession();

  const [topics, setTopics] = useState<TopicTab[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    fetch("/api/topics")
      .then((response) => (response.ok ? (response.json() as Promise<{ topics: TopicTab[] }>) : { topics: [] }))
      .then((data) => {
        if (isCurrent) setTopics(data.topics);
      })
      .catch(() => {
        // The tabs stay hidden. "For you" still works without them.
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  // The request waits for preferences, so the first page already reflects them.
  const query = useMemo(() => {
    if (preferencesStatus === "loading") return null;
    const params = new URLSearchParams();
    if (selectedTopicId) params.set("topicId", selectedTopicId);
    if (isGuest) {
      if (selectedTopicIds.length) params.set("interests", selectedTopicIds.join(","));
      const switched = Object.entries(channelChoices);
      const switchedOn = switched.filter(([, isOn]) => isOn).map(([id]) => id);
      const switchedOff = switched.filter(([, isOn]) => !isOn).map(([id]) => id);
      if (switchedOn.length) params.set("channelsOn", switchedOn.join(","));
      if (switchedOff.length) params.set("channelsOff", switchedOff.join(","));
      const behaviour = Object.entries(readGuestBehaviour(window.localStorage, new Date()));
      if (behaviour.length) params.set("behaviour", behaviour.map(([id, score]) => `${id}:${score}`).join(","));
    }
    return params.toString();
  }, [preferencesStatus, isGuest, selectedTopicIds, channelChoices, selectedTopicId]);

  // What happened this session, sent with each page so the feed answers within a few swipes.
  const momentumRef = useRef(emptySessionMomentum());
  const getSessionParams = useCallback(() => sessionMomentumParams(momentumRef.current), []);

  const { items, status, hasMore, loadMore, retry } = useFeedPages(query, selectedTopicId ? undefined : initialVideo, getSessionParams);

  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [isActiveInView, setIsActiveInView] = useState(false);
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(new Set());
  // A check that was already on its way must not undo what the person just pressed.
  const toggledSaveRef = useRef(new Set<string>());
  const [notice, setNotice] = useState<{ videoId: string; text: string } | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const mountsRef = useRef<(HTMLElement | null)[]>([]);
  const cardRefs = useRef(new Map<number, HTMLElement>());
  const slotRefs = useRef(new Map<number, HTMLElement>());
  const activeIndexRef = useRef<number | null>(null);
  const itemsRef = useRef(items);
  const isGuestRef = useRef(isGuest);

  useEffect(() => {
    itemsRef.current = items;
    isGuestRef.current = isGuest;
    activeIndexRef.current = activeIndex;
  });

  // Loads ahead of the first card, which saves that much of its wait.
  useEffect(() => {
    loadYouTubeIframeApi().catch(() => {
      // The player reports this itself if someone reaches a video.
    });
  }, []);

  const activeVideo = activeIndex === null ? null : (items[activeIndex] ?? null);

  const handleWatchFinished = useCallback<PoolEvents["onWatchFinished"]>((youtubeVideoId, { timesEnded, ...watch }) => {
    const video = itemsRef.current.find((item) => item.youtubeVideoId === youtubeVideoId);
    if (!video) return;

    if (watch.didStartPlaying && !isGuestRef.current) sendView("VIDEO", video.id);

    const signal = signalFromWatch({ ...watch, durationSeconds: video.durationSeconds });
    if (!signal) return;

    momentumRef.current = addSessionMomentum(momentumRef.current, video, timesEnded >= 2 ? "replay" : signal);

    if (isGuestRef.current) {
      for (const topic of video.topics) recordGuestSignal(window.localStorage, topic.id, signal, new Date());
      return;
    }
    // A lost signal only makes the feed slightly less personal, so failures are ignored.
    void fetch("/api/signals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId: video.id, signal }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  const active = useMemo<PoolTarget | null>(() => (activeVideo && activeIndex !== null ? { key: `${activeVideo.id}:${activeIndex}`, index: activeIndex, videoId: activeVideo.youtubeVideoId } : null), [activeVideo, activeIndex]);
  const upcoming = useMemo<PoolTarget[]>(() => {
    if (activeIndex === null) return [];
    return items.slice(activeIndex + 1, activeIndex + 1 + FEED_BUFFER_AHEAD).map((video, offset) => ({ key: `${video.id}:${activeIndex + 1 + offset}`, index: activeIndex + 1 + offset, videoId: video.youtubeVideoId }));
  }, [items, activeIndex]);

  // Keeps a player exactly over its card's slot, and within nothing else.
  const place = useCallback<PoolEvents["place"]>((mount, index) => {
    const scroller = scrollerRef.current;
    const slot = slotRefs.current.get(index);
    if (!scroller || !slot) {
      mount.style.display = "none";
      return;
    }
    // Measured on screen, since each card sizes its slot to its own video.
    const slotBox = slot.getBoundingClientRect();
    const scrollerBox = scroller.getBoundingClientRect();
    mount.style.display = "block";
    mount.style.top = `${slotBox.top - scrollerBox.top + scroller.scrollTop}px`;
    mount.style.height = `${slotBox.height}px`;
    mount.style.width = `${slotBox.width}px`;
    mount.style.insetInlineStart = `${scrollerBox.right - slotBox.right}px`;

    if (FEED_IMMERSIVE_OVERLAY) {
      const video = itemsRef.current[index];
      const ratio = video ? feedVideoRatio(video) : 9 / 16;
      // The whole video always shows: as tall as fits, unless that would run past the sides.
      const videoWidth = Math.min(slotBox.width, slotBox.height * ratio);
      const videoHeight = videoWidth / ratio;
      // Only the frame's height grows. The player keeps the video at this width, with the
      // extra above and below it, which is where YouTube's bars land and get clipped.
      mount.style.setProperty("--frame-w", `${videoWidth}px`);
      mount.style.setProperty("--frame-h", `${videoHeight + 2 * FEED_CROP_PIXELS}px`);
    }
  }, []);

  const { state: playback, errorCode, isMuted, isSoundLocked, leavingKey, unlockSound, toggleSound, togglePlay, reposition } = useFeedPlayer({
    mountsRef,
    active,
    upcoming,
    isInView: isActiveInView,
    place,
    onWatchFinished: handleWatchFinished,
  });

  // Which way the feed last moved. A card leaving also passes the active share, and mustn't take over.
  const scrollDirectionRef = useRef(0);

  // Decides which card is active, and whether the active one is still more than half visible.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.index);
          const active = activeIndexRef.current;
          if (entry.intersectionRatio >= FEED_ACTIVE_THRESHOLD) {
            const isArriving = active === null || !FEED_IMMERSIVE_OVERLAY || (index - active) * scrollDirectionRef.current > 0;
            if (index === active) {
              setIsActiveInView(true);
            } else if (isArriving) {
              activeIndexRef.current = index;
              setActiveIndex(index);
              setIsActiveInView(true);
            }
          } else if (index === activeIndexRef.current && entry.intersectionRatio <= FEED_PAUSE_THRESHOLD) {
            setIsActiveInView(false);
          }
        }
      },
      { root: scroller, threshold: [FEED_PAUSE_THRESHOLD, FEED_ACTIVE_THRESHOLD] },
    );
    for (const [index, card] of cardRefs.current) {
      card.dataset.index = String(index);
      observer.observe(card);
    }
    return () => observer.disconnect();
  }, [items]);

  // A swipe that turns back leaves the wrong card active, since its share never fell far enough to
  // say so. When scrolling settles, the card actually on screen is the active one.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !FEED_IMMERSIVE_OVERLAY) return;
    let timer: ReturnType<typeof setTimeout>;
    let lastTop = scroller.scrollTop;
    const settle = () => {
      const box = scroller.getBoundingClientRect();
      for (const [index, card] of cardRefs.current) {
        const cardBox = card.getBoundingClientRect();
        if (Math.abs(cardBox.top - box.top) < box.height / 2) {
          setActiveIndex(index);
          setIsActiveInView(true);
          return;
        }
      }
    };
    const onScroll = () => {
      scrollDirectionRef.current = Math.sign(scroller.scrollTop - lastTop);
      lastTop = scroller.scrollTop;
      clearTimeout(timer);
      timer = setTimeout(settle, 120);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Layout changes move the cards, so the players follow.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [items, reposition]);

  useEffect(() => {
    if (activeIndex !== null && hasMore && activeIndex >= items.length - FEED_LOAD_AHEAD) loadMore();
  }, [activeIndex, hasMore, items.length, loadMore]);

  // A signed-in person's saved state, for the videos just loaded.
  const checkedSavedRef = useRef(new Set<string>());
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    const unchecked = items.map((item) => item.id).filter((id) => !checkedSavedRef.current.has(id));
    if (unchecked.length === 0) return;
    unchecked.forEach((id) => checkedSavedRef.current.add(id));

    fetch(`/api/favorites?ids=${unchecked.slice(0, 50).join(",")}`)
      .then((response) => (response.ok ? (response.json() as Promise<{ savedIds: string[] }>) : { savedIds: [] }))
      .then(({ savedIds: ids }) => {
        const fresh = ids.filter((id) => !toggledSaveRef.current.has(id));
        if (fresh.length) setSavedIds((current) => new Set([...current, ...fresh]));
      })
      .catch(() => {
        // Shown as not saved. Saving again is harmless.
      });
  }, [items, sessionStatus]);

  const goTo = useCallback((index: number) => {
    cardRefs.current.get(index)?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }, []);

  const move = useCallback(
    (offset: number) => {
      const current = activeIndexRef.current ?? -1;
      const target = current + offset;
      if (target >= 0 && target < itemsRef.current.length) goTo(target);
    },
    [goTo],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable], [role=menu]")) return;

      if (event.key === "ArrowDown" || event.key === "PageDown") {
        event.preventDefault();
        move(1);
      } else if (event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        move(-1);
      } else if (event.key === "m" || event.key === "M") {
        toggleSound();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move, toggleSound]);

  const selectTab = (topicId: string | null) => {
    setSelectedTopicId(topicId);
    setActiveIndex(null);
    setIsActiveInView(false);
    scrollerRef.current?.scrollTo({ top: 0 });
  };

  useEffect(() => {
    // Saves the time to set up these connections when the first video and thumbnails load.
    preconnect("https://www.youtube.com");
    preconnect("https://i.ytimg.com");
  }, []);

  // Browsers don't count a scroll as permission for sound, so someone whose first touch is a swipe
  // would hear nothing. While sound is waiting, the feed moves with the finger itself. That makes
  // the swipe a plain touch, which browsers do accept. Normal scrolling returns straight after.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !isSoundLocked) return;
    let startY: number | null = null;
    let startTop = 0;
    let hasMoved = false;
    let restoreSnap: ReturnType<typeof setTimeout> | undefined;

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      clearTimeout(restoreSnap);
      startY = event.touches[0]!.clientY;
      startTop = scroller.scrollTop;
      hasMoved = false;
    };
    const onMove = (event: TouchEvent) => {
      if (startY === null) return;
      const distance = startY - event.touches[0]!.clientY;
      if (!hasMoved && Math.abs(distance) < 8) return;
      hasMoved = true;
      scroller.style.scrollSnapType = "none";
      scroller.scrollTop = startTop + distance;
    };
    const onEnd = (event: TouchEvent) => {
      if (startY === null) return;
      const distance = startY - event.changedTouches[0]!.clientY;
      startY = null;
      // A tap has its own handlers, and comes through as a click.
      if (!hasMoved) return;
      const height = scroller.clientHeight;
      const step = distance > SOUND_SWIPE_DISTANCE ? 1 : distance < -SOUND_SWIPE_DISTANCE ? -1 : 0;
      scroller.scrollTo({ top: (Math.round(startTop / height) + step) * height, behavior: prefersReducedMotion() ? "auto" : "smooth" });
      restoreSnap = setTimeout(() => {
        scroller.style.scrollSnapType = "";
      }, 500);
      unlockSound();
    };

    scroller.style.touchAction = "none";
    scroller.addEventListener("touchstart", onStart, { passive: true });
    scroller.addEventListener("touchmove", onMove, { passive: true });
    scroller.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      scroller.style.touchAction = "";
      scroller.removeEventListener("touchstart", onStart);
      scroller.removeEventListener("touchmove", onMove);
      scroller.removeEventListener("touchend", onEnd);
    };
  }, [isSoundLocked, unlockSound]);

  const hasPersonalChoices = selectedTopicIds.length > 0 || Object.keys(channelChoices).length > 0;
  const isFirstLoad = status === "loading" && items.length === 0;
  const isEmpty = status === "ready" && items.length === 0;
  const hasFailedOnFirstPage = status === "error" && items.length === 0;

  return (
    // The attribute hides the phone top bar, in globals.css, so the video gets that height too.
    <div className="relative flex flex-col" data-immersive-feed>
      {/* One button, top left, instead of a row of scrolling tabs. It opens the person's interests. */}
      <div className={cn("pointer-events-none flex h-(--feed-tabs-height) items-center justify-end px-3", FEED_IMMERSIVE_OVERLAY ? "absolute inset-x-0 top-0 z-40 bg-linear-to-b from-black/50 to-transparent" : "bg-black")} data-testid="feed-tabs">
        <div className="pointer-events-auto">
          <InterestsDrawer topics={topics} selectedTopicIds={selectedTopicIds} activeTopicId={selectedTopicId} onSelect={selectTab} />
        </div>
      </div>

      <div
        ref={scrollerRef}
        data-testid="feed-scroller"
        className={cn("relative bg-black [container-type:size] snap-y snap-mandatory overflow-y-auto overscroll-contain", FEED_IMMERSIVE_OVERLAY ? "h-[calc(100dvh-var(--top-bar-height)-var(--bottom-nav-height)-env(safe-area-inset-bottom))] md:h-dvh" : "h-[calc(100dvh-var(--top-bar-height)-var(--feed-tabs-height)-var(--bottom-nav-height)-env(safe-area-inset-bottom))] md:h-[calc(100dvh-var(--feed-tabs-height))]")}
      >
        {/* Each player sits over its own card's slot. Only the active card's is ever on screen. */}
        {Array.from({ length: 1 + FEED_BUFFER_AHEAD }, (_, index) => (
          <div
            key={index}
            ref={(element) => {
              mountsRef.current[index] = element;
            }}
            data-testid="player-mount"
            data-immersive-player={FEED_IMMERSIVE_OVERLAY || undefined}
            className="absolute z-10 hidden overflow-hidden bg-black"
          />
        ))}


        {isFirstLoad ? <FeedLoader /> : null}

        {hasFailedOnFirstPage ? (
          <div className="flex h-full snap-start">
            <StateMessage
              icon={TriangleAlert}
              role="alert"
              title={strings.feed.loadFailedTitle}
              description={strings.feed.loadFailedDescription}
              action={
                <Button onClick={retry}>
                  <RotateCw aria-hidden data-icon="inline-start" />
                  {strings.states.retry}
                </Button>
              }
            />
          </div>
        ) : null}

        {isEmpty ? (
          <div className="flex h-full snap-start" data-testid="feed-empty">
            <StateMessage
              icon={Clapperboard}
              title={strings.feed.emptyTitle}
              description={hasPersonalChoices ? strings.feed.emptyChoicesDescription : selectedTopicId ? strings.feed.emptyTopicDescription : strings.feed.emptyDescription}
              action={
                hasPersonalChoices ? (
                  <Button asChild variant="secondary">
                    <Link href="/interests" data-testid="feed-empty-edit">
                      {strings.feed.editChoices}
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : null}

        {items.map((video, index) => (
          <Card
            // A video can come round again once everything has been seen.
            key={`${video.id}:${index}`}
            ref={(element) => {
              if (element) cardRefs.current.set(index, element);
              else cardRefs.current.delete(index);
            }}
            slotRef={(element) => {
              if (element) slotRefs.current.set(index, element);
              else slotRefs.current.delete(index);
            }}
            video={video}
            isActive={index === activeIndex}
            isUpcoming={activeIndex !== null && index > activeIndex && index <= activeIndex + FEED_PRELOAD_THUMBNAILS}
            isNext={index === (activeIndex === null ? 0 : activeIndex + 1)}
            playback={playback}
            errorCode={errorCode}
            isMuted={isMuted}
            isSoundLocked={isSoundLocked}
            isLeaving={leavingKey === `${video.id}:${index}`}
            isSaved={savedIds.has(video.id)}
            notice={notice?.videoId === video.id ? notice.text : null}
            hasPrevious={index > 0}
            hasNext={index < items.length - 1}
            onToggleSound={toggleSound}
            onTapVideo={() => (isMuted ? toggleSound() : togglePlay())}
            onPrevious={() => goTo(index - 1)}
            onNext={() => goTo(index + 1)}
            onSavedChange={(isSaved) => {
              toggledSaveRef.current.add(video.id);
              if (isSaved) momentumRef.current = addSessionMomentum(momentumRef.current, video, "save");
              setSavedIds((current) => {
                const next = new Set(current);
                if (isSaved) next.add(video.id);
                else next.delete(video.id);
                return next;
              });
            }}
            onNotice={(text) => setNotice({ videoId: video.id, text })}
          />
        ))}

        {items.length > 0 && status === "error" ? (
          <div className="flex h-full snap-start">
            <StateMessage
              icon={TriangleAlert}
              role="alert"
              title={strings.feed.loadFailedTitle}
              description={strings.feed.loadFailedDescription}
              action={
                <Button onClick={retry}>
                  <RotateCw aria-hidden data-icon="inline-start" />
                  {strings.states.retry}
                </Button>
              }
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
