"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { strings } from "@/config/strings.ar";
import type { ActionResult } from "@/lib/http/action";

type Result = ActionResult<undefined>;

export interface StatusActionsProps {
  status: "DRAFT" | "PUBLISHED";
  isArchived: boolean;
  canPublish: boolean;
  canArchive: boolean;
  canDelete: boolean;
  /** Blocks publishing, because the form holds changes the server hasn't seen. */
  hasUnsavedChanges?: boolean;
  onPublish: (isPublished: boolean) => Promise<Result>;
  onArchive: (isArchived: boolean) => Promise<Result>;
  onDelete: () => Promise<Result>;
  listHref: string;
  publicHref?: string;
}

type Pending = { title: string; description: string; run: () => Promise<Result>; isDestructive?: boolean; afterSuccess?: () => void };

/** Removing something from the site or the database always asks first. Publishing doesn't need to. */
export function StatusActions({ status, isArchived, canPublish, canArchive, canDelete, hasUnsavedChanges, onPublish, onArchive, onDelete, listHref, publicHref }: StatusActionsProps) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const perform = async (run: () => Promise<Result>, afterSuccess?: () => void) => {
    setIsBusy(true);
    setMessage(null);
    const result = await run();
    setIsBusy(false);
    setPending(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(strings.adminContent.done);
    if (afterSuccess) afterSuccess();
    else router.refresh();
  };

  const c = strings.adminContent;
  const isPublished = status === "PUBLISHED";

  return (
    <div className="space-y-2" data-testid="status-actions">
      <div className="flex flex-wrap items-center gap-2">
        {canPublish && !isArchived && !isPublished ? (
          <Button type="button" disabled={isBusy || hasUnsavedChanges} onClick={() => perform(() => onPublish(true))} data-testid="action-publish">
            {c.publish}
          </Button>
        ) : null}
        {canPublish && !isArchived && isPublished ? (
          <Button type="button" variant="secondary" disabled={isBusy} onClick={() => setPending({ title: c.confirmUnpublishTitle, description: c.confirmUnpublishDescription, run: () => onPublish(false) })} data-testid="action-unpublish">
            {c.unpublish}
          </Button>
        ) : null}
        {canArchive && !isArchived ? (
          <Button type="button" variant="secondary" disabled={isBusy} onClick={() => setPending({ title: c.confirmArchiveTitle, description: c.confirmArchiveDescription, run: () => onArchive(true) })} data-testid="action-archive">
            {c.archive}
          </Button>
        ) : null}
        {canArchive && isArchived ? (
          <Button type="button" variant="secondary" disabled={isBusy} onClick={() => perform(() => onArchive(false))} data-testid="action-restore">
            {c.restore}
          </Button>
        ) : null}
        {canDelete ? (
          <Button
            type="button"
            variant="destructive"
            disabled={isBusy}
            onClick={() =>
              setPending({
                title: c.confirmDeleteTitle,
                description: c.confirmDeleteDescription,
                run: onDelete,
                isDestructive: true,
                afterSuccess: () => {
                  router.push(listHref);
                  router.refresh();
                },
              })
            }
            data-testid="action-delete"
          >
            {c.delete}
          </Button>
        ) : null}
        {publicHref && isPublished && !isArchived ? (
          <Button asChild variant="ghost">
            <a href={publicHref} target="_blank" rel="noopener noreferrer" data-testid="action-view">
              {c.viewPublic}
            </a>
          </Button>
        ) : null}
      </div>

      <p role="status" className={message ? "text-sm text-text-secondary" : "sr-only"} data-testid="status-message">
        {message}
      </p>

      <Dialog open={pending !== null} onOpenChange={(isOpen) => !isOpen && setPending(null)}>
        <DialogContent data-testid="confirm-dialog">
          <DialogTitle className="text-lg font-semibold">{pending?.title}</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-text-secondary">{pending?.description}</DialogDescription>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" variant={pending?.isDestructive ? "destructive" : "default"} disabled={isBusy} onClick={() => pending && perform(pending.run, pending.afterSuccess)} data-testid="confirm-yes">
              {c.confirm}
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
