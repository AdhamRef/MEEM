/* eslint-disable @next/next/no-img-element -- Thumbnails load directly from YouTube by design, and aren't re-processed or re-hosted. */
import { AlertTriangle, ArrowRight, ListVideo, ShieldX } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { bulkAssignVideosAction, bulkPublishVideosAction, listMatchingVideoIdsAction } from "@/app/(admin)/admin/shorts/actions";
import { selectClass } from "@/components/admin/content/list-frame";
import { ChannelSourceActions } from "@/components/admin/sources/channel-source-actions";
import { ChannelTopics } from "@/components/admin/sources/channel-topics";
import { FetchRunner } from "@/components/admin/sources/fetch-runner";
import { ChannelAvatar, ProgressBar, WorkingBar } from "@/components/admin/sources/visuals";
import { BulkList } from "@/components/admin/videos/bulk-list";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { strings } from "@/config/strings.ar";
import { formatDuration } from "@/features/playlists/rules";
import { listVideosForAdmin } from "@/features/shorts/videos-admin.service";
import { getSourceChannel, listChannelPlaylists } from "@/features/youtube/sources/sources.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { AppError } from "@/lib/errors";
import { hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/format";
import { isYouTubeApiConfigured } from "@/lib/youtube/client";

const t = strings.sources;
const v = strings.videosAdmin;

export const metadata = { title: strings.sources.channelVideosTitle };
export const maxDuration = 60;

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; kind?: string; query?: string; cursor?: string }>;
}

const oneOf = <T extends string>(value: string | undefined, options: readonly T[]): T | undefined => ((options as readonly string[]).includes(value ?? "") ? (value as T) : undefined);

