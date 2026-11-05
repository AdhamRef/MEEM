import { FileX } from "lucide-react";
import { LinksManager } from "@/components/admin/content/links-manager";
import { AdminPageHeader, StatusBadge } from "@/components/admin/content/list-frame";
import { StatusActions } from "@/components/admin/content/status-actions";
import { CuratedPlaylistForm, YouTubePlaylistForm } from "@/components/admin/playlists/playlist-forms";
import { PlaylistItemsManager } from "@/components/admin/playlists/playlist-items-manager";
import { slugHref } from "@/components/knowledge/content-cards";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { getPlaylistForEditing } from "@/features/playlists/playlists.service";
import { canManageLink, linkTargetType, type LinkKind } from "@/features/relationships/links.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { AppError } from "@/lib/errors";
import { hasPermission } from "@/lib/permissions";
import {
  addPlaylistItemAction,
  deletePlaylistAction,
  removePlaylistItemAction,
  reorderPlaylistItemsAction,
  setPlaylistArchivedAction,
  setPlaylistItemNoteAction,
  setPlaylistPublishedAction,
  syncPlaylistAction,
  updatePlaylistAction,
} from "../actions";

export const metadata = { title: strings.admin.playlists };

const LINK_KINDS: LinkKind[] = ["playlist.topic", "playlist.library", "playlist.article"];

export default async function EditPlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await checkPageAccess("admin.access", `/admin/playlists/${id}`);
  if (!access.allowed) return null;
  const { actor } = access;

  const playlist = await getPlaylistForEditing(actor, id).catch((error: unknown) => {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION")) return null;
    throw error;
  });
  if (!playlist) return <StateMessage icon={FileX} title={strings.errors.notFound} />;

  const canEdit = hasPermission(actor, "playlists.manage");
  const isPublished = playlist.status === "PUBLISHED";
  const isCurated = playlist.type === "CURATED";

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8" data-testid="playlist-edit-page">
      <AdminPageHeader title={playlist.title || (playlist.youtubePlaylistId ?? "")} backHref="/admin/playlists">
        <StatusBadge status={playlist.status} isArchived={playlist.isArchived} />
      </AdminPageHeader>

      <StatusActions
        status={playlist.status}
        isArchived={playlist.isArchived}
        canPublish={hasPermission(actor, "content.publish")}
        canArchive={hasPermission(actor, "content.archive")}
        canDelete={hasPermission(actor, "content.delete")}
        onPublish={setPlaylistPublishedAction.bind(null, id)}
        onArchive={setPlaylistArchivedAction.bind(null, id)}
        onDelete={deletePlaylistAction.bind(null, id)}
        listHref="/admin/playlists"
        publicHref={slugHref("playlists", playlist.slug)}
      />

      {isCurated ? (
        <CuratedPlaylistForm
          id={id}
          isPublished={isPublished}
          canEdit={canEdit}
          onSave={updatePlaylistAction.bind(null, id)}
          initial={{ title: playlist.title, slug: playlist.slug, description: playlist.description, introduction: playlist.introduction, coverImage: playlist.coverImage, isFeatured: playlist.isFeatured, displayOrder: playlist.displayOrder }}
        />
      ) : (
        <YouTubePlaylistForm
          isPublished={isPublished}
          canEdit={canEdit}
          canSync={hasPermission(actor, "youtube.import")}
          syncStatus={playlist.syncStatus}
          metadataFetchedAt={playlist.metadataFetchedAt?.toISOString() ?? null}
          onSave={updatePlaylistAction.bind(null, id)}
          onSync={syncPlaylistAction.bind(null, id)}
          initial={{
            title: playlist.title,
            slug: playlist.slug,
            description: playlist.description,
            channelTitle: playlist.channelTitle,
            youtubePlaylistId: playlist.youtubePlaylistId ?? "",
            introduction: playlist.introduction,
            isFeatured: playlist.isFeatured,
            displayOrder: playlist.displayOrder,
          }}
        />
      )}

      <PlaylistItemsManager
        items={playlist.items}
        canEdit={canEdit && isCurated}
        onAdd={addPlaylistItemAction.bind(null, id)}
        onRemove={removePlaylistItemAction.bind(null, id)}
        onReorder={reorderPlaylistItemsAction.bind(null, id)}
        onNote={setPlaylistItemNoteAction.bind(null, id)}
      />

      <LinksManager ownerId={id} sections={LINK_KINDS.map((kind) => ({ kind, targetType: linkTargetType(kind), canManage: canManageLink(actor, kind) }))} />
    </div>
  );
}
