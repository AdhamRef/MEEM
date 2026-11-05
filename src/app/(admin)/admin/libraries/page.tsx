import { ListFrame } from "@/components/admin/content/list-frame";
import { strings } from "@/config/strings.ar";
import { listLibrariesForAdmin } from "@/features/libraries/libraries.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";

export const metadata = { title: strings.admin.libraries };

interface PageProps {
  searchParams: Promise<{ query?: string; status?: string; cursor?: string }>;
}

export default async function AdminLibraryListPage({ searchParams }: PageProps) {
  const access = await checkPageAccess("admin.access", "/admin/libraries");
  if (!access.allowed) return null;

  const { query, status, cursor } = await searchParams;
  const validStatus = status === "DRAFT" || status === "PUBLISHED" || status === "ARCHIVED" ? status : undefined;
  const page = await listLibrariesForAdmin(access.actor, { query: query || undefined, status: validStatus, cursor });

  return (
    <ListFrame
      title={strings.admin.libraries}
      basePath="/admin/libraries"
      query={query}
      status={validStatus}
      nextCursor={page.nextCursor}
      canCreate={hasPermission(access.actor, "libraries.manage")}
      rows={page.items.map((row) => ({ id: row.id, title: row.name, status: row.status, isArchived: row.isArchived, updatedAt: row.updatedAt }))}
    />
  );
}