export default async function SourceChannelPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const access = await checkPageAccess("admin.access", `/admin/sources/channels/${id}`);
  if (!access.allowed) return null;
  const { actor } = access;
  if (!hasPermission(actor, "youtube.import") || !hasPermission(actor, "content.publish")) {
    return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;
  }

  let channel;
  try {
    channel = await getSourceChannel(actor, id);
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION")) notFound();
    throw error;
  }

  const query = await searchParams;
  const status = oneOf(query.status, ["PUBLISHED", "DRAFT"] as const);
  const kind = oneOf(query.kind, ["SHORT", "LONG_FORM"] as const);
  const search = query.query?.trim() || undefined;
  const filter = { channelId: channel.id, ...(status ? { status } : {}), ...(kind ? { kind } : {}), ...(search ? { query: search } : {}) };
  const [page, playlists] = await Promise.all([listVideosForAdmin(actor, { ...filter, cursor: query.cursor }), listChannelPlaylists(actor, channel.id)]);

  const stored = channel.publishedCount + channel.hiddenCount;
  const isFetching = channel.isFollowed === true && channel.isBackfillComplete !== true;
  const isFetchingPlaylists = channel.isFollowed === true && channel.isBackfillComplete === true && channel.isPlaylistsComplete !== true;
  const total = channel.youtubeVideoCount ?? 0;
  const base = `/admin/sources/channels/${channel.id}`;
  const hrefWith = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ status, kind, query: search, ...changes })) if (value) next.set(key, value);
    const text = next.toString();
    return text ? `${base}?${text}` : base;
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <Link href="/admin/sources" className="inline-flex min-h-11 items-center gap-1 text-sm text-text-secondary outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <ArrowRight aria-hidden className="size-4" />
        {t.backToSources}
      </Link>

      <header className="flex flex-wrap items-start gap-4 rounded-2xl border bg-surface p-4 sm:p-5">
        <ChannelAvatar url={channel.thumbnailUrl} className="size-16" />
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="truncate text-xl font-semibold">
            <bdi>{channel.title || strings.importer.channelWithdrawn}</bdi>
          </h1>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-text-secondary">
            {channel.handle ? <bdi dir="ltr">{channel.handle}</bdi> : null}
            <span>{t.published(channel.publishedCount)}</span>
            <span>{t.hidden(channel.hiddenCount)}</span>
            <span>{channel.isFollowed !== true ? t.paused : channel.lastCheckedAt ? t.lastChecked(formatDate(channel.lastCheckedAt)) : t.neverChecked}</span>
          </p>
          {isFetching ? (
            <div className="max-w-sm space-y-1 text-xs font-medium text-brand">
              <p>{total > 0 ? t.fetchingProgress(stored, total) : t.fetchingCount(stored)}</p>
              {total > 0 ? <ProgressBar value={stored} max={total} label={t.fetching} /> : <WorkingBar />}
            </div>
          ) : null}
          {channel.lastCheckError ? (
            <p className="flex items-center gap-1 text-sm text-destructive">
              <AlertTriangle aria-hidden className="size-4 shrink-0" />
              {channel.lastCheckError}
            </p>
          ) : null}
          <ChannelTopics channelId={channel.id} topicTitles={channel.topics.map(({ topic }) => topic.title)} canManage={hasPermission(actor, "topics.manage")} />
        </div>
        <ChannelSourceActions channelId={channel.id} youtubeChannelId={channel.youtubeChannelId} isFollowed={channel.isFollowed === true} canCheck={isYouTubeApiConfigured()} />
      </header>

      {(isFetching || isFetchingPlaylists) && isYouTubeApiConfigured() && !channel.lastCheckError ? <FetchRunner channelIds={[channel.id]} /> : null}

      <section aria-labelledby="channel-playlists-title" className="space-y-3" data-testid="channel-playlists">
        <div className="space-y-1">
          <h2 id="channel-playlists-title" className="flex items-center gap-2 font-semibold">
            {t.channelPlaylistsTitle}
            <span className="rounded-full bg-surface-elevated px-2 text-xs tabular-nums">{playlists.length}</span>
          </h2>
          <p className="text-sm text-text-secondary">{isFetchingPlaylists ? t.fetchingPlaylists : t.channelPlaylistsHint}</p>
        </div>
        {playlists.length ? (
          <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
            {playlists.map((playlist) => (
              <li key={playlist.id} className="w-56 shrink-0 snap-start">
                <Link href={`/admin/playlists/${playlist.id}`} className="group block space-y-2 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50" data-testid="channel-playlist">
                  <span className="relative block overflow-hidden rounded-xl bg-surface-elevated">
                    {playlist.thumbnailUrl ? (
                      <img src={playlist.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="strict-origin-when-cross-origin" className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transform-none" />
                    ) : (
                      <span className="flex aspect-video w-full items-center justify-center text-text-secondary">
                        <ListVideo aria-hidden className="size-6" />
                      </span>
                    )}
                    <span className="absolute end-1.5 bottom-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-medium text-white">{t.playlistItems(playlist.itemCount)}</span>
                  </span>
                  <span dir="auto" className="line-clamp-2 text-start text-sm leading-snug font-medium group-hover:text-brand">
                    {playlist.title || strings.playlists.dataWithdrawn}
                  </span>
                  <span className="block text-xs text-text-secondary">{playlist.status === "PUBLISHED" ? t.playlistPublished : t.playlistDraft}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed p-4 text-center text-sm text-text-secondary">{t.channelPlaylistsEmpty}</p>
        )}
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-semibold">{t.channelVideosTitle}</h2>
          <p className="text-sm text-text-secondary">{t.channelVideosHint}</p>
        </div>

        <nav aria-label={t.channelVideosTitle} className="flex flex-wrap gap-2">
          {(
            [
              [undefined, t.filterAll, stored],
              ["PUBLISHED", t.filterPublished, channel.publishedCount],
              ["DRAFT", t.filterHidden, channel.hiddenCount],
            ] as const
          ).map(([value, label, count]) => (
            <Link
              key={label}
              href={hrefWith({ status: value, cursor: undefined })}
              aria-current={status === value ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                status === value ? "border-brand bg-surface-elevated font-medium" : "text-text-secondary hover:bg-surface-elevated",
              )}
              data-testid={`channel-filter-${value ?? "ALL"}`}
            >
              {label}
              <span className="tabular-nums">{count}</span>
            </Link>
          ))}
        </nav>

        <form method="get" role="search" className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <Input name="query" type="search" defaultValue={search} placeholder={strings.adminContent.search} aria-label={strings.adminContent.search} />
          <select name="kind" defaultValue={kind ?? ""} aria-label={v.kind} className={selectClass}>
            <option value="">{v.allKinds}</option>
            <option value="SHORT">{strings.content.short}</option>
            <option value="LONG_FORM">{strings.content.longVideo}</option>
          </select>
          <Button type="submit" variant="secondary">
            {strings.adminContent.searchAction}
          </Button>
        </form>

        <BulkList
          key={JSON.stringify(filter)}
          total={page.total}
          onListIds={listMatchingVideoIdsAction.bind(null, filter)}
          showKind
          canEdit={hasPermission(actor, "content.editAny")}
          canPublish
          onAssign={bulkAssignVideosAction}
          onPublish={bulkPublishVideosAction}
          emptyMessage={search || kind || status ? strings.adminContent.noResults : isFetching ? t.fetching : v.empty}
          rows={page.items.map((row) => ({
            id: row.id,
            href: `/admin/shorts/${row.id}`,
            title: row.title || v.withdrawn,
            hint: [row.kind === "SHORT" ? strings.content.short : strings.content.longVideo, formatDuration(row.durationSeconds)].filter(Boolean).join(" · "),
            thumbnailUrl: row.thumbnailUrl,
            status: row.status,
            isArchived: row.isArchived,
            badges: row.availability === "AVAILABLE" ? [] : [{ label: v.availability[row.availability], isWarning: true }],
          }))}
        />

        {page.nextCursor ? (
          <div className="text-center">
            <Button asChild variant="secondary">
              <Link href={hrefWith({ cursor: page.nextCursor })}>{strings.adminContent.nextPage}</Link>
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
