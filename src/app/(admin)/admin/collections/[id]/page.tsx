import { FileX } from "lucide-react";
import { CollectionForm, CollectionItemsManager } from "@/components/admin/collections/collection-forms";
import { AdminPageHeader, StatusBadge } from "@/components/admin/content/list-frame";
import { StatusActions } from "@/components/admin/content/status-actions";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { getCollectionForEditing, MAX_COLLECTION_ITEMS } from "@/features/collections/collections.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { AppError } from "@/lib/errors";
import { hasPermission } from "@/lib/permissions";
import { deleteCollectionAction, setCollectionArchivedAction, setCollectionPublishedAction, updateCollectionAction } from "../actions";

export const metadata = { title: strings.collections.title };

export default async function EditCollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await checkPageAccess("admin.access", `/admin/collections/${id}`);
  if (!access.allowed) return null;
  const { actor } = access;

  const collection = await getCollectionForEditing(actor, id).catch((error: unknown) => {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION")) return null;
    throw error;
  });
  if (!collection) return <StateMessage icon={FileX} title={strings.errors.notFound} />;
  const canEdit = hasPermission(actor, "topics.manage");

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8" data-testid="collection-edit-page">
      <AdminPageHeader title={collection.title} backHref="/admin/collections">
        <StatusBadge status={collection.status} isArchived={collection.isArchived} />
      </AdminPageHeader>
      <p className="text-sm text-text-secondary">{strings.collections.intro}</p>
      <StatusActions
        status={collection.status}
        isArchived={collection.isArchived}
        canPublish={hasPermission(actor, "content.publish")}
        canArchive={hasPermission(actor, "content.archive")}
        canDelete={hasPermission(actor, "content.delete")}
        onPublish={setCollectionPublishedAction.bind(null, id)}
        onArchive={setCollectionArchivedAction.bind(null, id)}
        onDelete={deleteCollectionAction.bind(null, id)}
        listHref="/admin/collections"
        publicHref="/explore"
      />
      <CollectionForm id={id} canEdit={canEdit} onSave={updateCollectionAction.bind(null, id)} initial={{ title: collection.title, description: collection.description, displayOrder: collection.displayOrder }} />
      <CollectionItemsManager collectionId={id} items={collection.items} canEdit={canEdit} max={MAX_COLLECTION_ITEMS} />
    </div>
  );
}
