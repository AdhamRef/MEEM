"use client";

import { Bookmark, BookmarkCheck, EllipsisVertical, ExternalLink, Share2 } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { strings } from "@/config/strings.ar";
import type { VideoCard } from "@/features/shorts/types";
import { signInHref } from "@/lib/auth/callback-url";
import { youtubeWatchUrl } from "@/lib/youtube/ids";

const videoPath = (video: VideoCard) => (video.kind === "SHORT" ? `/shorts/${video.id}` : `/videos/${video.id}`);

/** The three dots on a video: save, share, and YouTube itself. Saved state is only asked for when it's opened. */
export function VideoCardMenu({ video }: { video: VideoCard }) {
  const { status } = useSession();
  const [isSaved, setIsSaved] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const isSignedIn = status === "authenticated";

  const onOpen = (isOpen: boolean) => {
    if (!isOpen || !isSignedIn) return;
    setNotice(null);
    fetch(`/api/favorites?ids=${video.id}`)
      .then((response) => (response.ok ? (response.json() as Promise<{ savedIds: string[] }>) : { savedIds: [] }))
      .then(({ savedIds }) => setIsSaved(savedIds.includes(video.id)))
      .catch(() => {
        // Shown as not saved. Saving again is harmless.
      });
  };

  const toggleSave = async () => {
    const next = !isSaved;
    setIsSaved(next);
    try {
      const response = await fetch("/api/favorites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: video.id, isSaved: next }),
      });
      if (!response.ok) throw new Error("Save failed");
    } catch {
      setIsSaved(!next);
      setNotice(strings.feed.saveFailed);
    }
  };

  const share = async () => {
    const url = `${window.location.origin}${videoPath(video)}`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: video.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        setNotice(strings.feed.linkCopied);
      }
    } catch (error) {
      // Closing the share sheet is a choice, not a failure.
      if (!(error instanceof DOMException && error.name === "AbortError")) setNotice(strings.feed.shareFailed);
    }
  };

  const SaveIcon = isSaved ? BookmarkCheck : Bookmark;

  return (
    <>
      <DropdownMenu dir="rtl" onOpenChange={onOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="-me-2 shrink-0 rounded-full" aria-label={strings.explore.videoMenu} title={strings.explore.videoMenu} data-testid="video-menu">
            <EllipsisVertical aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isSignedIn ? (
            <DropdownMenuItem onSelect={() => void toggleSave()} data-testid="video-menu-save">
              <SaveIcon aria-hidden />
              {isSaved ? strings.feed.saved : strings.feed.save}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem asChild>
              <Link href={signInHref(videoPath(video))}>
                <Bookmark aria-hidden />
                {strings.feed.signInToSave}
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => void share()} data-testid="video-menu-share">
            <Share2 aria-hidden />
            {strings.feed.share}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={youtubeWatchUrl(video.youtubeVideoId)} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden />
              {strings.feed.watchOnYouTube}
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {notice ? (
        <p role="status" className="sr-only">
          {notice}
        </p>
      ) : null}
    </>
  );
}
