"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * shadcn's Sheet pattern, on the Radix dialog the project already uses, so no new package. It
 * rises from the bottom on phones, where a thumb reaches it, and slides in from the start side
 * on wider screens.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

export function SheetContent({ className, children, closeLabel, ...props }: ComponentProps<typeof DialogPrimitive.Content> & { closeLabel: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-surface-elevated p-5 shadow-2xl outline-none",
          "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-3xl pb-[calc(1.25rem+env(safe-area-inset-bottom))] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
          "md:inset-x-auto md:inset-y-0 md:start-0 md:max-h-none md:w-96 md:rounded-none md:rounded-e-3xl md:data-[state=open]:slide-in-from-start",
          className,
        )}
        {...props}
      >
        <span aria-hidden className="mx-auto -mt-2 h-1.5 w-12 shrink-0 rounded-full bg-border md:hidden" />
        <DialogPrimitive.Close
          aria-label={closeLabel}
          className="absolute end-3 top-3 flex size-11 items-center justify-center rounded-full text-text-secondary outline-none hover:bg-surface hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X aria-hidden className="size-5" />
        </DialogPrimitive.Close>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
