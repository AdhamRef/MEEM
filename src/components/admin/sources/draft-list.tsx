"use client";

import { AlertTriangle, CheckCircle2, Clock, Film, ListVideo, Loader2, Play, RotateCcw, Trash2, Tv, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addSourceDraftNowAction, deleteSourceDraftAction, setDraftAutoAddAction } from "@/app/(admin)/admin/sources/drafts/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { strings } from "@/config/strings.ar";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/format";

const d = strings.sourceDrafts;

export interface DraftRow {
  id: string;
  kind: "CHANNEL" | "PLAYLIST" | "VIDEOS";
  input: string;
  label: string | null;
  note: string | null;
  status: "WAITING" | "PROCESSING" | "ADDED" | "FAILED";
  autoAdd: boolean;
  attempts: number;
  resultMessage: string | null;
  resultHref: string | null;
  createdByName: string | null;
  createdAt: string;
}

const KIND_ICON = { CHANNEL: Tv, PLAYLIST: ListVideo, VIDEOS: Film } as const;
const STATUS_STYLE = {
  WAITING: { icon: Clock, className: "bg-surface-elevated text-text-secondary" },
  PROCESSING: { icon: Loader2, className: "bg-brand/15 text-brand" },
  ADDED: { icon: CheckCircle2, className: "bg-brand/15 text-brand" },
  FAILED: { icon: AlertTriangle, className: "bg-destructive/15 text-destructive" },
} as const;

function DraftCard({ draft, canAdd, unavailableReason }: { draft: DraftRow; canAdd: boolean; unavailableReason: string | null }) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const KindIcon = KIND_ICON[draft.kind];
  const status = STATUS_STYLE[draft.status];
  const StatusIcon = status.icon;
  const isOpen = draft.status === "WAITING" || draft.status === "FAILED";

  const run = async (work: () => Promise<{ ok: true; data?: unknown } | { ok: false; message: string }>, success?: (data: unknown) => string | null) => {
    setIsBusy(true);
    setMessage(null);
    const result = await work();
    setIsBusy(false);
    if (!result.ok) setMessage({ text: result.message, isError: true });
    else if (success) {
      const text = success(result.data);
      if (text) setMessage({ text, isError: false });
    }
    router.refresh();
  };

  return (
    <li className="group relative overflow-hidden rounded-2xl border bg-surface p-4 transition-colors hover:border-brand/40" data-testid="draft-card" data-status={draft.status}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-surface-elevated text-brand">
          <KindIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-text-secondary">{d.kinds[draft.kind]}</span>
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", status.className)} data-testid="draft-status">
              <StatusIcon aria-hidden className={cn("size-3.5", draft.status === "PROCESSING" && "animate-spin motion-reduce:animate-none")} />
              {d.statuses[draft.status]}
            </span>
            {draft.autoAdd && isOpen ? (
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-text-secondary">
                <Zap aria-hidden className="size-3" />
                {d.auto}
              </span>
            ) : null}
          </div>
          {draft.label ? (
            <p dir="auto" className="text-start font-semibold">
              {draft.label}
            </p>
          ) : null}
          <p dir="ltr" className="truncate text-start text-sm text-text-secondary" title={draft.input}>
            {draft.input}
          </p>
          {draft.note ? (
            <p dir="auto" className="rounded-xl bg-surface-elevated/60 px-3 py-2 text-start text-sm">
              {draft.note}
            </p>
          ) : null}
          {draft.resultMessage ? (
            <p className={cn("text-sm", draft.status === "FAILED" ? "text-destructive" : "text-text-secondary")} data-testid="draft-result">
              {draft.resultMessage}
            </p>
          ) : null}
          <p className="flex flex-wrap gap-x-3 text-xs text-text-secondary" suppressHydrationWarning>
            {draft.createdByName ? <span>{d.addedBy(draft.createdByName)}</span> : null}
            <span>{formatDate(draft.createdAt)}</span>
            {draft.attempts ? <span>{d.attempts(draft.attempts)}</span> : null}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        {isOpen ? (
          <Button
            type="button"
            className="rounded-full"
            disabled={isBusy || !canAdd}
            title={canAdd ? undefined : (unavailableReason ?? undefined)}
            onClick={() => run(() => addSourceDraftNowAction(draft.id), (data) => (data as { message: string | null }).message)}
            data-testid="draft-add-now"
          >
            {isBusy ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" data-icon="inline-start" /> : draft.status === "FAILED" ? <RotateCcw aria-hidden data-icon="inline-start" /> : <Play aria-hidden data-icon="inline-start" className="fill-current" />}
            {isBusy ? d.adding : draft.status === "FAILED" ? d.retry : d.addNow}
          </Button>
        ) : null}
        {draft.status === "ADDED" && draft.resultHref ? (
          <Button asChild variant="secondary" className="rounded-full">
            <Link href={draft.resultHref}>{d.open}</Link>
          </Button>
        ) : null}
        {isOpen ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-2 text-sm text-text-secondary">
            <button
              type="button"
              role="switch"
              aria-checked={draft.autoAdd}
              aria-label={draft.autoAdd ? d.autoOn : d.autoOff}
              disabled={isBusy}
              onClick={() => run(() => setDraftAutoAddAction(draft.id, !draft.autoAdd))}
              className={cn("relative inline-flex h-6 w-10 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60", draft.autoAdd ? "bg-brand" : "bg-surface-elevated")}
              data-testid="draft-auto-toggle"
            >
              <span className={cn("absolute size-5 rounded-full bg-white shadow transition-[inset-inline-start]", draft.autoAdd ? "start-[1.125rem]" : "start-0.5")} />
            </button>
            {d.auto}
          </label>
        ) : null}
        <Button type="button" variant="ghost" size="icon" className="ms-auto" aria-label={d.remove} title={d.remove} disabled={isBusy || draft.status === "PROCESSING"} onClick={() => setIsConfirming(true)} data-testid="draft-remove">
          <Trash2 aria-hidden />
        </Button>
      </div>

      {message ? (
        <p role={message.isError ? "alert" : "status"} className={cn("mt-2 text-sm", message.isError ? "text-destructive" : "text-text-secondary")}>
          {message.text}
        </p>
      ) : null}

      <Dialog open={isConfirming} onOpenChange={setIsConfirming}>
        <DialogContent data-testid="confirm-dialog">
          <DialogTitle className="text-lg font-semibold">{d.removeConfirmTitle}</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-text-secondary">{d.removeConfirm}</DialogDescription>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={isBusy}
              onClick={async () => {
                await run(() => deleteSourceDraftAction(draft.id));
                setIsConfirming(false);
              }}
              data-testid="confirm-yes"
            >
              {d.remove}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {strings.adminContent.cancel}
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  );
}

