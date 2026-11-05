import { Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { strings } from "@/config/strings.ar";
import { formatDate } from "@/lib/utils/format";

export const selectClass =
  "h-11 w-full rounded-lg border border-input bg-input/30 px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm [&>option]:bg-surface-elevated";

export function StatusBadge({ status, isArchived }: { status: "DRAFT" | "PUBLISHED"; isArchived: boolean }) {
  if (isArchived) return <Badge variant="outline">{strings.adminContent.archived}</Badge>;
  return status === "PUBLISHED" ? <Badge data-status="published">{strings.adminContent.published}</Badge> : <Badge variant="secondary" data-status="draft">{strings.adminContent.draft}</Badge>;
}

export interface ListRow {
  id: string;
  title: string;
  hint?: string;
  status: "DRAFT" | "PUBLISHED";
  isArchived: boolean;
  updatedAt: Date;
}

interface ListFrameProps {
  title: string;
  basePath: string;
  rows: ListRow[];
  nextCursor: string | null;
  query?: string;
  status?: string;
  canCreate: boolean;
}

/** The same list screen for each content type: a plain GET form, so it needs no client code. */
export function ListFrame({ title, basePath, rows, nextCursor, query, status, canCreate }: ListFrameProps) {
  const isFiltered = Boolean(query || status);
  const nextParams = new URLSearchParams();
  if (query) nextParams.set("query", query);
  if (status) nextParams.set("status", status);
  if (nextCursor) nextParams.set("cursor", nextCursor);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {canCreate ? (
          <Button asChild>
            <Link href={`${basePath}/new`} data-testid="admin-create">
              <Plus aria-hidden data-icon="inline-start" />
              {strings.adminContent.create}
            </Link>
          </Button>
        ) : null}
      </header>

      <form method="get" className="flex flex-col gap-2 sm:flex-row" role="search">
        <Input name="query" type="search" defaultValue={query} placeholder={strings.adminContent.search} aria-label={strings.adminContent.search} className="sm:flex-1" />
        <select name="status" defaultValue={status ?? ""} aria-label={strings.adminContent.statusFilter} className={`${selectClass} sm:w-44`}>
          <option value="">{strings.adminContent.allStatuses}</option>
          <option value="DRAFT">{strings.adminContent.draft}</option>
          <option value="PUBLISHED">{strings.adminContent.published}</option>
          <option value="ARCHIVED">{strings.adminContent.archived}</option>
        </select>
        <Button type="submit" variant="secondary">
          {strings.adminContent.searchAction}
        </Button>
      </form>

      {rows.length ? (
        <ul className="divide-y rounded-xl border bg-surface" data-testid="admin-list">
          {rows.map((row) => (
            <li key={row.id}>
              <Link href={`${basePath}/${row.id}`} className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 outline-none hover:bg-surface-elevated focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset">
                <span className="min-w-0 flex-1">
                  <bdi className="block truncate font-medium">{row.title}</bdi>
                  {row.hint ? <bdi className="block truncate text-xs text-text-secondary">{row.hint}</bdi> : null}
                </span>
                <span className="flex items-center gap-3 text-xs text-text-secondary">
                  <StatusBadge status={row.status} isArchived={row.isArchived} />
                  <time dateTime={row.updatedAt.toISOString()}>{formatDate(row.updatedAt)}</time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border bg-surface p-8 text-center text-text-secondary" data-testid="admin-list-empty">
          {isFiltered ? strings.adminContent.noResults : strings.adminContent.empty}
        </p>
      )}

      {nextCursor ? (
        <div className="text-center">
          <Button asChild variant="secondary">
            <Link href={`${basePath}?${nextParams.toString()}`}>{strings.adminContent.nextPage}</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function AdminPageHeader({ title, backHref, children }: { title: string; backHref: string; children?: ReactNode }) {
  return (
    <header className="space-y-2">
      <Link href={backHref} className="text-sm text-text-secondary underline-offset-4 hover:underline">
        {strings.adminContent.backToList}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 dir="auto" className="text-2xl font-semibold">
          {title}
        </h1>
        {children}
      </div>
    </header>
  );
}
