import { ShieldX } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/content/list-frame";
import { CuratedPlaylistForm, ImportPlaylistForm } from "@/components/admin/playlists/playlist-forms";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";
import { isYouTubeApiConfigured } from "@/lib/youtube/client";
import { createCuratedPlaylistAction, importYouTubePlaylistAction } from "../actions";

export const metadata = { title: strings.admin.playlists };

export default async function NewPlaylistPage() {
  const access = await checkPageAccess("admin.access", "/admin/playlists/new");
  if (!access.allowed) return null;

  const canManage = hasPermission(access.actor, "playlists.manage");
  const canImport = hasPermission(access.actor, "youtube.import");
  if (!canManage && !canImport) return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8">
      <AdminPageHeader title={strings.playlists.newPlaylist} backHref="/admin/playlists" />
      <ImportPlaylistForm isConfigured={isYouTubeApiConfigured()} canImport={canImport} onImport={importYouTubePlaylistAction} />
      {canManage ? (
        <section className="space-y-2">
          <h2 className="font-semibold">{strings.playlists.curatedTitle}</h2>
          <p className="text-sm text-text-secondary">{strings.playlists.curatedDescription}</p>
          <CuratedPlaylistForm isPublished={false} canEdit onSave={createCuratedPlaylistAction} initial={{ title: "", slug: "", description: null, introduction: null, coverImage: null, isFeatured: false, displayOrder: 0 }} />
        </section>
      ) : null}
    </div>
  );
}
