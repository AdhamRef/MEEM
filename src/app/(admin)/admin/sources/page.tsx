/* eslint-disable @next/next/no-img-element -- Thumbnails load directly from YouTube by design, and aren't re-processed or re-hosted. */
import { AlertTriangle, ListVideo, ShieldX, Tv } from "lucide-react";
import Link from "next/link";
import { AddSourceForm } from "@/components/admin/sources/add-source-form";
import { ChannelSourceActions } from "@/components/admin/sources/channel-source-actions";
import { FetchRunner } from "@/components/admin/sources/fetch-runner";
import { ChannelAvatar, ProgressBar, StatTile, WorkingBar } from "@/components/admin/sources/visuals";
import { StateMessage } from "@/components/shared/state-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { strings } from "@/config/strings.ar";
import { getSourcesOverview, listFollowedChannels, listSourcePlaylists, listUnfollowedChannels } from "@/features/youtube/sources/sources.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { formatDate, formatNumber } from "@/lib/utils/format";

const t = strings.sources;

export const metadata = { title: t.title };
// Server Actions on this page run one bounded fetch step each, of up to about 20 seconds.
export const maxDuration = 60;

type ChannelRow = Awaited<ReturnType<typeof listFollowedChannels>>["items"][number];

function ChannelStatus({ channel }: { channel: ChannelRow }) {
  const stored = channel.publishedCount + channel.hiddenCount;
  if (channel.isFollowed !== true) return <span>{t.paused}</span>;
  if (channel.isBackfillComplete !== true) {
    const total = channel.youtubeVideoCount ?? 0;
    return (
      <span className="flex w-full max-w-xs flex-col gap-1">
        <span className="font-medium text-brand">{total > 0 ? t.fetchingProgress(stored, total) : t.fetchingCount(stored)}</span>
        {total > 0 ? <ProgressBar value={stored} max={total} label={t.fetching} /> : <WorkingBar />}
      </span>
    );
  }
  return <span>{[t.upToDate, channel.lastCheckedAt ? t.lastChecked(formatDate(channel.lastCheckedAt)) : t.neverChecked].join(" · ")}</span>;
}

function ChannelList({ channels, canCheck, testId }: { channels: ChannelRow[]; canCheck: boolean; testId: string }) {
  return (
    <ul className="divide-y overflow-hidden rounded-2xl border bg-surface" data-testid={testId}>
      {channels.map((channel) => (
        <li key={channel.id} className="flex flex-wrap items-start gap-3 p-3 sm:flex-nowrap sm:items-center sm:p-4" data-testid="source-channel">
          <ChannelAvatar url={channel.thumbnailUrl} className="size-12" />
          <div className="min-w-0 flex-1 space-y-1">
            <Link href={`/admin/sources/channels/${channel.id}`} className="block truncate font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50" data-testid="source-channel-link">
              <bdi>{channel.title || strings.importer.channelWithdrawn}</bdi>
            </Link>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
              {channel.handle ? <bdi dir="ltr">{channel.handle}</bdi> : null}
              <span>{t.published(channel.publishedCount)}</span>
              {channel.hiddenCount ? <span>{t.hidden(channel.hiddenCount)}</span> : null}
              {channel.topics.length ? (
                channel.topics.map(({ topic }) => (
                  <Badge key={topic.title} variant="secondary">
                    {topic.title}
                  </Badge>
                ))
              ) : (
                <Badge variant="outline">{strings.importer.channelNoTopics}</Badge>
              )}
            </p>
            <div className="text-xs text-text-secondary" data-testid="source-channel-status">
              <ChannelStatus channel={channel} />
            </div>
            {channel.lastCheckError ? (
              <p className="flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
                {channel.lastCheckError}
              </p>
            ) : null}
          </div>
          <ChannelSourceActions channelId={channel.id} youtubeChannelId={channel.youtubeChannelId} isFollowed={channel.isFollowed === true} canCheck={canCheck} />
        </li>
      ))}
    </ul>
  );
}

interface PageProps {
  searchParams: Promise<{ tab?: string; query?: string; cursor?: string }>;
}

