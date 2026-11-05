import { ListFrame } from "@/components/admin/content/list-frame";
import { strings } from "@/config/strings.ar";
import { listCollectionsForAdmin } from "@/features/collections/collections.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";

export const metadata = { title: strings.collections.title };

interface PageProps {
  searchParams: Promise<{ query?: string; status?: string; cursor?: string }>;
}

export default async function AdminCollectionListPage({ searchParams }: PageProps) {
  const access = await checkPageAccess("admin.access", "/admin/collections");
  if (!access.allowed) return null;

  const { query, status, cursor } = await searchParams;
  const validStatus = status === "DRAFT" || status === "PUBLISHED" || status === "ARCHIVED" ? status : undefined;
  const page = await listCollectionsForAdmin(access.actor, { query: query || undefined, status: validStatus, cursor });

  return (
    <ListFrame
      title={strings.collections.title}
      basePath="/admin/collections"
      query={query}
      status={validStatus}
      nextCursor={page.nextCursor}
      canCreate={hasPermission(access.actor, "topics.manage")}
      rows={page.items.map((row) => ({ id: row.id, title: row.title, status: row.status, isArchived: row.isArchived, updatedAt: row.updatedAt }))}
    />
  );
}
