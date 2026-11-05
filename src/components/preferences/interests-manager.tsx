"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ErrorMessage } from "@/components/shared/error-message";
import { PageLoading } from "@/components/shared/page-loading";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { signInHref } from "@/lib/auth/callback-url";
import { InterestPicker, toggleSelection, type PickerCategory } from "./interest-picker";
import { usePreferences } from "./preferences-provider";

type Notice = { kind: "success" | "failure"; text: string } | null;

function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

export function InterestsManager({ categories }: { categories: PickerCategory[] }) {
  const { status, isGuest, selectedCategoryIds, saveInterests, resetInterests, reload } = usePreferences();

  // Null until the first edit, so this always shows what's stored until the person changes it.
  const [draft, setDraft] = useState<ReadonlySet<string> | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  // A stored category may have been deactivated since. Only offer what's shown here.
  const stored = useMemo(() => {
    const available = new Set(categories.map((category) => category.id));
    return new Set(selectedCategoryIds.filter((id) => available.has(id)));
  }, [categories, selectedCategoryIds]);

  if (status === "loading") return <PageLoading />;
  if (status === "error") return <ErrorMessage onRetry={reload} />;

  const selected = draft ?? stored;
  const isDirty = !sameMembers(selected, stored);

  const run = async (work: () => Promise<void>, successText: string) => {
    setIsBusy(true);
    setNotice(null);
    try {
      await work();
      setDraft(null);
      setNotice({ kind: "success", text: successText });
    } catch {
      setNotice({ kind: "failure", text: strings.interests.saveFailed });
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <InterestPicker
        categories={categories}
        selectedIds={selected}
        onToggle={(id) => {
          setNotice(null);
          setDraft(toggleSelection(selected, id));
        }}
        label={strings.interests.pageTitle}
        disabled={isBusy}
      />

      <div role="status" className="min-h-6 text-sm">
        {notice ? <span className={notice.kind === "success" ? "text-text-secondary" : "text-destructive"}>{notice.text}</span> : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => run(() => saveInterests([...selected]), strings.interests.saved)} disabled={isBusy || !isDirty}>
          {isBusy ? strings.interests.saving : strings.interests.save}
        </Button>

        {isConfirmingReset ? null : (
          <Button variant="ghost" onClick={() => setIsConfirmingReset(true)} disabled={isBusy}>
            {strings.interests.reset}
          </Button>
        )}
      </div>

      {isConfirmingReset ? (
        <div className="space-y-3 rounded-xl border bg-surface p-4">
          <p>{strings.interests.resetConfirm}</p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="destructive"
              disabled={isBusy}
              onClick={async () => {
                await run(resetInterests, strings.interests.resetDone);
                setIsConfirmingReset(false);
              }}
            >
              {strings.interests.resetConfirmAction}
            </Button>
            <Button variant="ghost" disabled={isBusy} onClick={() => setIsConfirmingReset(false)}>
              {strings.interests.resetCancel}
            </Button>
          </div>
        </div>
      ) : null}

      <p className="text-sm text-text-secondary">
        {isGuest ? (
          <>
            {strings.interests.guestNote}{" "}
            <Link href={signInHref("/interests")} className="text-brand underline-offset-4 hover:underline">
              {strings.interests.guestSignInLink}
            </Link>
          </>
        ) : (
          strings.interests.accountNote
        )}
      </p>
    </div>
  );
}
