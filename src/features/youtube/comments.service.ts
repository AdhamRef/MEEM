import { z } from "zod";
import { objectIdSchema } from "@/features/categories/schemas";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { fetchCommentPage, type YouTubeComment } from "@/lib/youtube/comments";
import { YouTubeApiError } from "@/lib/youtube/client";

const pageTokenSchema = z.string().regex(/^[\w=-]{1,512}$/);

export type CommentsResult =
  | { state: "available"; comments: YouTubeComment[]; nextPageToken: string | null }
  | { state: "disabled" }
  | { state: "unavailable" };

export async function getVideoComments(rawVideoId: unknown, rawPageToken?: string | null): Promise<CommentsResult> {
  const videoId = objectIdSchema.safeParse(rawVideoId);
  if (!videoId.success) throw new AppError("VALIDATION");

  let pageToken: string | undefined;
  if (rawPageToken) {
    const parsed = pageTokenSchema.safeParse(rawPageToken);
    if (!parsed.success) throw new AppError("VALIDATION");
    pageToken = parsed.data;
  }

  const video = await prisma.video.findFirst({
    where: { id: videoId.data, status: "PUBLISHED", isArchived: false, availability: "AVAILABLE" },
    select: { id: true, youtubeVideoId: true, commentsDisabled: true },
  });
  if (!video) throw new AppError("NOT_FOUND");
  if (video.commentsDisabled) return { state: "disabled" };

  try {
    const page = await fetchCommentPage(video.youtubeVideoId, pageToken);
    return { state: "available", ...page };
  } catch (error) {
    if (!(error instanceof YouTubeApiError)) throw error;

    if (error.reason === "COMMENTS_DISABLED") {
      // Remembered, so later visitors don't each spend quota finding out again.
      await prisma.video.update({ where: { id: video.id }, data: { commentsDisabled: true } });
      return { state: "disabled" };
    }
    return { state: "unavailable" };
  }
}
