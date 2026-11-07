import { ShieldX } from "lucide-react";
import { YouTubeRefreshPanel } from "@/components/admin/youtube-refresh-panel";
import { StateMessage } from "@/components/shared/state-message";
import { Badge } from "@/components/ui/badge";
import { strings } from "@/config/strings.ar";
import { getIntegrationStatus } from "@/features/admin/system.service";
import { getYouTubeStatus } from "@/features/youtube/metadata-refresh.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";
import { formatDate } from "@/lib/utils/format";

const s = strings.system;

export const metadata = { title: strings.admin.youtubeStatus };

function Metric({ label, value, testId, isWarning }: { label: string; value: string | number; testId?: string; isWarning?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold tabular-nums ${isWarning ? "text-destructive" : ""}`} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/** Everything here comes from stored data, so opening this page spends no quota. */
export default async function YouTubeStatusPage() {
  const access = await checkPageAccess("admin.access", "/admin/youtube-status");
  if (!access.allowed) return null;
  if (!hasPermission(access.actor, "youtube.import")) return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;

  const [status, panel] = await Promise.all([getIntegrationStatus(access.actor), getYouTubeStatus(access.actor)]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8" data-testid="youtube-status-page">
      <h1 className="text-2xl font-semibold">{strings.admin.youtubeStatus}</h1>

      <section className="space-y-3 rounded-xl border bg-surface p-4">
        <h2 className="font-semibold">{s.configuration}</h2>
        <ul className="space-y-2 text-sm">
          <li className="flex flex-wrap items-center justify-between gap-2">
            {s.apiKey}
            <Badge variant={status.isConfigured ? "secondary" : "destructive"} data-testid="status-api">
              {status.isConfigured ? s.configured : s.notConfigured}
            </Badge>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2">
            {s.dailyJob}
            <Badge variant={status.cronConfigured ? "secondary" : "destructive"} data-testid="status-cron">
              {status.cronConfigured ? s.secretSet : s.notConfigured}
            </Badge>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2">
            {s.statistics}
            <Badge variant="outline" data-testid="status-statistics">
              {status.statisticsEnabled ? s.on : s.off}
            </Badge>
          </li>
        </ul>
        {status.cronConfigured ? <p className="text-xs text-text-secondary">{s.cronNote}</p> : null}
      </section>

      <section className="space-y-3 rounded-xl border bg-surface p-4">
        <h2 className="font-semibold">{s.quotaTitle}</h2>
        <dl className="grid grid-cols-2 gap-2">
          <Metric label={s.quotaToday} value={`${status.quota.unitsToday} / ${status.quota.dailyLimit}`} testId="status-quota" />
          <Metric label={s.quotaState} value={status.quota.exhausted ? s.quotaExhausted : s.quotaAvailable} isWarning={status.quota.exhausted} />
        </dl>
        <p className="text-xs text-text-secondary">{s.quotaNote}</p>
        {status.quota.recentDays.length ? (
          <ul className="space-y-1 text-sm" data-testid="status-quota-days">
            {status.quota.recentDays.map((day) => (
              <li key={day.day} className="flex justify-between gap-2 text-text-secondary">
                <bdi dir="ltr">{day.day}</bdi>
                <span className="tabular-nums">
                  {day.units}
                  {day.exhausted ? ` · ${s.quotaExhausted}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border bg-surface p-4">
        <h2 className="font-semibold">{s.refreshTitle}</h2>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Metric label={s.videosDue} value={status.refresh.videosDue} testId="status-videos-due" />
          <Metric label={s.videosPastLimit} value={status.refresh.videosPastLimit} isWarning={status.refresh.videosPastLimit > 0} testId="status-past-limit" />
          <Metric label={s.playlistsDue} value={status.refresh.playlistsDue} />
          <Metric label={s.channelsDue} value={status.refresh.channelsDue} />
          <Metric label={s.lastManualRefresh} value={status.refresh.lastRun ? formatDate(status.refresh.lastRun) : s.never} />
          <Metric label={strings.sources.overviewFollowed} value={status.sources.followedChannels} />
          <Metric label={strings.sources.overviewFetching} value={status.sources.fetchingChannels} />
        </dl>
        <p className="text-xs text-text-secondary">{s.refreshAfterNote(status.refresh.afterDays)}</p>
      </section>

      <YouTubeRefreshPanel status={panel} />
    </div>
  );
}
