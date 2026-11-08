"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { checkChannelNowAction } from "@/app/(admin)/admin/sources/actions";
import { strings } from "@/config/strings.ar";

const t = strings.sources;
/** When the hourly job holds the channel, waiting a little is enough. */
const BUSY_RETRY_MS = 10_000;
/** How often an idle runner looks for a newly added channel. It costs nothing on the server. */
const IDLE_POLL_MS = 3_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Keeps first fetches moving while the page is open, one channel and one step at a time, so a
 * new channel fills up in minutes with no clicks. Each step is bounded on the server. If the page
 * closes, the hourly job carries on from the same place, so nothing depends on this staying open.
 */
export function FetchRunner({ channelIds }: { channelIds: string[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // Refreshing the page changes the list while a step is under way, so the loop reads the latest.
  const pending = useRef(channelIds);
  useEffect(() => {
    pending.current = channelIds;
  }, [channelIds]);

  useEffect(() => {
    let isCancelled = false;
    const finished = new Set<string>();

    const run = async () => {
      while (!isCancelled) {
        const id = pending.current.find((candidate) => !finished.has(candidate));
        if (!id) {
          await wait(IDLE_POLL_MS);
          continue;
        }
        const result = await checkChannelNowAction(id);
        if (isCancelled) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        router.refresh();
        const { stoppedBy, isBackfillComplete, arePlaylistsComplete } = result.data;
        if (stoppedBy === "BUSY") {
          await wait(BUSY_RETRY_MS);
          continue;
        }
        // Out of quota or not configured would fail for every channel, so it stops, saying why.
        if (stoppedBy === "QUOTA_CEILING" || stoppedBy === "QUOTA_EXCEEDED" || stoppedBy === "NOT_CONFIGURED") {
          setError(result.data.message);
          return;
        }
        // Its playlists come after its uploads, and are part of the first fetch too.
        if ((isBackfillComplete && arePlaylistsComplete !== false) || stoppedBy) finished.add(id);
      }
    };

    void run();
    return () => {
      isCancelled = true;
    };
  }, [router]);

  if (channelIds.length === 0 && !error) return null;
  return (
    <p role="status" className="flex items-center gap-2 rounded-xl border bg-surface px-3 py-2 text-sm text-text-secondary" data-testid="fetch-runner">
      {error ? (
        <span className="text-destructive">{error}</span>
      ) : (
        <>
          <Loader2 aria-hidden className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
          {t.keepOpen}
        </>
      )}
    </p>
  );
}
