import { Bookmark, Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LibraryGuestState, LibraryRow, LibraryTabs } from "@/components/library/library-parts";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { listSavedContent, SAVED_FILTERS, type SavedFilter } from "@/features/users/library.service";
import { getCurrentActor } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

const l = strings.library;

export const metadata: Metadata = { title: l.savedTitle, robots: { index: false, follow: false } };

interface PageProps {
  searchParams: Promise<{ type?: string; cursor?: string }>;
}

export default async function SavedPage({ searchParams }: PageProps) {
  const actor = await getCurrentActor();
  if (!actor) return <LibraryGuestState path="/saved" />;

  const { type, cursor } = await searchParams;
  const filter = SAVED_FILTERS.find((candidate) => candidate === type);
  const page = await listSavedContent(actor, { type: filter, cursor });

  const href = (next: { type?: SavedFilter; cursor?: string }) => {
    const query = new URLSearchParams();
    if (next.type) query.set("type", next.type);
    if (next.cursor) query.set("cursor", next.cursor);
    const text = query.toString();
    return text ? `/saved?${text}` : "/saved";
  };
  const chip = "inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8" data-testid="saved-page">
      <h1 className="text-3xl font-semibold">{l.savedTitle}</h1>
      <LibraryTabs active="saved" />

      <nav aria-label={l.filtersLabel}>
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" data-testid="saved-filters">
          <li>
            <Link href="/saved" aria-current={filter ? undefined : "page"} className={cn(chip, filter ? "bg-surface hover:bg-surface-elevated" : "border-brand bg-surface-elevated")}>
              {l.all}
            </Link>
          </li>
          {SAVED_FILTERS.map((candidate) => (
            <li key={candidate}>
              <Link href={href({ type: candidate })} aria-current={filter === candidate ? "page" : undefined} className={cn(chip, filter === candidate ? "border-brand bg-surface-elevated" : "bg-surface hover:bg-surface-elevated")}>
                {l.filters[candidate]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {page.items.length ? (
        <ul className="divide-y rounded-xl border bg-surface" data-testid="saved-list">
          {page.items.map((entry) => (
            <LibraryRow key={entry.id} entry={entry} list="saved" />
          ))}
        </ul>
      ) : (
        <StateMessage
          icon={Bookmark}
          title={l.savedEmptyTitle}
          description={filter ? l.savedEmptyFiltered : l.savedEmptyDescription}
          action={
            <Button asChild variant="secondary">
              <Link href="/explore">
                <Compass aria-hidden data-icon="inline-start" />
                {l.browse}
              </Link>
            </Button>
          }
        />
      )}

      {page.nextCursor ? (
        <div className="text-center">
          <Button asChild variant="secondary">
            <Link href={href({ type: filter, cursor: page.nextCursor })} data-testid="saved-more">
              {strings.content.showMore}
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
