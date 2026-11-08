import { ArrowRight, Inbox, ShieldX } from "lucide-react";
import Link from "next/link";
import { DraftForm } from "@/components/admin/sources/draft-form";
import { AddAllWaiting, DraftList } from "@/components/admin/sources/draft-list";
import { QuotaMeter } from "@/components/admin/sources/quota-meter";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { listSourceDrafts } from "@/features/youtube/sources/drafts.service";
import { getSourcesOverview } from "@/features/youtube/sources/sources.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const d = strings.sourceDrafts;

export const metadata = { title: d.title };
// Adding one runs the same bounded steps as the Sources page.
export const maxDuration = 60;

interface PageProps {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}

export default async function SourceDraftsPage({ searchParams }: PageProps) {
  const access = await checkPageAccess("admin.access", "/admin/sources/drafts");
  if (!access.allowed) return null;
  const { actor } = access;
  if (!hasPermission(actor, "youtube.import") || !hasPermission(actor, "content.publish")) {
    return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;
  }

  const params = await searchParams;
  const status = params.status === "WAITING" || params.status === "ADDED" || params.status === "FAILED" ? params.status : undefined;
  const [overview, drafts] = await Promise.all([getSourcesOverview(actor), listSourceDrafts(actor, { status, cursor: params.cursor })]);

  const unavailableReason = !overview.isConfigured ? strings.sources.apiNotConfigured : overview.quotaExhausted ? d.quotaOut : null;
  const canAdd = unavailableReason === null;
  const waitingIds = drafts.items.filter((draft) => draft.status === "WAITING").map((draft) => draft.id);
  const tabs = [
    [undefined, d.tabAll, drafts.counts.all],
    ["WAITING", d.tabWaiting, drafts.counts.waiting],
    ["ADDED", d.tabAdded, drafts.counts.added],
    ["FAILED", d.tabFailed, drafts.counts.failed],
  ] as const;
  const href = (next: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value) query.set(key, value);
    const text = query.toString();
    return text ? `/admin/sources/drafts?${text}` : "/admin/sources/drafts";
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8" data-testid="drafts-page">
      <Link href="/admin/sources" className="inline-flex min-h-11 items-center gap-1 text-sm text-text-secondary outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <ArrowRight aria-hidden className="size-4" />
        {strings.sources.backToSources}
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{d.title}</h1>
        <p className="max-w-3xl text-sm text-text-secondary">{d.description}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <DraftForm />
        <QuotaMeter used={overview.quotaUnitsToday} limit={overview.quotaDailyLimit} ceiling={overview.quotaCeiling} isExhausted={overview.quotaExhausted} resetsAt={overview.quotaResetsAt.toISOString()} />
      </div>

      <section className="space-y-4" aria-labelledby="drafts-list-title">
        <h2 id="drafts-list-title" className="sr-only">
          {d.title}
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label={d.tabsLabel} className="flex flex-wrap gap-2">
            {tabs.map(([value, label, count]) => (
              <Link
                key={label}
                href={href({ status: value })}
                aria-current={status === value ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  status === value ? "border-brand bg-surface-elevated font-medium" : "text-text-secondary hover:bg-surface-elevated",
                )}
                data-testid={`drafts-tab-${value ?? "ALL"}`}
              >
                {label}
                <span className="tabular-nums">{count}</span>
              </Link>
            ))}
          </nav>
          <AddAllWaiting ids={waitingIds} canAdd={canAdd} />
        </div>
        {unavailableReason ? <p className="text-sm text-text-secondary">{unavailableReason}</p> : null}

        {drafts.items.length === 0 ? (
          <StateMessage icon={Inbox} title={status ? d.emptyFiltered : d.empty} />
        ) : (
          <DraftList drafts={drafts.items.map((draft) => ({ ...draft, createdAt: draft.createdAt.toISOString() }))} canAdd={canAdd} unavailableReason={unavailableReason} />
        )}

        {drafts.nextCursor ? (
          <div className="text-center">
            <Button asChild variant="secondary">
              <Link href={href({ status, cursor: drafts.nextCursor })}>{strings.adminContent.nextPage}</Link>
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
