import { ListFrame } from "@/components/admin/content/list-frame";
import { strings } from "@/config/strings.ar";
import { listPlaylistsForAdmin } from "@/features/playlists/playlists.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";

export const metadata = { title: strings.admin.playlists };

interface PageProps {
  searchParams: Promise<{ query?: string; status?: string; cursor?: string }>;
}

export default async function AdminPlaylistsPage({ searchParams }: PageProps) {
  const access = await checkPageAccess("admin.access", "/admin/playlists");
  if (!access.allowed) return null;

  const { query, status, cursor } = await searchParams;
  const validStatus = status === "DRAFT" || status === "PUBLISHED" || status === "ARCHIVED" ? status : undefined;
  const page = await listPlaylistsForAdmin(access.actor, { query: query || undefined, status: validStatus, cursor });

  return (
    <ListFrame
      title={strings.admin.playlists}
      basePath="/admin/playlists"
      query={query}
      status={validStatus}
      nextCursor={page.nextCursor}
      canCreate={hasPermission(access.actor, "playlists.manage") || hasPermission(access.actor, "youtube.import")}
      rows={page.items.map((row) => ({
        id: row.id,
        // A withdrawn YouTube playlist has no title until its next successful sync.
        title: row.title || (row.youtubePlaylistId ?? ""),
        hint: `${row.type === "YOUTUBE" ? strings.playlists.typeYouTube : strings.playlists.typeCurated} · ${strings.playlists.itemCount(row.itemCount)}`,
        status: row.status,
        isArchived: row.isArchived,
        updatedAt: row.updatedAt,
      }))}
    />
  );
}
