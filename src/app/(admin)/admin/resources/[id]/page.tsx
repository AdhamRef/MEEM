import { FileX } from "lucide-react";
import { AdminPageHeader, StatusBadge } from "@/components/admin/content/list-frame";
import { StatusActions } from "@/components/admin/content/status-actions";
import { slugHref } from "@/components/knowledge/content-cards";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { checkPageAccess } from "@/lib/auth/guards";
import { AppError } from "@/lib/errors";
import { hasPermission } from "@/lib/permissions";
import { ResourceForm } from "@/components/admin/content/entity-forms";
import { getResourceForEditing } from "@/features/resources/resources.service";
import { deleteResourceAction, setResourceArchivedAction, setResourcePublishedAction, updateResourceAction } from "../actions";

export const metadata = { title: strings.admin.resources };

export default async function EditResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await checkPageAccess("admin.access", `/admin/resources/${id}`);
  if (!access.allowed) return null;
  const { actor } = access;

  const resource = await getResourceForEditing(actor, id).catch((error: unknown) => {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION")) return null;
    throw error;
  });
  if (!resource) return <StateMessage icon={FileX} title={strings.errors.notFound} />;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8" data-testid="resource-edit-page">
      <AdminPageHeader title={resource.title} backHref="/admin/resources">
        <StatusBadge status={resource.status} isArchived={resource.isArchived} />
      </AdminPageHeader>
      <StatusActions
        status={resource.status}
        isArchived={resource.isArchived}
        canPublish={hasPermission(actor, "content.publish")}
        canArchive={hasPermission(actor, "content.archive")}
        canDelete={hasPermission(actor, "content.delete")}
        onPublish={setResourcePublishedAction.bind(null, id)}
        onArchive={setResourceArchivedAction.bind(null, id)}
        onDelete={deleteResourceAction.bind(null, id)}
        listHref="/admin/resources"
        publicHref={slugHref("resources", resource.slug)}
      />
      <ResourceForm
        id={id}
        isPublished={resource.status === "PUBLISHED"}
        canEdit={hasPermission(actor, "relationships.manage")}
        onSave={updateResourceAction.bind(null, id)}
        initial={{ title: resource.title, slug: resource.slug, sourceName: resource.sourceName, url: resource.url, description: resource.description, coverImage: resource.coverImage }}
      />
    </div>
  );
}
