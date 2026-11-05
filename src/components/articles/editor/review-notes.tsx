"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { strings } from "@/config/strings.ar";
import type { ActionResult } from "@/lib/http/action";
import { formatDate } from "@/lib/utils/format";

const e = strings.editor;

export interface ReviewNoteView {
  id: string;
  body: string;
  isResolved: boolean;
  createdAt: Date;
  authorName: string | null;
}

interface ReviewNotesProps {
  notes: ReviewNoteView[];
  canAdd: boolean;
  onAdd: (body: string) => Promise<ActionResult<undefined>>;
  onResolve: (noteId: string, isResolved: boolean) => Promise<ActionResult<undefined>>;
}

/** Feedback for the team. It has no effect on publishing (§19.4). */
export function ReviewNotes({ notes, canAdd, onAdd, onResolve }: ReviewNotesProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<ActionResult<undefined>>, onSuccess?: () => void) => {
    setIsBusy(true);
    setError(null);
    const result = await work();
    setIsBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSuccess?.();
    router.refresh();
  };

  return (
    <section aria-labelledby="review-notes" className="space-y-3 rounded-xl border bg-surface p-4" data-testid="review-notes">
      <div>
        <h2 id="review-notes" className="font-semibold">
          {e.notesTitle}
        </h2>
        <p className="text-xs text-text-secondary">{e.notesHint}</p>
      </div>

      {notes.length === 0 ? <p className="text-sm text-text-secondary">{e.notesEmpty}</p> : null}
      {notes.length ? (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="space-y-2 rounded-lg border p-3" data-testid="review-note">
              <p dir="auto" className="text-start text-sm whitespace-pre-line">
                {note.body}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                {note.authorName ? <bdi>{note.authorName}</bdi> : null}
                <time dateTime={new Date(note.createdAt).toISOString()}>{formatDate(note.createdAt)}</time>
                {note.isResolved ? <Badge variant="secondary">{e.noteResolved}</Badge> : null}
                <Button type="button" variant="ghost" disabled={isBusy} onClick={() => run(() => onResolve(note.id, !note.isResolved))} data-testid="note-toggle">
                  {note.isResolved ? e.noteReopen : e.noteResolve}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {canAdd ? (
        <div className="space-y-2">
          <Textarea value={body} onChange={(event) => setBody(event.target.value)} dir="auto" rows={3} maxLength={4000} placeholder={e.notePlaceholder} aria-label={e.notePlaceholder} data-testid="note-input" />
          <Button type="button" variant="secondary" disabled={isBusy || !body.trim()} onClick={() => run(() => onAdd(body), () => setBody(""))} data-testid="note-add">
            {e.noteAdd}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
