"use client";

import { Bookmark, BookmarkCheck, ExternalLink, Share2 } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { signInHref } from "@/lib/auth/callback-url";
import { youtubeWatchUrl } from "@/lib/youtube/ids";

interface SaveButtonProps {
  videoId?: string;
  /** Pass this instead of videoId for anything else that can be saved. */
  content?: { entityType: "ARTICLE" | "TOPIC" | "PLAYLIST"; entityId: string };
  isSaved: boolean;
  callbackPath: string;
  onChange: (isSaved: boolean) => void;
  onFailure: (message: string) => void;
}

/** A guest gets a link to the optional sign-in, and never a dialog in the way. */
export function SaveButton({ videoId, content, isSaved, callbackPath, onChange, onFailure }: SaveButtonProps) {
  const { status } = useSession();
  const [isBusy, setIsBusy] = useState(false);

  if (status !== "authenticated") {
    return (
      <Button asChild variant="ghost" size="icon" aria-label={strings.feed.signInToSave} title={strings.feed.signInToSave} data-testid="save-signin">
        <Link href={signInHref(callbackPath)}>
          <Bookmark aria-hidden />
        </Link>
      </Button>
    );
  }

  const toggle = async () => {
    const next = !isSaved;
    setIsBusy(true);
    onChange(next);
    try {
      const response = await fetch("/api/favorites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(content ? { ...content, isSaved: next } : { videoId, isSaved: next }),
      });
      if (!response.ok) throw new Error("Save failed");
    } catch {
      onChange(!next);
      onFailure(strings.feed.saveFailed);
    } finally {
      setIsBusy(false);
    }
  };

  const label = isSaved ? strings.feed.saved : strings.feed.save;
  const Icon = isSaved ? BookmarkCheck : Bookmark;

  return (
    <Button variant="ghost" size="icon" aria-label={label} aria-pressed={isSaved} title={label} disabled={isBusy} onClick={toggle} data-testid="save">
      <Icon aria-hidden className={isSaved ? "text-brand" : undefined} />
    </Button>
  );
}

export function ShareButton({ path, title, onResult }: { path: string; title: string; onResult: (message: string) => void }) {
  const share = async () => {
    const url = `${window.location.origin}${path}`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard.writeText(url);
        onResult(strings.feed.linkCopied);
      }
    } catch (error) {
      // Closing the share sheet is a choice, not a failure.
      if (!(error instanceof DOMException && error.name === "AbortError")) onResult(strings.feed.shareFailed);
    }
  };

  return (
    <Button variant="ghost" size="icon" aria-label={strings.feed.share} title={strings.feed.share} onClick={share} data-testid="share">
      <Share2 aria-hidden />
    </Button>
  );
}

/** YouTube is credited on each item that shows its content, as the policies require. */
export function YouTubeAttribution({ youtubeVideoId, channelTitle }: { youtubeVideoId: string; channelTitle: string | null }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-text-secondary" data-testid="youtube-attribution">
      {channelTitle ? <bdi className="font-medium text-text-primary">{channelTitle}</bdi> : null}
      <span>{strings.feed.source}</span>
      <a
        href={youtubeWatchUrl(youtubeVideoId)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-6 items-center gap-1 text-brand underline-offset-4 hover:underline"
      >
        {strings.feed.watchOnYouTube}
        <ExternalLink aria-hidden className="size-3" />
      </a>
    </p>
  );
}
