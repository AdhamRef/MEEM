"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedPage, VideoCard } from "@/features/shorts/types";

export type FeedLoadStatus = "loading" | "ready" | "loading-more" | "error";

interface FeedState {
  query: string | null;
  items: VideoCard[];
  status: FeedLoadStatus;
  hasMore: boolean;
}

function feedUrl(query: string, cursor: string | null, sessionParams: Record<string, string>): string {
  const params = new URLSearchParams(query);
  if (cursor) params.set("cursor", cursor);
  for (const [name, value] of Object.entries(sessionParams)) params.set(name, value);
  return `/api/feed?${params.toString()}`;
}

/**
 * Pages through one feed, without an end: once everything has been seen it comes round again in
 * a new order. `query` identifies the feed, and changing it starts over. IDs are checked here
 * within each round as well as by the server's cursor, because a video opened from a shared link
 * sits first and can come up again in the feed behind it.
 */
export function useFeedPages(query: string | null, initialItem?: VideoCard, getSessionParams?: () => Record<string, string>) {
  const [stored, setStored] = useState<FeedState | null>(null);

  const cursorRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);
  const activeQueryRef = useRef<string | null>(null);
  const roundStartRef = useRef(0);
  const isRoundFinishedRef = useRef(false);
  const getSessionParamsRef = useRef(getSessionParams);
  useEffect(() => {
    getSessionParamsRef.current = getSessionParams;
  });

  // State from a previous query is ignored, so the old feed never shows under a new tab.
  const firstState: FeedState = { query, items: initialItem ? [initialItem] : [], status: "loading", hasMore: true };
  const current = stored?.query === query ? stored : firstState;

  const fetchPage = useCallback(
    async (feedQuery: string) => {
      isFetchingRef.current = true;
      try {
        const response = await fetch(feedUrl(feedQuery, cursorRef.current, getSessionParamsRef.current?.() ?? {}));
        if (!response.ok) throw new Error(`Feed request failed with status ${response.status}`);
        const page = (await response.json()) as FeedPage;
        if (activeQueryRef.current !== feedQuery) return;

        cursorRef.current = page.nextCursor;
        const isNewRound = isRoundFinishedRef.current;
        isRoundFinishedRef.current = page.nextCursor === null;
        setStored((previous) => {
          const base = previous?.query === feedQuery ? previous.items : initialItem ? [initialItem] : [];
          if (isNewRound) roundStartRef.current = base.length;
          const seen = new Set(base.slice(roundStartRef.current).map((item) => item.id));
          const items = [...base, ...page.items.filter((item) => !seen.has(item.id))];
          return { query: feedQuery, items, status: "ready", hasMore: items.length > 0 };
        });
      } catch {
        if (activeQueryRef.current !== feedQuery) return;
        setStored((previous) => ({
          query: feedQuery,
          items: previous?.query === feedQuery ? previous.items : initialItem ? [initialItem] : [],
          status: "error",
          hasMore: true,
        }));
      } finally {
        if (activeQueryRef.current === feedQuery) isFetchingRef.current = false;
      }
    },
    [initialItem],
  );

  useEffect(() => {
    if (query === null) return;
    activeQueryRef.current = query;
    cursorRef.current = null;
    roundStartRef.current = 0;
    isRoundFinishedRef.current = false;
    void fetchPage(query);
  }, [query, fetchPage]);

  const markLoading = useCallback((feedQuery: string, status: FeedLoadStatus) => {
    setStored((previous) => (previous?.query === feedQuery ? { ...previous, status } : previous));
  }, []);

  const loadMore = useCallback(() => {
    if (query === null || isFetchingRef.current || (!cursorRef.current && !isRoundFinishedRef.current)) return;
    markLoading(query, "loading-more");
    void fetchPage(query);
  }, [query, fetchPage, markLoading]);

  /** Repeats whatever failed, from where it stopped. */
  const retry = useCallback(() => {
    if (query === null || isFetchingRef.current) return;
    markLoading(query, cursorRef.current === null ? "loading" : "loading-more");
    void fetchPage(query);
  }, [query, fetchPage, markLoading]);

  return { items: current.items, status: current.status, hasMore: current.hasMore, loadMore, retry };
}
