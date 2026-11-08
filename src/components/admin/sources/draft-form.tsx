"use client";

import { BookmarkPlus, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { createSourceDraftAction } from "@/app/(admin)/admin/sources/drafts/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { strings } from "@/config/strings.ar";
import { cn } from "@/lib/utils";

const d = strings.sourceDrafts;

/** Saving only parses the link on the server, so it works even with the day's quota spent. */
export function DraftForm() {
  const router = useRouter();
  const ids = { link: useId(), label: useId(), note: useId(), auto: useId() };
  const [input, setInput] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [autoAdd, setAutoAdd] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const submit = async () => {
    if (!input.trim() || isBusy) return;
    setIsBusy(true);
    setMessage(null);
    const result = await createSourceDraftAction({ input, autoAdd, ...(label.trim() ? { label } : {}), ...(note.trim() ? { note } : {}) });
    setIsBusy(false);
    if (!result.ok) {
      setMessage({ text: result.message, isError: true });
      return;
    }
    setInput("");
    setLabel("");
    setNote("");
    setMessage({ text: d.saved, isError: false });
    router.refresh();
  };

  return (
    <section aria-labelledby="draft-form-title" className="relative overflow-hidden rounded-3xl border bg-surface p-5 sm:p-6" data-testid="draft-form">
      <span aria-hidden className="pointer-events-none absolute -top-24 -end-24 size-64 rounded-full bg-brand/10 blur-3xl" />
      <form
        noValidate
        className="relative space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex size-10 items-center justify-center rounded-2xl bg-brand/15 text-brand">
            <BookmarkPlus className="size-5" />
          </span>
          <div>
            <h2 id="draft-form-title" className="font-semibold">
              {d.formTitle}
            </h2>
            <p className="text-xs text-text-secondary">{d.costHint}</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={ids.link} className="text-sm font-medium">
            {d.linkLabel}
          </label>
          <Textarea id={ids.link} dir="ltr" rows={2} value={input} onChange={(event) => setInput(event.target.value)} placeholder="https://www.youtube.com/@channel" aria-describedby={`${ids.link}-hint`} className="min-h-14 resize-y" data-testid="draft-input" />
          <p id={`${ids.link}-hint`} className="text-xs text-text-secondary">
            {d.linkHint}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor={ids.label} className="text-sm font-medium">
              {d.labelLabel}
            </label>
            <Input id={ids.label} value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} placeholder={d.labelPlaceholder} data-testid="draft-label" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={ids.note} className="text-sm font-medium">
              {d.noteLabel}
            </label>
            <Input id={ids.note} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder={d.notePlaceholder} data-testid="draft-note" />
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <button
              id={ids.auto}
              type="button"
              role="switch"
              aria-checked={autoAdd}
              aria-describedby={`${ids.auto}-hint`}
              onClick={() => setAutoAdd((value) => !value)}
              className={cn("relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50", autoAdd ? "bg-brand" : "bg-surface-elevated")}
              data-testid="draft-auto"
            >
              <span className={cn("absolute size-5 rounded-full bg-white shadow transition-[inset-inline-start]", autoAdd ? "start-[1.125rem]" : "start-0.5")} />
            </button>
            <label htmlFor={ids.auto} className="cursor-pointer text-sm">
              <span className="font-medium">{d.autoLabel}</span>
              <span id={`${ids.auto}-hint`} className="block text-xs text-text-secondary">
                {d.autoHint}
              </span>
            </label>
          </div>
          <Button type="submit" className="min-h-11 rounded-full px-6" disabled={isBusy || !input.trim()} data-testid="draft-save">
            {isBusy ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" data-icon="inline-start" /> : <BookmarkPlus aria-hidden data-icon="inline-start" />}
            {isBusy ? d.saving : d.save}
          </Button>
        </div>

        {message ? (
          <p role={message.isError ? "alert" : "status"} className={message.isError ? "text-sm text-destructive" : "text-sm text-text-secondary"} data-testid="draft-message">
            {message.text}
          </p>
        ) : null}
      </form>
    </section>
  );
}
