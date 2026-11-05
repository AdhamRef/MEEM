"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { strings } from "@/config/strings.ar";

const l = strings.library;

interface RemoveButtonProps {
  list: "saved" | "history";
  entityType: string;
  entityId: string;
  title: string;
}

/** Removing one item is easily undone by saving or opening it again, so it doesn't ask first. */
export function RemoveFromListButton({ list, entityType, entityId, title }: RemoveButtonProps) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const remove = async () => {
    setIsBusy(true);
    setFailed(false);
    try {
      const response =
        list === "saved"
          ? await fetch("/api/favorites", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityType, entityId, isSaved: false }) })
          : await fetch("/api/history", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityType, entityId }) });
      if (!response.ok) throw new Error("Removal failed");
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      {failed ? (
        <span role="alert" className="text-xs text-destructive">
          {l.removeFailed}
        </span>
      ) : null}
      <Button type="button" variant="ghost" size="icon" disabled={isBusy} aria-label={l.removeNamed(title)} title={l.remove} onClick={remove} data-testid="library-remove">
        <X aria-hidden />
      </Button>
    </div>
  );
}

export function ClearHistoryButton() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const clear = async () => {
    setIsBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/history", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) });
      if (!response.ok) throw new Error("Clearing failed");
      setIsOpen(false);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <>
      <Button type="button" variant="ghost" onClick={() => setIsOpen(true)} data-testid="history-clear">
        {l.clearHistory}
      </Button>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent data-testid="confirm-dialog">
          <DialogTitle className="text-lg font-semibold">{l.clearTitle}</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-text-secondary">{l.clearDescription}</DialogDescription>
          {failed ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {l.removeFailed}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" variant="destructive" disabled={isBusy} onClick={clear} data-testid="confirm-yes">
              {l.clearConfirm}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={isBusy}>
                {l.cancel}
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
