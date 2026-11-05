import { FileX } from "lucide-react";
import { AdminPageHeader, StatusBadge } from "@/components/admin/content/list-frame";
import { StatusActions } from "@/components/admin/content/status-actions";
import { slugHref } from "@/components/knowledge/content-cards";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { checkPageAccess } from "@/lib/auth/guards";
import { AppError } from "@/lib/errors";
import { hasPermission } from "@/lib/permissions";
import { LibraryForm } from "@/components/admin/content/entity-forms";
import { LinksManager } from "@/components/admin/content/links-manager";
import { getLibraryForEditing } from "@/features/libraries/libraries.service";
import { canManageLink, linkTargetType, type LinkKind } from "@/features/relationships/links.service";
import { deleteLibraryAction, setLibraryArchivedAction, setLibraryPublishedAction, updateLibraryAction } from "../actions";

export const metadata = { title: strings.admin.libraries };

const LINK_KINDS: LinkKind[] = ["library.article", "library.video", "library.playlist", "library.topic", "library.resource", "library.related"];

export default async function EditLibraryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await checkPageAccess("admin.access", `/admin/libraries/${id}`);
  if (!access.allowed) return null;
  const { actor } = access;

  const library = await getLibraryForEditing(actor, id).catch((error: unknown) => {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION")) return null;
    throw error;
  });
  if (!library) return <StateMessage icon={FileX} title={strings.errors.notFound} />;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8" data-testid="library-edit-page">
      <AdminPageHeader title={library.name} backHref="/admin/libraries">
        <StatusBadge status={library.status} isArchived={library.isArchived} />
      </AdminPageHeader>
      <StatusActions
        status={library.status}
        isArchived={library.isArchived}
        canPublish={hasPermission(actor, "content.publish")}
        canArchive={hasPermission(actor, "content.archive")}
        canDelete={hasPermission(actor, "content.delete")}
        onPublish={setLibraryPublishedAction.bind(null, id)}
        onArchive={setLibraryArchivedAction.bind(null, id)}
        onDelete={deleteLibraryAction.bind(null, id)}
        listHref="/admin/libraries"
        publicHref={slugHref("libraries", library.slug)}
      />
      <LibraryForm
        id={id}
        isPublished={library.status === "PUBLISHED"}
        canEdit={hasPermission(actor, "libraries.manage")}
        onSave={updateLibraryAction.bind(null, id)}
        initial={{
          name: library.name,
          slug: library.slug,
          description: library.description,
          introduction: library.introduction,
          coverImage: library.coverImage,
          isFeatured: library.isFeatured,
          displayOrder: library.displayOrder,
          parent: library.parent ? { id: library.parent.id, type: "LIBRARY", label: library.parent.name } : null,
        }}
      />
      <LinksManager ownerId={id} sections={LINK_KINDS.map((kind) => ({ kind, targetType: linkTargetType(kind), canManage: canManageLink(actor, kind) }))} />
    </div>
  );
}
