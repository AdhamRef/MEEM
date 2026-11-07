"use client";

import { useEffect, useState } from "react";
import { ShortsFeed } from "@/components/feed/shorts-feed";
import { PageLoading } from "@/components/shared/page-loading";
import type { InterestCatalogue } from "@/features/topics/catalogue.service";
import { FirstRunFlow } from "./first-run-flow";
import { usePreferences } from "./preferences-provider";

/**
 * Decides between the first-visit choices and the feed. Shared links open their own pages and never
 * pass through here. If the choices can't load, or there's nothing to choose yet, the feed simply
 * opens, because watching matters more than this step.
 */
export function HomeFeed() {
  const { status, onboarding } = usePreferences();
  const needsChoices = status === "ready" && onboarding === "pending";

  const [catalogue, setCatalogue] = useState<InterestCatalogue | null>(null);
  const [hasLoadFinished, setHasLoadFinished] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    if (!needsChoices || hasLoadFinished) return;

    let isCurrent = true;
    fetch("/api/topics")
      .then((response) => (response.ok ? (response.json() as Promise<InterestCatalogue>) : null))
      .catch(() => null)
      .then((loaded) => {
        if (!isCurrent) return;
        setCatalogue(loaded);
        setHasLoadFinished(true);
      });

    return () => {
      isCurrent = false;
    };
  }, [needsChoices, hasLoadFinished]);

  if (status === "loading" || (needsChoices && !hasLoadFinished)) return <PageLoading />;
  if (needsChoices && !isDismissed && catalogue?.topics.length) return <FirstRunFlow catalogue={catalogue} onDismiss={() => setIsDismissed(true)} />;
  return <ShortsFeed />;
}
