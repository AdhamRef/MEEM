"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";

export const PRIVACY_NOTICE_KEY = "privacy-notice.v1";
const n = strings.legal.notice;

/**
 * One time, and never in the way (R3). It sits in the page's flow rather than floating, so it
 * can't end up in front of a video player, and pushes the page down until it's dismissed.
 * Whether this counts as agreeing for YouTube's purposes is a question for the audit.
 */
export function PrivacyNotice() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    try {
      // Only known in the browser, so it can't be part of the server's HTML.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsVisible(window.localStorage.getItem(PRIVACY_NOTICE_KEY) === null);
    } catch {
      // With storage blocked it couldn't stay dismissed, and would return on every page.
    }
  }, []);

  if (!isVisible) return null;

  return (
    <aside aria-label={n.label} className="flex items-center gap-2 border-b bg-surface px-4 py-2 text-sm" data-testid="privacy-notice">
      <p className="min-w-0 flex-1 text-text-secondary">
        {n.body}{" "}
        <Link href="/privacy" className="text-brand underline underline-offset-4">
          {n.link}
        </Link>
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={n.dismiss}
        data-testid="privacy-notice-dismiss"
        onClick={() => {
          setIsVisible(false);
          try {
            window.localStorage.setItem(PRIVACY_NOTICE_KEY, new Date().toISOString());
          } catch {
            // Dismissed for this page, at least.
          }
        }}
      >
        <X aria-hidden />
      </Button>
    </aside>
  );
}
