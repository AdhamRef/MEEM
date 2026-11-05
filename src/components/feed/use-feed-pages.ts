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

function feedUrl(query: string, cursor: string | null): string {
  const params = new URLSearchParams(query);
  if (cursor) params.set("cursor", cursor);
  return `/api/feed?${params.toString()}`;
}

/**
 * Pages through one feed. `query` identifies the feed, and changing it starts over. IDs are
 * checked here as well as by the server's cursor, because a video opened from a shared link
 * sits first and can come up again in the feed behind it.
 */
export function useFeedPages(query: string | null, initialItem?: VideoCard) {
  const [stored, setStored] = useState<FeedState | null>(null);

  const cursorRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);
  const activeQueryRef = useRef<string | null>(null);

  // State from a previous query is ignored, so the old feed never shows under a new tab.
  const firstState: FeedState = { query, items: initialItem ? [initialItem] : [], status: "loading", hasMore: true };
  const current = stored?.query === query ? stored : firstState;

  const fetchPage = useCallback(
    async (feedQuery: string) => {
      isFetchingRef.current = true;
      try {
        const response = await fetch(feedUrl(feedQuery, cursorRef.current));
        if (!response.ok) throw new Error(`Feed request failed with status ${response.status}`);
        const page = (await response.json()) as FeedPage;
        if (activeQueryRef.current !== feedQuery) return;

        cursorRef.current = page.nextCursor;
        setStored((previous) => {
          const base = previous?.query === feedQuery ? previous.items : initialItem ? [initialItem] : [];
          const seen = new Set(base.map((item) => item.id));
          return { query: feedQuery, items: [...base, ...page.items.filter((item) => !seen.has(item.id))], status: "ready", hasMore: page.nextCursor !== null };
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
    void fetchPage(query);
  }, [query, fetchPage]);

  const markLoading = useCallback((feedQuery: string, status: FeedLoadStatus) => {
    setStored((previous) => (previous?.query === feedQuery ? { ...previous, status } : previous));
  }, []);

  const loadMore = useCallback(() => {
    if (query === null || isFetchingRef.current || !cursorRef.current) return;
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
