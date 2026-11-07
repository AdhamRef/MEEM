import { ShieldX } from "lucide-react";
import Link from "next/link";
import { selectClass } from "@/components/admin/content/list-frame";
import { BulkList } from "@/components/admin/videos/bulk-list";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { strings } from "@/config/strings.ar";
import { formatDuration } from "@/features/playlists/rules";
import { listVideosForAdmin } from "@/features/shorts/videos-admin.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";
import { bulkAssignVideosAction, bulkPublishVideosAction, listMatchingVideoIdsAction } from "./actions";

const v = strings.videosAdmin;

export const metadata = { title: strings.admin.shorts };

interface PageProps {
  searchParams: Promise<{ query?: string; kind?: string; status?: string; review?: string; cursor?: string }>;
}

const oneOf = <T extends string>(value: string | undefined, options: readonly T[]): T | undefined => (options as readonly string[]).includes(value ?? "") ? (value as T) : undefined;

export default async function AdminShortsPage({ searchParams }: PageProps) {
  const access = await checkPageAccess("admin.access", "/admin/shorts");
  if (!access.allowed) return null;
  const { actor } = access;
  if (!hasPermission(actor, "content.viewAny")) return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;

  const params = await searchParams;
  const kind = oneOf(params.kind, ["SHORT", "LONG_FORM"] as const);
  const status = oneOf(params.status, ["DRAFT", "PUBLISHED", "ARCHIVED"] as const);
  const review = oneOf(params.review, ["NEEDS_REVIEW", "REVIEWED"] as const);
  const page = await listVideosForAdmin(actor, { query: params.query || undefined, kind, status, review, cursor: params.cursor });

  const nextParams = new URLSearchParams();
  for (const [key, value] of Object.entries({ query: params.query, kind, status, review, cursor: page.nextCursor })) if (value) nextParams.set(key, value);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{strings.admin.shorts}</h1>
        {hasPermission(actor, "youtube.import") ? (
          <Button asChild>
            <Link href="/admin/youtube-importer">{strings.importer.title}</Link>
          </Button>
        ) : null}
      </header>

      <form method="get" role="search" className="grid gap-2 sm:grid-cols-[1fr_repeat(4,auto)_auto]">
        <Input name="query" type="search" defaultValue={params.query} placeholder={strings.adminContent.search} aria-label={strings.adminContent.search} />
        <select name="kind" defaultValue={kind ?? ""} aria-label={v.kind} className={selectClass}>
          <option value="">{v.allKinds}</option>
          <option value="SHORT">{strings.content.short}</option>
          <option value="LONG_FORM">{strings.content.longVideo}</option>
        </select>
        <select name="status" defaultValue={status ?? ""} aria-label={strings.adminContent.statusFilter} className={selectClass}>
          <option value="">{strings.adminContent.allStatuses}</option>
          <option value="DRAFT">{strings.adminContent.draft}</option>
          <option value="PUBLISHED">{strings.adminContent.published}</option>
          <option value="ARCHIVED">{strings.adminContent.archived}</option>
        </select>
        <select name="review" defaultValue={review ?? ""} aria-label={v.reviewFilter} className={selectClass}>
          <option value="">{v.anyReview}</option>
          <option value="NEEDS_REVIEW">{v.needsReview}</option>
          <option value="REVIEWED">{v.reviewed}</option>
        </select>
        <Button type="submit" variant="secondary">
          {strings.adminContent.searchAction}
        </Button>
      </form>

      <BulkList
        key={JSON.stringify({ query: params.query, kind, status, review })}
        total={page.total}
        onListIds={listMatchingVideoIdsAction.bind(null, { ...(params.query ? { query: params.query } : {}), ...(kind ? { kind } : {}), ...(status ? { status } : {}), ...(review ? { review } : {}) })}
        showKind
        canEdit={hasPermission(actor, "content.editAny")}
        canPublish={hasPermission(actor, "content.publish")}
        onAssign={bulkAssignVideosAction}
        onPublish={bulkPublishVideosAction}
        emptyMessage={params.query || kind || status || review ? strings.adminContent.noResults : v.empty}
        rows={page.items.map((row) => {
          const duration = formatDuration(row.durationSeconds);
          return {
            id: row.id,
            href: `/admin/shorts/${row.id}`,
            title: row.title || v.withdrawn,
            hint: [row.kind === "SHORT" ? strings.content.short : strings.content.longVideo, row.channelTitle, strings.feed.source, duration].filter(Boolean).join(" · "),
            thumbnailUrl: row.thumbnailUrl,
            status: row.status,
            isArchived: row.isArchived,
            badges: [
              ...(row.reviewedAt ? [] : [{ label: v.needsReview }]),
              ...(row.availability === "AVAILABLE" ? [] : [{ label: v.availability[row.availability], isWarning: true }]),
            ],
          };
        })}
      />

      {page.nextCursor ? (
        <div className="text-center">
          <Button asChild variant="secondary">
            <Link href={`/admin/shorts?${nextParams}`}>{strings.adminContent.nextPage}</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
