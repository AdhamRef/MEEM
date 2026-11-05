import { hasPermission, type Actor } from "@/lib/permissions";

export interface ArticleAccessFields {
  status: "DRAFT" | "PUBLISHED";
  authorId: string | null;
  assigneeIds: string[];
}

const isAssigned = (actor: Actor, article: ArticleAccessFields) => article.authorId === actor.id || article.assigneeIds.includes(actor.id);

/** §19.4: contributors edit assigned drafts. Someone who may edit anything isn't limited to drafts. */
export function canEditArticle(actor: Actor, article: ArticleAccessFields): boolean {
  if (hasPermission(actor, "content.editAny")) return true;
  return hasPermission(actor, "content.editAssigned") && article.status === "DRAFT" && isAssigned(actor, article);
}

export function canViewArticle(actor: Actor, article: ArticleAccessFields): boolean {
  return hasPermission(actor, "content.viewAny") || canEditArticle(actor, article) || isAssigned(actor, article);
}
