import Link from "next/link";
import { strings } from "@/config/strings.ar";
import { getDashboardOverview } from "@/features/admin/system.service";
import { checkPageAccess } from "@/lib/auth/guards";

const dateTime = new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

function Stat({ label, value, testId }: { label: string; value: number; testId?: string }) {
  return (
    <div className="rounded-xl border bg-surface p-4">
      <dt className="text-sm text-text-secondary">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

export default async function AdminOverviewPage() {
  const access = await checkPageAccess("admin.access", "/admin");
  if (!access.allowed) return null;

  const overview = await getDashboardOverview(access.actor);
  const a = strings.admin;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">{a.overview}</h1>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="overview-stats">
        <Stat label={a.totalShorts} value={overview.shorts.total} testId="stat-shorts" />
        <Stat label={a.publishedShorts} value={overview.shorts.published} testId="stat-shorts-published" />
        <Stat label={a.draftShorts} value={overview.shorts.draft} testId="stat-shorts-draft" />
        <Stat label={a.totalArticles} value={overview.articles.total} testId="stat-articles" />
        <Stat label={a.publishedArticles} value={overview.articles.published} testId="stat-articles-published" />
        <Stat label={a.draftArticles} value={overview.articles.draft} />
        <Stat label={a.topics} value={overview.topics} testId="stat-topics" />
        <Stat label={a.libraries} value={overview.libraries} testId="stat-libraries" />
        <Stat label={a.playlists} value={overview.playlists} testId="stat-playlists" />
        <Stat label={a.channels} value={overview.channels} testId="stat-channels" />
      </dl>

      {overview.recentActivity ? (
        <section aria-labelledby="recent-activity" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="recent-activity" className="font-semibold">
              {a.recentActivity}
            </h2>
            <Link href="/admin/audit-logs" className="text-sm text-brand underline-offset-4 hover:underline">
              {a.auditLogs}
            </Link>
          </div>
          {overview.recentActivity.length === 0 ? (
            <p className="rounded-xl border bg-surface p-6 text-center text-text-secondary">{strings.system.auditEmpty}</p>
          ) : (
            <ul className="divide-y rounded-xl border bg-surface text-sm" data-testid="recent-activity">
              {overview.recentActivity.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>
                    <code dir="ltr" className="font-medium">
                      {entry.action}
                    </code>{" "}
                    <bdi dir="ltr" className="text-xs text-text-secondary">
                      {entry.actorEmail}
                    </bdi>
                  </span>
                  <time dateTime={entry.createdAt.toISOString()} className="text-xs text-text-secondary">
                    {dateTime.format(entry.createdAt)} UTC
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
