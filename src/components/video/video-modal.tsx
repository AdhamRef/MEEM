"use client";

import { X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { strings } from "@/config/strings.ar";

/**
 * A Short opened from an article or topic, over the page that linked to it. The close button
 * sits in a bar above the content, so nothing is ever placed in front of the player.
 */
export function VideoModal({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [openedAt] = useState(pathname);

  // A link inside the modal moves to another page, and Next.js would otherwise keep this slot on screen.
  if (pathname !== openedAt) return null;

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) router.back();
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-w-2xl p-0" data-testid="video-modal">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-surface-elevated ps-4 pe-1.5 py-1.5">
          <DialogTitle className="text-sm font-medium text-text-secondary">{strings.articles.videoDialog}</DialogTitle>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" aria-label={strings.articles.closeVideo} data-testid="video-modal-close">
              <X aria-hidden />
            </Button>
          </DialogClose>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
