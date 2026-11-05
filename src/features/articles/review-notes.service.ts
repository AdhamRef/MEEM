import { z } from "zod";
import { recordAudit } from "@/features/admin/audit";
import { parseId } from "@/features/content/common";
import { AppError } from "@/lib/errors";
import { assertPermission, hasPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { canViewArticle } from "./permissions";

const noteBodySchema = z.string().trim().min(1).max(4000);

async function loadArticleForNotes(actor: Actor, articleId: string) {
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { status: true, authorId: true, assigneeIds: true } });
  if (!article) throw new AppError("NOT_FOUND");
  if (!canViewArticle(actor, article)) throw new AppError("FORBIDDEN");
  return article;
}

/** Feedback only. Publishing never looks at these, so a reviewer is never a mandatory stage (§19.4). */
export async function addReviewNote(actor: Actor | null, rawArticleId: unknown, rawBody: unknown) {
  assertPermission(actor, "content.review");
  const articleId = parseId(rawArticleId);
  const parsed = noteBodySchema.safeParse(rawBody);
  if (!parsed.success) throw new AppError("VALIDATION");
  await loadArticleForNotes(actor, articleId);

  return withTransaction(async (tx) => {
    const note = await tx.reviewNote.create({ data: { entityType: "ARTICLE", entityId: articleId, authorId: actor.id, body: parsed.data } });
    await recordAudit(tx, actor, { action: "review_note.create", entityType: "Article", entityId: articleId });
    return note;
  });
}

export async function setReviewNoteResolved(actor: Actor | null, rawNoteId: unknown, isResolved: boolean) {
  assertPermission(actor, "admin.access");
  const noteId = parseId(rawNoteId);

  return withTransaction(async (tx) => {
    const note = await tx.reviewNote.findUnique({ where: { id: noteId }, select: { entityId: true, entityType: true } });
    if (!note || note.entityType !== "ARTICLE") throw new AppError("NOT_FOUND");
    // The writer acts on feedback, so they can mark it done as well as reviewers can.
    if (!hasPermission(actor, "content.review")) {
      const article = await tx.article.findUnique({ where: { id: note.entityId }, select: { status: true, authorId: true, assigneeIds: true } });
      if (!article || !canViewArticle(actor, article)) throw new AppError("FORBIDDEN");
    }
    const updated = await tx.reviewNote.update({ where: { id: noteId }, data: { resolvedAt: isResolved ? new Date() : null } });
    await recordAudit(tx, actor, { action: isResolved ? "review_note.resolve" : "review_note.reopen", entityType: "Article", entityId: note.entityId });
    return updated;
  });
}

export async function listReviewNotes(actor: Actor | null, rawArticleId: unknown) {
  assertPermission(actor, "admin.access");
  const articleId = parseId(rawArticleId);
  await loadArticleForNotes(actor, articleId);

  const notes = await prisma.reviewNote.findMany({
    where: { entityType: "ARTICLE", entityId: articleId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, body: true, resolvedAt: true, createdAt: true, author: { select: { name: true, email: true } } },
  });
  return notes.map((note) => ({
    id: note.id,
    body: note.body,
    isResolved: note.resolvedAt !== null,
    createdAt: note.createdAt,
    authorName: note.author?.name ?? note.author?.email ?? null,
  }));
}
