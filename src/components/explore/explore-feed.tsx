"use client";

import { Clapperboard, RotateCw } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EXPLORE_LONG_PAGE, EXPLORE_SHORTS_PAGE } from "@/config/feed";
import { strings } from "@/config/strings.ar";
import type { FeedPage, VideoCard } from "@/features/shorts/types";
import { ExploreShortCard, ExploreVideoCard, shortsGridClass, VideoCardSkeleton, videoGridClass } from "./explore-cards";
import { Shelf } from "./shelf";

const e = strings.explore;

/** Rows of videos between each shelf. */
const CHUNK_SIZE = 12;

interface ExploreFeedProps {
  categoryId: string | null;
  initialVideos: FeedPage;
  initialShorts: FeedPage;
  /** Editorial rows, made on the server, placed between the videos. */
  shelves: ReactNode[];
}

async function fetchPage(kind: "SHORT" | "LONG_FORM", categoryId: string | null, cursor: string, size: number): Promise<FeedPage> {
  const params = new URLSearchParams({ kind, cursor, size: String(size) });
  if (categoryId) params.set("categoryId", categoryId);
  const response = await fetch(`/api/explore/videos?${params.toString()}`);
  if (!response.ok) throw new Error(`Explore request failed with status ${response.status}`);
  return (await response.json()) as FeedPage;
}

const chunked = <T,>(items: T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/**
 * Everything published, a screenful at a time. Videos fill a grid, with a row of Shorts and an
 * editorial shelf between each stretch. Once long videos run out, Shorts carry on as a grid,
 * so nothing is hidden behind a limit.
 */
export function ExploreFeed({ categoryId, initialVideos, initialShorts, shelves }: ExploreFeedProps) {
  const [videos, setVideos] = useState<VideoCard[]>(initialVideos.items);
  const [shorts, setShorts] = useState<VideoCard[]>(initialShorts.items);
  const [videoCursor, setVideoCursor] = useState(initialVideos.nextCursor);
  const [shortsCursor, setShortsCursor] = useState(initialShorts.nextCursor);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [now] = useState(() => new Date());

  const isBusyRef = useRef(false);
  // A ref, because a failure moves the page, which can fire the observer before it's been disconnected.
  const hasFailedRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = videoCursor !== null || shortsCursor !== null;

  const loadMore = useCallback(async () => {
    if (isBusyRef.current) return;
    isBusyRef.current = true;
    hasFailedRef.current = false;
    setStatus("loading");
    try {
      const [videoPage, shortsPage] = await Promise.all([
        videoCursor ? fetchPage("LONG_FORM", categoryId, videoCursor, EXPLORE_LONG_PAGE) : null,
        // With long videos finished, Shorts are all that's left, so they come in larger pages.
        shortsCursor ? fetchPage("SHORT", categoryId, shortsCursor, videoCursor ? EXPLORE_SHORTS_PAGE : EXPLORE_LONG_PAGE) : null,
      ]);
      if (videoPage) {
        setVideos((current) => [...current, ...videoPage.items]);
        setVideoCursor(videoPage.nextCursor);
      }
      if (shortsPage) {
        setShorts((current) => [...current, ...shortsPage.items]);
        setShortsCursor(shortsPage.nextCursor);
      }
      setStatus("idle");
    } catch {
      hasFailedRef.current = true;
      setStatus("error");
    } finally {
      isBusyRef.current = false;
    }
  }, [categoryId, shortsCursor, videoCursor]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || status === "error") return;
    const observer = new IntersectionObserver(
      (entries) => {
        // After a failure, only the retry button tries again, so a server in trouble isn't hammered.
        if (!hasFailedRef.current && entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      // Early enough that scrolling never reaches an empty space.
      { rootMargin: "900px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, status]);

  const videoChunks = chunked(videos, CHUNK_SIZE);
  const shortShelves = chunked(shorts, EXPLORE_SHORTS_PAGE);
  const shelvesInline = shortShelves.slice(0, videoChunks.length);
  const shortsLeft = shortShelves.slice(videoChunks.length).flat();

  return (
    <div className="space-y-10" data-testid="explore-feed">
      {videoChunks.map((chunk, index) => (
        <Fragment key={index}>
          <div className={videoGridClass} data-testid="video-grid">
            {chunk.map((video) => (
              <ExploreVideoCard key={video.id} video={video} now={now} />
            ))}
          </div>
          {shelvesInline[index]?.length ? (
            <Shelf id={index === 0 ? "shorts" : `shorts-${index}`} title={e.shorts} icon={Clapperboard} itemClass="w-40 sm:w-44">
              {shelvesInline[index].map((video) => (
                <ExploreShortCard key={video.id} video={video} />
              ))}
            </Shelf>
          ) : null}
          {shelves[index] ?? null}
        </Fragment>
      ))}

      {shortsLeft.length ? (
        <section aria-labelledby="more-shorts" data-testid="section-more-shorts">
          <h2 id="more-shorts" className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <Clapperboard aria-hidden className="size-5 text-brand" />
            {e.shorts}
          </h2>
          <div className={shortsGridClass}>
            {shortsLeft.map((video) => (
              <ExploreShortCard key={video.id} video={video} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Whatever shelves didn't get a place between videos still appear. */}
      {shelves.slice(videoChunks.length).map((shelf, index) => (
        <Fragment key={index}>{shelf}</Fragment>
      ))}

      {hasMore ? <div ref={sentinelRef} aria-hidden className="h-px" data-testid="explore-sentinel" /> : null}

      {status === "loading" ? (
        <div role="status" aria-label={strings.states.loading} className={videoGridClass} data-testid="explore-loading-more">
          {Array.from({ length: 8 }, (_, index) => (
            <VideoCardSkeleton key={index} />
          ))}
        </div>
      ) : null}

      {status === "error" ? (
        <div role="alert" className="flex flex-col items-center gap-3 py-6 text-sm text-text-secondary">
          <p>{e.loadFailed}</p>
          <Button variant="secondary" onClick={() => void loadMore()} data-testid="explore-retry">
            <RotateCw aria-hidden data-icon="inline-start" />
            {strings.states.retry}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
