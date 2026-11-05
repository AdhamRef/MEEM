"use server";

import { createArticle, deleteArticle, setArticleArchived, setArticleFeatured, setArticlePublished, updateArticle } from "@/features/articles/articles.service";
import { addReviewNote, setReviewNoteResolved } from "@/features/articles/review-notes.service";
import { runAction } from "@/lib/http/action";

export async function setArticleFeaturedAction(id: string, isFeatured: boolean) {
  return runAction("setArticleFeatured", async (actor) => {
    await setArticleFeatured(actor, id, isFeatured);
    return undefined;
  });
}

export async function createArticleAction(input: unknown) {
  return runAction("createArticle", async (actor) => ({ id: (await createArticle(actor, input)).id }));
}

export async function updateArticleAction(id: string, input: unknown) {
  return runAction("updateArticle", async (actor) => ({ id: (await updateArticle(actor, id, input)).id }));
}

export async function setArticlePublishedAction(id: string, isPublished: boolean) {
  return runAction("setArticlePublished", async (actor) => {
    await setArticlePublished(actor, id, isPublished);
    return undefined;
  });
}

export async function setArticleArchivedAction(id: string, isArchived: boolean) {
  return runAction("setArticleArchived", async (actor) => {
    await setArticleArchived(actor, id, isArchived);
    return undefined;
  });
}

export async function deleteArticleAction(id: string) {
  return runAction("deleteArticle", async (actor) => {
    await deleteArticle(actor, id);
    return undefined;
  });
}

export async function addReviewNoteAction(articleId: string, body: string) {
  return runAction("addReviewNote", async (actor) => {
    await addReviewNote(actor, articleId, body);
    return undefined;
  });
}

export async function setReviewNoteResolvedAction(noteId: string, isResolved: boolean) {
  return runAction("setReviewNoteResolved", async (actor) => {
    await setReviewNoteResolved(actor, noteId, isResolved);
    return undefined;
  });
}
