/* eslint-disable @next/next/no-img-element -- Channel images load directly from YouTube by design. */
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A channel's own picture from YouTube, or its first letter when it hasn't got one or it won't load.
 * Sent with no referrer because YouTube's image host often refuses these when one is present: 2026-11-07,
 * in Chromium from localhost, all 8 real channel pictures failed in 3 of 6 runs, and none did without one.
 */
export function ChannelAvatar({ title, thumbnailUrl, className }: { title: string; thumbnailUrl: string | null; className?: string }) {
  const [hasFailed, setHasFailed] = useState(false);

  if (thumbnailUrl && !hasFailed) {
    return <img src={thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setHasFailed(true)} className={cn("object-cover", className)} />;
  }
  return (
    <span aria-hidden className={cn("flex items-center justify-center bg-surface-elevated text-2xl font-semibold text-text-secondary", className)}>
      {title.trim().charAt(0)}
    </span>
  );
}
