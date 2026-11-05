import { FileX, ShieldX } from "lucide-react";
import { ArticleFeaturedToggle } from "@/components/admin/content/featured-toggle";
import { AdminPageHeader, StatusBadge } from "@/components/admin/content/list-frame";
import { StatusActions } from "@/components/admin/content/status-actions";
import { ArticleWorkspace } from "@/components/articles/editor/article-workspace";
import { ReviewNotes } from "@/components/articles/editor/review-notes";
import { StateMessage } from "@/components/shared/state-message";
import { slugHref } from "@/components/knowledge/content-cards";
import { strings } from "@/config/strings.ar";
import { getArticleForEditing } from "@/features/articles/articles.service";
import { listReviewNotes } from "@/features/articles/review-notes.service";
import { listActiveCategories } from "@/features/categories/categories.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { ArticleBody } from "@/lib/content/content-renderer";
import { sanitizeDocument } from "@/lib/content/document";
import { AppError } from "@/lib/errors";
import { hasPermission } from "@/lib/permissions";
import {
  addReviewNoteAction,
  deleteArticleAction,
  setArticleArchivedAction,
  setArticleFeaturedAction,
  setArticlePublishedAction,
  setReviewNoteResolvedAction,
  updateArticleAction,
} from "../actions";

export const metadata = { title: strings.editor.editArticle };

async function loadOrState(actor: Parameters<typeof getArticleForEditing>[0], id: string) {
  try {
    return { article: await getArticleForEditing(actor, id) };
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") return { denied: true };
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION")) return { missing: true };
    throw error;
  }
}

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await checkPageAccess("admin.access", `/admin/articles/${id}`);
  if (!access.allowed) return null;
  const { actor } = access;

  const loaded = await loadOrState(actor, id);
  if (loaded.denied) return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;
  if (!loaded.article) return <StateMessage icon={FileX} title={strings.errors.notFound} />;
  const { article } = loaded;

  const [categories, notes] = await Promise.all([listActiveCategories(), listReviewNotes(actor, id)]);

  const actions = {
    status: article.status,
    isArchived: article.isArchived,
    canPublish: hasPermission(actor, "content.publish"),
    canArchive: hasPermission(actor, "content.archive"),
    canDelete: hasPermission(actor, "content.delete"),
    onPublish: setArticlePublishedAction.bind(null, id),
    onArchive: setArticleArchivedAction.bind(null, id),
    onDelete: deleteArticleAction.bind(null, id),
    listHref: "/admin/articles",
    publicHref: slugHref("articles", article.slug),
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8" data-testid="article-edit-page">
      <AdminPageHeader title={article.title} backHref="/admin/articles">
        <StatusBadge status={article.status} isArchived={article.isArchived} />
      </AdminPageHeader>

      {hasPermission(actor, "content.editAny") ? <ArticleFeaturedToggle isFeatured={article.isFeatured} onChange={setArticleFeaturedAction.bind(null, id)} /> : null}

      {article.canEdit ? (
        <ArticleWorkspace
          actions={actions}
          editor={{
            id,
            status: article.status,
            canAssign: hasPermission(actor, "content.editAny"),
            categories: categories.map((category) => ({ id: category.id, title: category.title })),
            onSave: updateArticleAction.bind(null, id),
            initial: { ...article, body: sanitizeDocument(article.body) },
          }}
        />
      ) : (
        <>
          <StatusActions {...actions} />
          <p className="rounded-xl border bg-surface p-3 text-sm text-text-secondary" data-testid="article-readonly">
            {strings.editor.readOnly}
          </p>
          <div className="rounded-xl border bg-surface p-5" data-testid="article-preview">
            <ArticleBody body={article.body} />
          </div>
        </>
      )}

      <ReviewNotes notes={notes} canAdd={hasPermission(actor, "content.review")} onAdd={addReviewNoteAction.bind(null, id)} onResolve={setReviewNoteResolvedAction} />
    </div>
  );
}
