"use client";

import { ExternalLink, Loader2, MoreVertical, PauseCircle, PlayCircle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { checkChannelNowAction, setChannelFollowedAction } from "@/app/(admin)/admin/sources/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { strings } from "@/config/strings.ar";
import { youtubeChannelUrl } from "./visuals";

const t = strings.sources;
const c = strings.adminContent;

interface ChannelSourceActionsProps {
  channelId: string;
  youtubeChannelId: string;
  isFollowed: boolean;
  canCheck: boolean;
}

/** "Check now" stays in view, and the rest is in a menu, so each row stays one line on a phone. */
export function ChannelSourceActions({ channelId, youtubeChannelId, isFollowed, canCheck }: ChannelSourceActionsProps) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const check = async () => {
    setIsBusy(true);
    setMessage(null);
    const result = await checkChannelNowAction(channelId);
    setIsBusy(false);
    if (!result.ok) setMessage({ text: result.message, isError: true });
    else setMessage({ text: result.data.message ?? t.checkAdded(result.data.added), isError: Boolean(result.data.message) });
    router.refresh();
  };

  const setFollowed = async (next: boolean) => {
    setIsBusy(true);
    setMessage(null);
    const result = await setChannelFollowedAction(channelId, next);
    setIsBusy(false);
    setIsConfirming(false);
    if (!result.ok) setMessage({ text: result.message, isError: true });
    router.refresh();
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        {isFollowed ? (
          <Button type="button" variant="secondary" disabled={isBusy || !canCheck} onClick={check} data-testid="channel-check">
            {isBusy ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" data-icon="inline-start" /> : <RefreshCw aria-hidden data-icon="inline-start" />}
            {isBusy ? t.checking : t.checkNow}
          </Button>
        ) : (
          <Button type="button" disabled={isBusy} onClick={() => setFollowed(true)} data-testid="channel-follow">
            <PlayCircle aria-hidden data-icon="inline-start" />
            {t.follow}
          </Button>
        )}
        <DropdownMenu dir="rtl" modal={false}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={t.actions} disabled={isBusy} data-testid="channel-menu">
              <MoreVertical aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a href={youtubeChannelUrl(youtubeChannelId)} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden />
                {t.openOnYouTube}
              </a>
            </DropdownMenuItem>
            {isFollowed ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setIsConfirming(true)} data-testid="channel-unfollow">
                  <PauseCircle aria-hidden />
                  {t.unfollow}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {message ? (
        <p role={message.isError ? "alert" : "status"} className={message.isError ? "text-xs text-destructive" : "text-xs text-text-secondary"} data-testid="channel-message">
          {message.text}
        </p>
      ) : null}

      <Dialog open={isConfirming} onOpenChange={setIsConfirming}>
        <DialogContent data-testid="confirm-dialog">
          <DialogTitle className="text-lg font-semibold">{t.unfollowConfirmTitle}</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-text-secondary">{t.unfollowConfirm}</DialogDescription>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" variant="destructive" disabled={isBusy} onClick={() => setFollowed(false)} data-testid="confirm-yes">
              {t.unfollow}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={isBusy}>
                {c.cancel}
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
