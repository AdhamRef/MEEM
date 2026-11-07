import { Plus } from "lucide-react";
import Link from "next/link";
import { selectClass } from "@/components/admin/content/list-frame";
import { BulkList } from "@/components/admin/videos/bulk-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { strings } from "@/config/strings.ar";
import { listArticlesForAdmin } from "@/features/articles/articles.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";
import { bulkAssignArticlesAction, listMatchingArticleIdsAction } from "../shorts/actions";

export const metadata = { title: strings.admin.articles };

interface PageProps {
  searchParams: Promise<{ query?: string; status?: string; cursor?: string }>;
}

export default async function AdminArticlesPage({ searchParams }: PageProps) {
  const access = await checkPageAccess("admin.access", "/admin/articles");
  if (!access.allowed) return null;
  const { actor } = access;

  const { query, status, cursor } = await searchParams;
  const validStatus = status === "DRAFT" || status === "PUBLISHED" || status === "ARCHIVED" ? status : undefined;
  const page = await listArticlesForAdmin(actor, { query: query || undefined, status: validStatus, cursor });

  const c = strings.adminContent;
  const nextParams = new URLSearchParams();
  if (query) nextParams.set("query", query);
  if (validStatus) nextParams.set("status", validStatus);
  if (page.nextCursor) nextParams.set("cursor", page.nextCursor);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{strings.admin.articles}</h1>
        {hasPermission(actor, "content.create") ? (
          <Button asChild>
            <Link href="/admin/articles/new" data-testid="admin-create">
              <Plus aria-hidden data-icon="inline-start" />
              {c.create}
            </Link>
          </Button>
        ) : null}
      </header>

      <form method="get" className="flex flex-col gap-2 sm:flex-row" role="search">
        <Input name="query" type="search" defaultValue={query} placeholder={c.search} aria-label={c.search} className="sm:flex-1" />
        <select name="status" defaultValue={validStatus ?? ""} aria-label={c.statusFilter} className={`${selectClass} sm:w-44`}>
          <option value="">{c.allStatuses}</option>
          <option value="DRAFT">{c.draft}</option>
          <option value="PUBLISHED">{c.published}</option>
          <option value="ARCHIVED">{c.archived}</option>
        </select>
        <Button type="submit" variant="secondary">
          {c.searchAction}
        </Button>
      </form>

      <BulkList
        key={JSON.stringify({ query, validStatus })}
        total={page.total}
        onListIds={listMatchingArticleIdsAction.bind(null, { ...(query ? { query } : {}), ...(validStatus ? { status: validStatus } : {}) })}
        canEdit={hasPermission(actor, "content.editAny")}
        onAssign={bulkAssignArticlesAction}
        emptyMessage={query || validStatus ? c.noResults : c.empty}
        rows={page.items.map((row) => ({ id: row.id, href: `/admin/articles/${row.id}`, title: row.title, status: row.status, isArchived: row.isArchived }))}
      />

      {page.nextCursor ? (
        <div className="text-center">
          <Button asChild variant="secondary">
            <Link href={`/admin/articles?${nextParams}`}>{c.nextPage}</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
