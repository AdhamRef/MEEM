"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { strings } from "@/config/strings.ar";
import { GUEST_PREFERENCES_KEY } from "@/features/preferences/guest-storage";
import { GUEST_SIGNALS_KEY } from "@/features/recommendations/guest-signals";

const a = strings.account;

export function DeleteAccount() {
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const remove = async () => {
    setIsBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      if (!response.ok) throw new Error("Deletion failed");
      // This browser's copies go too, so nothing of the account lingers on the device.
      try {
        window.localStorage.removeItem(GUEST_PREFERENCES_KEY);
        window.localStorage.removeItem(GUEST_SIGNALS_KEY);
      } catch {
        // Blocked storage has nothing to clear.
      }
      await signOut({ callbackUrl: "/" });
    } catch {
      setFailed(true);
      setIsBusy(false);
    }
  };

  return (
    <>
      <Button type="button" variant="destructive" onClick={() => setIsOpen(true)} data-testid="account-delete">
        {a.delete}
      </Button>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent data-testid="confirm-dialog">
          <DialogTitle className="text-lg font-semibold">{a.confirmTitle}</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-text-secondary">{a.confirmDescription}</DialogDescription>
          {failed ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {a.deleteFailed}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" variant="destructive" disabled={isBusy} onClick={remove} data-testid="confirm-yes">
              {a.confirmAction}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={isBusy}>
                {a.cancel}
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
