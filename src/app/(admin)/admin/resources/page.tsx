import { ListFrame } from "@/components/admin/content/list-frame";
import { strings } from "@/config/strings.ar";
import { listResourcesForAdmin } from "@/features/resources/resources.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";

export const metadata = { title: strings.admin.resources };

interface PageProps {
  searchParams: Promise<{ query?: string; status?: string; cursor?: string }>;
}

export default async function AdminResourceListPage({ searchParams }: PageProps) {
  const access = await checkPageAccess("admin.access", "/admin/resources");
  if (!access.allowed) return null;

  const { query, status, cursor } = await searchParams;
  const validStatus = status === "DRAFT" || status === "PUBLISHED" || status === "ARCHIVED" ? status : undefined;
  const page = await listResourcesForAdmin(access.actor, { query: query || undefined, status: validStatus, cursor });

  return (
    <ListFrame
      title={strings.admin.resources}
      basePath="/admin/resources"
      query={query}
      status={validStatus}
      nextCursor={page.nextCursor}
      canCreate={hasPermission(access.actor, "relationships.manage")}
      rows={page.items.map((row) => ({ id: row.id, title: row.title, status: row.status, isArchived: row.isArchived, updatedAt: row.updatedAt }))}
    />
  );
}
