"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { InterestPicker, toggleSelection, type PickerCategory } from "./interest-picker";
import { usePreferences } from "./preferences-provider";

/**
 * The optional first-visit interest selection (§9.1). It sits in the page rather than in a
 * dialog, so it never blocks anything. Categories load only when it's actually needed, and
 * if they can't load it simply doesn't appear, because browsing matters more than this.
 */
export function OnboardingPrompt() {
  const { status, onboarding, completeOnboarding, skipOnboarding } = usePreferences();
  const isPending = status === "ready" && onboarding === "pending";

  const [categories, setCategories] = useState<PickerCategory[]>([]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [isBusy, setIsBusy] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    if (!isPending) return;

    let isCurrent = true;
    fetch("/api/categories")
      .then((response) => (response.ok ? (response.json() as Promise<{ categories: PickerCategory[] }>) : { categories: [] }))
      .then((data) => {
        if (isCurrent) setCategories(data.categories);
      })
      .catch(() => {
        // Leaves the prompt hidden. Interests can still be chosen later from /interests.
      });

    return () => {
      isCurrent = false;
    };
  }, [isPending]);

  if (!isPending || categories.length === 0) return null;

  const run = async (work: () => Promise<void>) => {
    setIsBusy(true);
    setHasFailed(false);
    try {
      await work();
    } catch {
      setHasFailed(true);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    // A slide in the feed rather than a dialog, so people can simply scroll past it.
    <section aria-labelledby="onboarding-title" data-testid="onboarding" className="mx-auto h-full w-full max-w-4xl snap-start space-y-5 overflow-y-auto px-4 py-6">

      <div className="space-y-1.5">
        <h2 id="onboarding-title" className="text-xl font-semibold">
          {strings.interests.promptTitle}
        </h2>
        <p className="text-text-secondary">{strings.interests.promptDescription}</p>
      </div>

      <InterestPicker
        categories={categories}
        selectedIds={selectedIds}
        onToggle={(id) => setSelectedIds((current) => toggleSelection(current, id))}
        label={strings.interests.promptTitle}
        disabled={isBusy}
      />

      {hasFailed ? (
        <p role="alert" className="text-sm text-destructive">
          {strings.interests.saveFailed}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => run(() => completeOnboarding([...selectedIds]))} disabled={isBusy || selectedIds.size === 0}>
          {strings.interests.start}
        </Button>
        <Button variant="ghost" onClick={() => run(skipOnboarding)} disabled={isBusy}>
          {strings.interests.skip}
        </Button>
      </div>
    </section>
  );
}
