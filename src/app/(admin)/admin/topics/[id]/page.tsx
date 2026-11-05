import { FileX } from "lucide-react";
import { AdminPageHeader, StatusBadge } from "@/components/admin/content/list-frame";
import { StatusActions } from "@/components/admin/content/status-actions";
import { slugHref } from "@/components/knowledge/content-cards";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { checkPageAccess } from "@/lib/auth/guards";
import { AppError } from "@/lib/errors";
import { hasPermission } from "@/lib/permissions";
import { TopicForm } from "@/components/admin/content/entity-forms";
import { LinksManager } from "@/components/admin/content/links-manager";
import { listActiveCategories } from "@/features/categories/categories.service";
import { canManageLink, linkTargetType, type LinkKind } from "@/features/relationships/links.service";
import { getTopicForEditing } from "@/features/topics/topics.service";
import { deleteTopicAction, setTopicArchivedAction, setTopicPublishedAction, updateTopicAction } from "../actions";

export const metadata = { title: strings.admin.topics };

const LINK_KINDS: LinkKind[] = ["topic.article", "topic.video", "topic.playlist", "topic.library", "topic.resource", "topic.related", "topic.complementary"];

export default async function EditTopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await checkPageAccess("admin.access", `/admin/topics/${id}`);
  if (!access.allowed) return null;
  const { actor } = access;

  const topic = await getTopicForEditing(actor, id).catch((error: unknown) => {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION")) return null;
    throw error;
  });
  if (!topic) return <StateMessage icon={FileX} title={strings.errors.notFound} />;

  const categories = await listActiveCategories();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8" data-testid="topic-edit-page">
      <AdminPageHeader title={topic.title} backHref="/admin/topics">
        <StatusBadge status={topic.status} isArchived={topic.isArchived} />
      </AdminPageHeader>
      <StatusActions
        status={topic.status}
        isArchived={topic.isArchived}
        canPublish={hasPermission(actor, "content.publish")}
        canArchive={hasPermission(actor, "content.archive")}
        canDelete={hasPermission(actor, "content.delete")}
        onPublish={setTopicPublishedAction.bind(null, id)}
        onArchive={setTopicArchivedAction.bind(null, id)}
        onDelete={deleteTopicAction.bind(null, id)}
        listHref="/admin/topics"
        publicHref={slugHref("topics", topic.slug)}
      />
      <TopicForm
        id={id}
        isPublished={topic.status === "PUBLISHED"}
        canEdit={hasPermission(actor, "topics.manage")}
        categories={categories.map((category) => ({ id: category.id, title: category.title }))}
        onSave={updateTopicAction.bind(null, id)}
        initial={{
          title: topic.title,
          slug: topic.slug,
          introduction: topic.introduction,
          description: topic.description,
          coverImage: topic.coverImage,
          categoryId: topic.categoryId,
          isFeatured: topic.isFeatured,
          displayOrder: topic.displayOrder,
          parent: topic.parent ? { id: topic.parent.id, type: "TOPIC", label: topic.parent.title } : null,
        }}
      />
      <LinksManager ownerId={id} sections={LINK_KINDS.map((kind) => ({ kind, targetType: linkTargetType(kind), canManage: canManageLink(actor, kind) }))} />
    </div>
  );
}
