"use server";

import { listMatchingArticleIds } from "@/features/articles/articles.service";
import { bulkAssignArticles, bulkAssignVideos, bulkPublishVideos, listMatchingVideoIds, setVideoArchived } from "@/features/shorts/videos-admin.service";
import { assignVideo, setVideoPublished } from "@/features/shorts/videos.service";
import { runAction } from "@/lib/http/action";

export async function listMatchingVideoIdsAction(filter: unknown, cursor?: string) {
  return runAction("listMatchingVideoIds", (actor) => listMatchingVideoIds(actor, filter, cursor));
}

export async function listMatchingArticleIdsAction(filter: unknown, cursor?: string) {
  return runAction("listMatchingArticleIds", (actor) => listMatchingArticleIds(actor, filter, cursor));
}

export async function bulkAssignVideosAction(input: unknown) {
  return runAction("bulkAssignVideos", (actor) => bulkAssignVideos(actor, input));
}

export async function bulkPublishVideosAction(input: unknown) {
  return runAction("bulkPublishVideos", (actor) => bulkPublishVideos(actor, input));
}

export async function bulkAssignArticlesAction(input: unknown) {
  return runAction("bulkAssignArticles", (actor) => bulkAssignArticles(actor, input));
}

export async function assignVideoAction(id: string, input: unknown) {
  return runAction("assignVideo", async (actor) => {
    await assignVideo(actor, id, input);
    return undefined;
  });
}

export async function setVideoPublishedAction(id: string, isPublished: boolean) {
  return runAction("setVideoPublished", async (actor) => {
    await setVideoPublished(actor, id, isPublished);
    return undefined;
  });
}

export async function setVideoArchivedAction(id: string, isArchived: boolean) {
  return runAction("setVideoArchived", async (actor) => {
    await setVideoArchived(actor, id, isArchived);
    return undefined;
  });
}
