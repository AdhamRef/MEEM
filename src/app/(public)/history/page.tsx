/* eslint-disable @next/next/no-img-element -- Thumbnails load directly from YouTube by design. */
import { Compass, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ClearHistoryButton } from "@/components/library/library-actions";
import { LibraryGuestState, LibraryRow, LibraryTabs } from "@/components/library/library-parts";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { listContinueWatching, listHistory, type ContinueWatchingItem } from "@/features/users/library.service";
import { getCurrentActor } from "@/lib/auth/session";

const l = strings.library;

export const metadata: Metadata = { title: l.historyTitle, robots: { index: false, follow: false } };

function ContinueCard({ item }: { item: ContinueWatchingItem }) {
  const percent = item.durationSeconds ? Math.min(100, Math.round((item.positionSeconds / item.durationSeconds) * 100)) : null;
  return (
    <Link href={item.href} className="flex h-full flex-col overflow-hidden rounded-xl border bg-surface outline-none transition-colors hover:bg-surface-elevated focus-visible:ring-3 focus-visible:ring-ring/50" data-testid="continue-card">
      {item.video.thumbnailUrl ? <img src={item.video.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="strict-origin-when-cross-origin" className="aspect-video w-full bg-black object-cover" /> : null}
      {/* Only shown when YouTube reported the length, so it's never a guess. */}
      {percent !== null ? (
        <div role="progressbar" aria-label={l.progressLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1 w-full bg-surface-elevated">
          <div className="h-full bg-brand" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <bdi className="line-clamp-2 text-start text-sm font-medium">{item.video.title}</bdi>
        {item.playlistTitle ? (
          <span className="truncate text-xs text-text-secondary">
            {l.inPlaylist} <bdi>{item.playlistTitle}</bdi>
          </span>
        ) : null}
        <span className="mt-auto truncate pt-1 text-xs text-text-secondary">
          {item.video.channelTitle ? (
            <>
              <bdi>{item.video.channelTitle}</bdi> ·{" "}
            </>
          ) : null}
          {strings.feed.source}
        </span>
      </div>
    </Link>
  );
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const actor = await getCurrentActor();
  if (!actor) return <LibraryGuestState path="/history" />;

  const { cursor } = await searchParams;
  const [page, continueWatching] = await Promise.all([listHistory(actor, { cursor }), cursor ? [] : listContinueWatching(actor)]);
  // Entries that are no longer public have nowhere to go, and history can do without them.
  const entries = page.items.filter((entry) => entry.content);
  const isEmpty = entries.length === 0 && continueWatching.length === 0 && !page.nextCursor;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8" data-testid="history-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">{l.historyTitle}</h1>
        {isEmpty ? null : <ClearHistoryButton />}
      </div>
      <LibraryTabs active="history" />

      {isEmpty ? (
        <StateMessage
          icon={History}
          title={l.historyEmptyTitle}
          description={l.historyEmptyDescription}
          action={
            <Button asChild variant="secondary">
              <Link href="/explore">
                <Compass aria-hidden data-icon="inline-start" />
                {l.browse}
              </Link>
            </Button>
          }
        />
      ) : null}

      {continueWatching.length ? (
        <section aria-labelledby="continue-watching" data-testid="section-continue-watching">
          <h2 id="continue-watching" className="mb-3 text-lg font-semibold">
            {l.continueWatching}
          </h2>
          <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3">
            {continueWatching.map((item) => (
              <li key={`${item.video.id}:${item.href}`}>
                <ContinueCard item={item} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {entries.length ? (
        <section aria-labelledby="recent-items">
          <h2 id="recent-items" className="mb-3 text-lg font-semibold">
            {l.recent}
          </h2>
          <ul className="divide-y rounded-xl border bg-surface" data-testid="history-list">
            {entries.map((entry) => (
              <LibraryRow key={entry.id} entry={entry} list="history" />
            ))}
          </ul>
        </section>
      ) : null}

      {page.nextCursor ? (
        <div className="text-center">
          <Button asChild variant="secondary">
            <Link href={`/history?cursor=${page.nextCursor}`} data-testid="history-more">
              {strings.content.showMore}
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
