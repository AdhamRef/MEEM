/* eslint-disable @next/next/no-img-element -- Channel images load directly from YouTube by design. */
import { ShieldX, Tv } from "lucide-react";
import Link from "next/link";
import { ChannelActions } from "@/components/admin/importer/channel-actions";
import { StateMessage } from "@/components/shared/state-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { strings } from "@/config/strings.ar";
import { listChannels } from "@/features/youtube/channels.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";
import { formatDate } from "@/lib/utils/format";
import { isYouTubeApiConfigured } from "@/lib/youtube/client";

const t = strings.importer;

export const metadata = { title: strings.admin.channels };

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ query?: string; cursor?: string }> }) {
  const access = await checkPageAccess("admin.access", "/admin/channels");
  if (!access.allowed) return null;
  if (!hasPermission(access.actor, "youtube.import")) return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;

  const { query, cursor } = await searchParams;
  const channels = await listChannels(access.actor, { query, cursor });
  const isConfigured = isYouTubeApiConfigured();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{strings.admin.channels}</h1>
        <Button asChild>
          <Link href="/admin/youtube-importer">{t.title}</Link>
        </Button>
      </header>

      <form method="get" role="search" className="flex gap-2">
        <Input name="query" type="search" defaultValue={query} placeholder={strings.adminContent.search} aria-label={strings.adminContent.search} />
        <Button type="submit" variant="secondary">
          {strings.adminContent.searchAction}
        </Button>
      </form>

      {channels.items.length === 0 ? (
        <StateMessage icon={Tv} title={query ? strings.adminContent.noResults : t.channelsEmpty} />
      ) : (
        <ul className="space-y-2" data-testid="channel-list">
          {channels.items.map((channel) => (
            <li key={channel.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-surface p-3" data-testid="channel-row">
              {channel.thumbnailUrl ? <img src={channel.thumbnailUrl} alt="" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" className="size-12 rounded-full" /> : null}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <bdi className="truncate">{channel.title || t.channelWithdrawn}</bdi>
                  {channel.isActive ? null : <Badge variant="outline">{t.channelInactive}</Badge>}
                </p>
                <p className="text-xs text-text-secondary">
                  {channel.handle ? <bdi dir="ltr">{channel.handle} · </bdi> : null}
                  {t.channelVideos(channel._count.videos)} · {t.lastSynced}: {channel.lastSyncedAt ? formatDate(channel.lastSyncedAt) : t.neverSynced} · {strings.feed.source}
                </p>
              </div>
              <ChannelActions channelId={channel.id} isActive={channel.isActive} canSync={isConfigured && Boolean(channel.title)} />
            </li>
          ))}
        </ul>
      )}

      {!isConfigured ? <p className="text-sm text-text-secondary">{t.apiNotConfigured}</p> : null}

      {channels.nextCursor ? (
        <Link href={`/admin/channels?${new URLSearchParams({ ...(query ? { query } : {}), cursor: channels.nextCursor })}`} className="text-sm text-brand underline-offset-4 hover:underline">
          {strings.adminContent.nextPage}
        </Link>
      ) : null}
    </div>
  );
}
