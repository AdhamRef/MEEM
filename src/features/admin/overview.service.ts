import { assertPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export interface AdminOverview {
  activeCategories: number;
  publishedTopics: number;
  draftTopics: number;
  publishedArticles: number;
  draftArticles: number;
  publishedLibraries: number;
}

/** Real counts only. Anything not yet tracked is left out rather than shown as zero. */
export async function getAdminOverview(actor: Actor | null): Promise<AdminOverview> {
  assertPermission(actor, "admin.access");
  const [activeCategories, publishedTopics, draftTopics, publishedArticles, draftArticles, publishedLibraries] = await Promise.all([
    prisma.category.count({ where: { isActive: true } }),
    prisma.topic.count({ where: { status: "PUBLISHED", isArchived: false } }),
    prisma.topic.count({ where: { status: "DRAFT", isArchived: false } }),
    prisma.article.count({ where: { status: "PUBLISHED", isArchived: false } }),
    prisma.article.count({ where: { status: "DRAFT", isArchived: false } }),
    prisma.library.count({ where: { status: "PUBLISHED", isArchived: false } }),
  ]);
  return { activeCategories, publishedTopics, draftTopics, publishedArticles, draftArticles, publishedLibraries };
}