/** One request after another, so each sees the quota the previous one left, and it stops at the first sign of trouble. */
export function AddAllWaiting({ ids, canAdd }: { ids: string[]; canAdd: boolean }) {
  const router = useRouter();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (ids.length === 0) return null;

  const runAll = async () => {
    setError(null);
    setProgress({ done: 0, total: ids.length });
    for (const [index, id] of ids.entries()) {
      const result = await addSourceDraftNowAction(id);
      setProgress({ done: index + 1, total: ids.length });
      if (!result.ok) {
        setError(result.message);
        break;
      }
      // Quota or YouTube trouble would stop the rest the same way.
      if (result.data.status === "WAITING") {
        setError(result.data.message);
        break;
      }
    }
    setProgress(null);
    router.refresh();
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="secondary" className="rounded-full" disabled={!canAdd || progress !== null} onClick={runAll} data-testid="draft-add-all">
        {progress ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" data-icon="inline-start" /> : <Zap aria-hidden data-icon="inline-start" />}
        {progress ? d.addingAll(progress.done, progress.total) : d.addAllNow(ids.length)}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function DraftList({ drafts, canAdd, unavailableReason }: { drafts: DraftRow[]; canAdd: boolean; unavailableReason: string | null }) {
  return (
    <ul className="grid gap-3 lg:grid-cols-2" data-testid="draft-list">
      {drafts.map((draft) => (
        <DraftCard key={draft.id} draft={draft} canAdd={canAdd} unavailableReason={unavailableReason} />
      ))}
    </ul>
  );
}
