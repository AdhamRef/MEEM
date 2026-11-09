import { ArrowRight, Info, LayoutGrid, Library, ListVideo, MousePointerClick, Rows3, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { StructureTree } from "@/components/admin/structure/structure-tree";
import { strings } from "@/config/strings.ar";
import { getStructure, STRUCTURE_KINDS, type StructureKind } from "@/features/structure/structure.service";
import { objectIdSchema } from "@/features/topics/schemas";
import { checkPageAccess } from "@/lib/auth/guards";
import { cn } from "@/lib/utils";
import { createStructureNodeAction, moveStructureNodeAction } from "./actions";
import { CollectionPanel, LibraryPanel, NewPanel, TopicPanel } from "./panels";

const s = strings.structure;

export const metadata = { title: s.title };

const TAB_ICONS: Record<StructureKind, LucideIcon> = { topics: LayoutGrid, libraries: Library, collections: Rows3, playlists: ListVideo };

interface PageProps {
  searchParams: Promise<{ tab?: string; id?: string; new?: string }>;
}

function parseTab(raw: string | undefined): StructureKind {
  return STRUCTURE_KINDS.find((kind) => kind === raw) ?? "topics";
}

export default async function StructurePage({ searchParams }: PageProps) {
  const access = await checkPageAccess("admin.access", "/admin/structure");
  if (!access.allowed) return null;
  const { actor } = access;

  const params = await searchParams;
  const tab = parseTab(params.tab);
  const id = objectIdSchema.safeParse(params.id).success ? params.id! : null;
  const isNew = params.new === "1" && tab !== "playlists";
  const hasPanel = Boolean(id || isNew) && tab !== "playlists";
  const data = await getStructure(actor, tab);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 md:px-6" data-testid="structure-page">
      <header className="space-y-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{s.title}</h1>
          <p className="max-w-3xl text-sm text-text-secondary">{s.subtitle}</p>
        </div>
        <details className="group rounded-2xl border bg-surface/60 open:bg-surface" data-testid="structure-how">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            <Info aria-hidden className="size-4 text-brand" />
            {s.howTitle}
          </summary>
          <dl className="grid gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-5">
            {s.how.map((entry) => (
              <div key={entry.term} className="rounded-xl border bg-background/40 p-3">
                <dt className="text-sm font-semibold text-text-primary">{entry.term}</dt>
                <dd className="mt-1 text-xs leading-6 text-text-secondary">{entry.text}</dd>
              </div>
            ))}
          </dl>
        </details>
      </header>

      <nav aria-label={s.title} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="flex w-max gap-1 rounded-2xl border bg-surface p-1 md:w-auto">
          {STRUCTURE_KINDS.map((kind) => {
            const Icon = TAB_ICONS[kind];
            const isCurrent = kind === tab;
            return (
              <li key={kind}>
                <Link
                  href={`/admin/structure?tab=${kind}`}
                  aria-current={isCurrent ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                    isCurrent ? "bg-brand text-primary-foreground font-semibold shadow-lg shadow-brand/20" : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary",
                  )}
                  data-testid={`structure-tab-${kind}`}
                >
                  <Icon aria-hidden className="size-4" />
                  {s.tabs[kind]}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section aria-label={s.tabs[tab]} className={cn("rounded-2xl border bg-surface p-3 md:p-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto", hasPanel && "hidden lg:block")}>
          <p className="mb-3 rounded-xl bg-background/50 px-3 py-2 text-xs leading-6 text-text-secondary">{s.tabHints[tab]}</p>
          <StructureTree kind={tab} nodes={data.nodes} selectedId={id} canManage={data.canManage} isTruncated={data.isTruncated} onMove={moveStructureNodeAction} onCreate={createStructureNodeAction} />
        </section>

        <section aria-label={strings.adminContent.edit} className={cn("min-w-0 rounded-2xl border bg-surface p-4 md:p-6", !hasPanel && "hidden lg:block")} data-testid="structure-panel">
          {hasPanel ? (
            <Link href={`/admin/structure?tab=${tab}`} scroll={false} className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm text-text-secondary underline-offset-4 hover:underline lg:hidden">
              <ArrowRight aria-hidden className="size-4" />
              {s.backToTree}
            </Link>
          ) : null}
          {isNew && (tab === "topics" || tab === "libraries" || tab === "collections") ? (
            <NewPanel actor={actor} tab={tab} />
          ) : id && tab === "topics" ? (
            <TopicPanel actor={actor} id={id} />
          ) : id && tab === "libraries" ? (
            <LibraryPanel actor={actor} id={id} />
          ) : id && tab === "collections" ? (
            <CollectionPanel actor={actor} id={id} />
          ) : (
            <div className="flex min-h-80 flex-col items-center justify-center gap-3 text-center" data-testid="structure-panel-empty">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                <MousePointerClick aria-hidden className="size-6" />
              </span>
              <p className="font-semibold">{s.selectHintTitle}</p>
              <p className="max-w-sm text-sm text-text-secondary">{tab === "playlists" ? s.playlistOpens : s.selectHint}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
