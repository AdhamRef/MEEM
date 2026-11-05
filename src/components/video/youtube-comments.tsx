"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import type { CommentsResult } from "@/features/youtube/comments.service";
import type { YouTubeComment } from "@/lib/youtube/comments";
import { youtubeWatchUrl } from "@/lib/youtube/ids";

type View = "closed" | "loading" | "available" | "disabled" | "unavailable";

/**
 * Read-only, and clearly YouTube's. Loaded only when asked for, because each page costs quota
 * and comments are optional. There's no comment form, since posting needs YouTube authorization.
 */
export function YouTubeComments({ videoId, youtubeVideoId }: { videoId: string; youtubeVideoId: string }) {
  const [view, setView] = useState<View>("closed");
  const [comments, setComments] = useState<YouTubeComment[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const load = async (pageToken: string | null) => {
    const params = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : "";
    try {
      const response = await fetch(`/api/comments/${videoId}${params}`);
      if (!response.ok) throw new Error("Comments request failed");
      const result = (await response.json()) as CommentsResult;
      if (result.state === "available") {
        setComments((current) => [...current, ...result.comments]);
        setNextPageToken(result.nextPageToken);
      }
      setView(result.state);
    } catch {
      setView("unavailable");
    }
  };

  return (
    <section id="comments" aria-labelledby="comments-title" className="scroll-mt-16 space-y-3 border-t pt-5" data-testid="youtube-comments">
      <div className="space-y-1">
        <h2 id="comments-title" className="text-lg font-semibold">
          {strings.video.commentsTitle}
        </h2>
        <p className="text-sm text-text-secondary">{strings.video.commentsNote}</p>
      </div>

      {view === "closed" ? (
        <Button
          variant="secondary"
          onClick={() => {
            setView("loading");
            void load(null);
          }}
        >
          {strings.video.showComments}
        </Button>
      ) : null}

      {view === "loading" ? <p role="status">{strings.video.commentsLoading}</p> : null}
      {view === "disabled" ? <p role="status">{strings.video.commentsDisabled}</p> : null}

      {view === "unavailable" ? (
        <p role="status">
          {strings.video.commentsUnavailable}{" "}
          <a href={youtubeWatchUrl(youtubeVideoId)} target="_blank" rel="noopener noreferrer" className="text-brand underline-offset-4 hover:underline">
            {strings.feed.watchOnYouTube}
          </a>
        </p>
      ) : null}

      {view === "available" && comments.length === 0 ? <p role="status">{strings.video.commentsEmpty}</p> : null}

      {comments.length > 0 ? (
        <ul className="space-y-4">
          {comments.map((comment) => (
            <li key={comment.id} className="space-y-1">
              <p className="text-sm font-medium">
                {comment.authorUrl ? (
                  <a href={comment.authorUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline-offset-4 hover:underline">
                    <bdi>{comment.author}</bdi>
                  </a>
                ) : (
                  <bdi>{comment.author}</bdi>
                )}
              </p>
              {/* Rendered as text, so anything in a comment stays harmless. Shown in full. */}
              <p dir="auto" className="text-start text-sm whitespace-pre-line text-text-secondary">
                {comment.text}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {nextPageToken ? (
        <Button
          variant="ghost"
          disabled={isLoadingMore}
          onClick={async () => {
            setIsLoadingMore(true);
            await load(nextPageToken);
            setIsLoadingMore(false);
          }}
        >
          {strings.video.moreComments}
        </Button>
      ) : null}
    </section>
  );
}