export default async function SourcesPage({ searchParams }: PageProps) {
  const access = await checkPageAccess("admin.access", "/admin/sources");
  if (!access.allowed) return null;
  const { actor } = access;
  if (!hasPermission(actor, "youtube.import") || !hasPermission(actor, "content.publish")) {
    return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;
  }

  const params = await searchParams;
  const tab = params.tab === "playlists" ? "playlists" : "channels";
  const query = params.query?.trim() || undefined;

  const [overview, channels, unfollowed, playlists] = await Promise.all([
    getSourcesOverview(actor),
    tab === "channels" ? listFollowedChannels(actor, { query, cursor: params.cursor }) : null,
    tab === "channels" && !query && !params.cursor ? listUnfollowedChannels(actor) : [],
    tab === "playlists" ? listSourcePlaylists(actor, { cursor: params.cursor }) : null,
  ]);
  const canCheck = overview.isConfigured;
  const fetchingIds = (channels?.items ?? []).filter((channel) => channel.isBackfillComplete !== true && !channel.lastCheckError).map((channel) => channel.id);
  const scheduleNote = !overview.autoCheckEnabled ? t.autoCheckOff : !overview.isScheduleConfigured ? t.scheduleMissing : null;
  const nextHref = (cursor: string) => `/admin/sources?${new URLSearchParams({ tab, ...(query ? { query } : {}), cursor })}`;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="max-w-3xl text-sm text-text-secondary">{t.description}</p>
      </header>

      <section className="space-y-2" aria-label={t.title}>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="sources-overview">
          <StatTile label={t.overviewFollowed} value={formatNumber(overview.followedChannels)} />
          <StatTile label={t.overviewFetching} value={formatNumber(overview.fetchingChannels)} />
          <StatTile label={t.overviewPlaylists} value={formatNumber(overview.playlists)} />
          <StatTile label={t.overviewQuota} value={t.overviewQuotaValue(overview.quotaUnitsToday, overview.quotaCeiling)} tone={overview.quotaUnitsToday >= overview.quotaCeiling ? "alert" : undefined} />
        </dl>
        <p className="text-xs text-text-secondary" data-testid="sources-schedule">
          {overview.lastScheduledRun ? t.lastRun(formatDate(overview.lastScheduledRun)) : t.noRunYet}
          {scheduleNote ? <span className="block text-destructive">{scheduleNote}</span> : null}
        </p>
      </section>

      <AddSourceForm unavailableReason={overview.isConfigured ? null : t.apiNotConfigured} />

      {canCheck ? <FetchRunner channelIds={fetchingIds} /> : null}

      <nav aria-label={t.tabsLabel} className="flex gap-1 border-b">
        {(
          [
            ["channels", t.channelsTab, Tv, overview.followedChannels],
            ["playlists", t.playlistsTab, ListVideo, overview.playlists],
          ] as const
        ).map(([key, label, Icon, count]) => (
          <Link
            key={key}
            href={`/admin/sources?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "-mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              tab === key ? "border-brand font-medium" : "border-transparent text-text-secondary hover:text-foreground",
            )}
            data-testid={`sources-tab-${key}`}
          >
            <Icon aria-hidden className="size-4" />
            {label}
            <span className="rounded-full bg-surface-elevated px-2 text-xs tabular-nums">{formatNumber(count)}</span>
          </Link>
        ))}
      </nav>

      {channels ? (
        <section className="space-y-4">
          {overview.followedChannels > 0 || query ? (
            <form method="get" role="search" className="flex gap-2">
              <input type="hidden" name="tab" value="channels" />
              <Input name="query" type="search" defaultValue={query} placeholder={strings.adminContent.search} aria-label={strings.adminContent.search} />
              <Button type="submit" variant="secondary">
                {strings.adminContent.searchAction}
              </Button>
            </form>
          ) : null}

          {channels.items.length === 0 ? (
            <StateMessage icon={Tv} title={query ? strings.adminContent.noResults : t.channelsEmpty} />
          ) : (
            <ChannelList channels={channels.items} canCheck={canCheck} testId="source-channels" />
          )}

          {channels.nextCursor ? (
            <div className="text-center">
              <Button asChild variant="secondary">
                <Link href={nextHref(channels.nextCursor)}>{strings.adminContent.nextPage}</Link>
              </Button>
            </div>
          ) : null}

          {unfollowed.length ? (
            <details className="group space-y-3" data-testid="unfollowed-channels">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                {t.unfollowedTitle}
                <span className="rounded-full bg-surface-elevated px-2 text-xs tabular-nums">{formatNumber(unfollowed.length)}</span>
              </summary>
              <p className="text-xs text-text-secondary">{t.unfollowedHint}</p>
              <ChannelList channels={unfollowed} canCheck={canCheck} testId="unfollowed-list" />
            </details>
          ) : null}
        </section>
      ) : null}

      {playlists ? (
        <section className="space-y-4">
          {playlists.items.length === 0 ? (
            <StateMessage icon={ListVideo} title={t.playlistsEmpty} />
          ) : (
            <ul className="divide-y overflow-hidden rounded-2xl border bg-surface" data-testid="source-playlists">
              {playlists.items.map((playlist) => (
                <li key={playlist.id} className="flex items-center gap-3 p-3 sm:p-4" data-testid="source-playlist">
                  {playlist.thumbnailUrl ? (
                    <img src={playlist.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="aspect-video w-24 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span aria-hidden className="flex aspect-video w-24 shrink-0 items-center justify-center rounded-lg bg-surface-elevated text-text-secondary">
                      <ListVideo className="size-5" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <Link href={`/admin/playlists/${playlist.id}`} className="block truncate font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
                      <bdi>{playlist.title || strings.playlists.dataWithdrawn}</bdi>
                    </Link>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
                      <Badge variant={playlist.status === "PUBLISHED" ? "secondary" : "outline"}>{playlist.status === "PUBLISHED" ? t.playlistPublished : t.playlistDraft}</Badge>
                      <span>{t.playlistItems(playlist.itemCount)}</span>
                      {playlist.channelTitle ? <bdi>{playlist.channelTitle}</bdi> : null}
                      <span>{playlist.metadataFetchedAt ? t.lastChecked(formatDate(playlist.metadataFetchedAt)) : t.neverChecked}</span>
                      {playlist.syncStatus === "FAILED" ? <span className="text-destructive">{t.playlistSyncFailed}</span> : null}
                    </p>
                  </div>
                  <Button asChild variant="ghost">
                    <Link href={`/admin/playlists/${playlist.id}`}>{t.playlistManage}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {playlists.nextCursor ? (
            <div className="text-center">
              <Button asChild variant="secondary">
                <Link href={nextHref(playlists.nextCursor)}>{strings.adminContent.nextPage}</Link>
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
