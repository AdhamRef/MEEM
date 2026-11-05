import { z } from "zod";
import { youtubeRequest } from "./client";

const COMMENTS_PER_PAGE = 20;

const commentThreadsSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({
          topLevelComment: z.object({
            snippet: z.object({
              authorDisplayName: z.string().optional(),
              authorChannelUrl: z.string().optional(),
              textOriginal: z.string().optional(),
              textDisplay: z.string().optional(),
              publishedAt: z.string().optional(),
            }),
          }),
        }),
      }),
    )
    .default([]),
});

export interface YouTubeComment {
  id: string;
  author: string;
  authorUrl: string | null;
  /** Plain text, shown in full. textDisplay is HTML, so it's used only if nothing else exists. */
  text: string;
  publishedAt: string | null;
}

export interface YouTubeCommentPage {
  comments: YouTubeComment[];
  nextPageToken: string | null;
}

const safeAuthorUrl = (url: string | undefined): string | null => (url?.startsWith("https://www.youtube.com/") ? url : null);

const stripTags = (html: string) => html.replace(/<[^>]*>/g, "");

/** Read-only and fetched on demand. Comments are never stored. */
export async function fetchCommentPage(youtubeVideoId: string, pageToken?: string): Promise<YouTubeCommentPage> {
  const { items, nextPageToken } = await youtubeRequest({
    endpoint: "commentThreads",
    params: {
      part: "snippet",
      videoId: youtubeVideoId,
      maxResults: String(COMMENTS_PER_PAGE),
      textFormat: "plainText",
      order: "relevance",
      ...(pageToken ? { pageToken } : {}),
    },
    schema: commentThreadsSchema,
    quotaUnits: 1,
  });

  return {
    nextPageToken: nextPageToken ?? null,
    comments: items.map((item) => {
      const comment = item.snippet.topLevelComment.snippet;
      return {
        id: item.id,
        author: comment.authorDisplayName ?? "",
        authorUrl: safeAuthorUrl(comment.authorChannelUrl),
        text: comment.textOriginal ?? stripTags(comment.textDisplay ?? ""),
        publishedAt: comment.publishedAt ?? null,
      };
    }),
  };
}
