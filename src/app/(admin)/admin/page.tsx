import { BookOpen, Clapperboard, LayoutGrid, Library, ListVideo, Network, Tv, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { strings } from "@/config/strings.ar";
import { getDashboardOverview } from "@/features/admin/system.service";
import { checkPageAccess } from "@/lib/auth/guards";

const dateTime = new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const number = new Intl.NumberFormat("ar");

interface Part {
  label: string;
  value: number;
  testId?: string;
}

/** One card per kind of content: the total, what's live, and what's waiting. Each opens its section. */
function SummaryCard({ title, icon: Icon, href, total, parts }: { title: string; icon: LucideIcon; href: string; total: Part; parts: Part[] }) {
  return (
    <Link href={href} className="group flex flex-col gap-4 rounded-2xl border bg-surface p-5 outline-none transition-colors hover:border-brand/40 hover:bg-surface-elevated focus-visible:ring-3 focus-visible:ring-ring/50">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand/10 text-brand transition-colors group-hover:bg-brand group-hover:text-primary-foreground">
          <Icon aria-hidden className="size-5" />
        </span>
        <span className="font-semibold">{title}</span>
      </div>
      <dl className="space-y-3">
        <div>
          <dt className="text-xs text-text-secondary">{total.label}</dt>
          <dd className="text-3xl font-semibold tabular-nums" data-testid={total.testId}>
            {number.format(total.value)}
          </dd>
        </div>
        {parts.length ? (
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-t pt-3">
            {parts.map((part) => (
              <div key={part.label} className="flex items-baseline gap-1.5 text-sm">
                <dt className="text-text-secondary">{part.label}</dt>
                <dd className="font-semibold tabular-nums" data-testid={part.testId}>
                  {number.format(part.value)}
                </dd>
              </div>
            ))}
          </div>
        ) : null}
      </dl>
    </Link>
  );
}

function SmallStat({ label, value, icon: Icon, href, testId }: { label: string; value: number; icon: LucideIcon; href: string; testId: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-2xl border bg-surface p-4 outline-none transition-colors hover:border-brand/40 hover:bg-surface-elevated focus-visible:ring-3 focus-visible:ring-ring/50">
      <Icon aria-hidden className="size-5 text-brand" />
      <dl className="min-w-0">
        <dt className="truncate text-xs text-text-secondary">{label}</dt>
        <dd className="text-xl font-semibold tabular-nums" data-testid={testId}>
          {number.format(value)}
        </dd>
      </dl>
    </Link>
  );
}

export default async function AdminOverviewPage() {
  const access = await checkPageAccess("admin.access", "/admin");
  if (!access.allowed) return null;

  const overview = await getDashboardOverview(access.actor);
  const a = strings.admin;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-6 md:px-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{a.overview}</h1>
        <p className="text-sm text-text-secondary">{strings.structure.subtitle}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2" data-testid="overview-stats">
        <SummaryCard
          title={a.shorts}
          icon={Clapperboard}
          href="/admin/shorts"
          total={{ label: a.totalShorts, value: overview.shorts.total, testId: "stat-shorts" }}
          parts={[
            { label: strings.adminContent.published, value: overview.shorts.published, testId: "stat-shorts-published" },
            { label: strings.adminContent.draft, value: overview.shorts.draft, testId: "stat-shorts-draft" },
          ]}
        />
        <SummaryCard
          title={a.articles}
          icon={BookOpen}
          href="/admin/articles"
          total={{ label: a.totalArticles, value: overview.articles.total, testId: "stat-articles" }}
          parts={[
            { label: strings.adminContent.published, value: overview.articles.published, testId: "stat-articles-published" },
            { label: strings.adminContent.draft, value: overview.articles.draft },
          ]}
        />
      </div>

      <section aria-labelledby="structure-stats" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="structure-stats" className="font-semibold">
            {strings.structure.title}
          </h2>
          <Link href="/admin/structure" className="inline-flex items-center gap-1.5 text-sm text-brand underline-offset-4 hover:underline">
            <Network aria-hidden className="size-4" />
            {strings.structure.navLabel}
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SmallStat label={a.topics} value={overview.topics} icon={LayoutGrid} href="/admin/structure?tab=topics" testId="stat-topics" />
          <SmallStat label={a.libraries} value={overview.libraries} icon={Library} href="/admin/structure?tab=libraries" testId="stat-libraries" />
          <SmallStat label={a.playlists} value={overview.playlists} icon={ListVideo} href="/admin/structure?tab=playlists" testId="stat-playlists" />
          <SmallStat label={a.channels} value={overview.channels} icon={Tv} href="/admin/sources" testId="stat-channels" />
        </div>
      </section>

      {overview.recentActivity ? (
        <section aria-labelledby="recent-activity" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="recent-activity" className="font-semibold">
              {a.recentActivity}
            </h2>
            <Link href="/admin/audit-logs" className="text-sm text-brand underline-offset-4 hover:underline">
              {a.auditLogs}
            </Link>
          </div>
          {overview.recentActivity.length === 0 ? (
            <p className="rounded-2xl border bg-surface p-6 text-center text-text-secondary">{strings.system.auditEmpty}</p>
          ) : (
            <ul className="divide-y rounded-2xl border bg-surface text-sm" data-testid="recent-activity">
              {overview.recentActivity.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-brand" />
                    <code dir="ltr" className="font-medium">
                      {entry.action}
                    </code>
                    <bdi dir="ltr" className="truncate text-xs text-text-secondary">
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
