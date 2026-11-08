"use client";

import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addSourceAction } from "@/app/(admin)/admin/sources/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { strings } from "@/config/strings.ar";
import { describeAddResult } from "@/features/youtube/sources/describe";

const t = strings.sources;

/** One box for every kind of source. What a link is gets worked out on the server, never trusted from here. */
export function AddSourceForm({ unavailableReason }: { unavailableReason: string | null }) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const submit = async () => {
    if (!input.trim() || isBusy) return;
    setIsBusy(true);
    setMessage(null);
    const result = await addSourceAction(input);
    setIsBusy(false);
    if (!result.ok) {
      setMessage({ text: result.message, isError: true });
      return;
    }
    setInput("");
    setMessage({ text: describeAddResult(result.data), isError: false });
    router.refresh();
  };

  return (
    <section aria-labelledby="add-source-title" className="space-y-3 rounded-2xl border bg-surface p-4 sm:p-5" data-testid="add-source">
      <div>
        <h2 id="add-source-title" className="font-semibold">
          {t.addTitle}
        </h2>
        <p className="mt-1 text-sm text-text-secondary">{t.addHint}</p>
      </div>
      {unavailableReason ? (
        <p className="text-sm text-text-secondary" data-testid="add-source-unavailable">
          {unavailableReason}
        </p>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="source-input" className="sr-only">
            {t.addLabel}
          </label>
          <Textarea
            id="source-input"
            rows={1}
            dir="ltr"
            value={input}
            placeholder={t.addPlaceholder}
            aria-invalid={message?.isError || undefined}
            aria-describedby={message ? "add-source-message" : undefined}
            className="min-h-11 flex-1 resize-y py-2.5"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              // Enter adds. Shift and Enter starts a new line, for pasting several videos.
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            data-testid="source-input"
          />
          <Button type="submit" className="min-h-11 sm:w-32" disabled={isBusy || !input.trim()} data-testid="source-submit">
            {isBusy ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" data-icon="inline-start" /> : <Plus aria-hidden data-icon="inline-start" />}
            {isBusy ? t.adding : t.addAction}
          </Button>
        </form>
      )}
      {message ? (
        <p id="add-source-message" role={message.isError ? "alert" : "status"} className={message.isError ? "text-sm text-destructive" : "text-sm text-text-secondary"} data-testid="add-source-message">
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
