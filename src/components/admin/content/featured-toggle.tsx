"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { strings } from "@/config/strings.ar";
import type { ActionResult } from "@/lib/http/action";

const s = strings.collections;

export function ArticleFeaturedToggle({ isFeatured, onChange }: { isFeatured: boolean; onChange: (isFeatured: boolean) => Promise<ActionResult<undefined>> }) {
  const router = useRouter();
  const [checked, setChecked] = useState(isFeatured);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-xl border bg-surface p-4" data-testid="article-featured">
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={checked}
          disabled={isBusy}
          className="size-4"
          data-testid="article-featured-input"
          onChange={async (event) => {
            const next = event.target.checked;
            setChecked(next);
            setIsBusy(true);
            setError(null);
            const result = await onChange(next);
            setIsBusy(false);
            if (result.ok) {
              router.refresh();
            } else {
              setChecked(!next);
              setError(result.message);
            }
          }}
        />
        {s.featureArticle}
      </label>
      <p className="text-xs text-text-secondary">{s.featureArticleHint}</p>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
