"use client";

/* eslint-disable @next/next/no-img-element -- Thumbnails load directly from YouTube by design, and aren't re-processed or re-hosted. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ContentPicker } from "@/components/admin/content/content-picker";
import { selectClass, StatusBadge } from "@/components/admin/content/list-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { strings } from "@/config/strings.ar";
import type { PickerItem } from "@/features/relationships/picker.service";
import type { ActionResult } from "@/lib/http/action";

const v = strings.videosAdmin;

export interface BulkRow {
  id: string;
  title: string;
  hint?: string;
  href: string;
  thumbnailUrl?: string | null;
  status: "DRAFT" | "PUBLISHED";
  isArchived: boolean;
  badges?: { label: string; isWarning?: boolean }[];
}

interface BulkListProps {
  rows: BulkRow[];
  /** How many items match the filter, across every page. */
  total: number;
  onListIds: (cursor?: string) => Promise<ActionResult<{ ids: string[]; nextCursor: string | null }>>;
  canEdit: boolean;
  canPublish?: boolean;
  /** Offered only for videos, since an article's kind doesn't change. */
  showKind?: boolean;
  onAssign: (input: { ids: string[]; kind?: string; addTopicIds?: string[] }) => Promise<ActionResult<{ changed: number }>>;
  onPublish?: (input: { ids: string[]; isPublished: boolean }) => Promise<ActionResult<{ changed: number; skipped: number }>>;
  emptyMessage: ReactNode;
}

/** A bulk action accepts this many at a time on the server, so larger selections go in batches. */
const BATCH_SIZE = 100;
/** Above this, a slip of the hand would affect more than can be easily put right, so it asks first. */
const CONFIRM_ABOVE = 100;

type Pending = { description: string; run: (ids: string[]) => Promise<void> };

/**
 * "All" means everything the current filter matches, across every page, not only what's visible.
 * It's kept as "all, except these", so it needs no list of IDs until something is actually applied.
 */
export function BulkList({ rows, total, onListIds, canEdit, canPublish, showKind, onAssign, onPublish, emptyMessage }: BulkListProps) {
  const router = useRouter();
  const [isAll, setIsAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState("");
  const [topics, setTopics] = useState<PickerItem[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const headerCheck = useRef<HTMLInputElement>(null);

  const count = isAll ? Math.max(0, total - excluded.size) : selected.size;
  const isEverythingSelected = total > 0 && count === total;
  const hasAssignment = showKind ? Boolean(kind) : topics.length > 0;

  useEffect(() => {
    if (headerCheck.current) headerCheck.current.indeterminate = count > 0 && !isEverythingSelected;
  }, [count, isEverythingSelected]);

  const isChecked = (id: string) => (isAll ? !excluded.has(id) : selected.has(id));

  const toggle = (id: string) => {
    const update = (current: Set<string>) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    };
    if (isAll) setExcluded(update);
    else setSelected(update);
  };

  const clear = () => {
    setIsAll(false);
    setSelected(new Set());
    setExcluded(new Set());
  };

  const toggleEverything = () => {
    if (isEverythingSelected) {
      clear();
      return;
    }
    setSelected(new Set());
    setExcluded(new Set());
    setIsAll(true);
  };

  /** The IDs are taken once, so items changing as they're processed can't move in or out of the selection. */
  const resolveIds = async (): Promise<string[] | null> => {
    if (!isAll) return [...selected];
    setProgress(v.gathering);
    const ids: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const result = await onListIds(cursor);
      if (!result.ok) {
        setMessage({ text: result.message, isError: true });
        return null;
      }
      ids.push(...result.data.ids);
      if (!result.data.nextCursor) break;
      cursor = result.data.nextCursor;
    }
    return ids.filter((id) => !excluded.has(id));
  };

  const inBatches = async <Data,>(ids: string[], work: (batch: string[]) => Promise<ActionResult<Data>>, onBatch: (data: Data) => void): Promise<boolean> => {
    for (let start = 0; start < ids.length; start += BATCH_SIZE) {
      setProgress(v.progress(start, ids.length));
      const batch = ids.slice(start, start + BATCH_SIZE);
      // Repeating is safe, since applying a batch twice changes nothing more. A brief network
      // or database hiccup shouldn't stop a long run.
      let result = await work(batch);
      if (!result.ok) result = await work(batch);
      if (!result.ok) {
        setMessage({ text: v.stoppedPartway(start, ids.length, result.message), isError: true });
        return false;
      }
      onBatch(result.data);
    }
    return true;
  };

  const perform = async (run: (ids: string[]) => Promise<void>) => {
    setPending(null);
    setIsBusy(true);
    setMessage(null);
    const ids = await resolveIds();
    if (ids) await run(ids);
    setProgress(null);
    setIsBusy(false);
  };

  const askFirst = (description: string, run: (ids: string[]) => Promise<void>) => {
    if (count > CONFIRM_ABOVE) setPending({ description, run });
    else void perform(run);
  };

  const assign = () =>
    askFirst(v.confirmAssign, async (ids) => {
      let changed = 0;
      // Videos take their topics from their channel, so only articles are given topics here.
      const isComplete = await inBatches(ids, (batch) => onAssign(showKind ? { ids: batch, kind } : { ids: batch, addTopicIds: topics.map((item) => item.id) }), (data) => (changed += data.changed));
      if (changed > 0) router.refresh();
      if (!isComplete) return;
      setMessage({ text: v.changed(changed), isError: false });
      setKind("");
      setTopics([]);
      clear();
    });

  const publish = (isPublished: boolean) =>
    askFirst(isPublished ? v.confirmPublish : v.confirmUnpublish, async (ids) => {
      if (!onPublish) return;
      let changed = 0;
      let skipped = 0;
      const isComplete = await inBatches(ids, (batch) => onPublish({ ids: batch, isPublished }), (data) => {
        changed += data.changed;
        skipped += data.skipped;
      });
      if (changed > 0) router.refresh();
      if (!isComplete) return;
      setMessage({ text: v.published(changed, skipped), isError: false });
      clear();
    });

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border bg-surface p-8 text-center text-text-secondary" data-testid="admin-list-empty">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {canEdit || canPublish ? (
        <section aria-label={v.bulkLabel} className="space-y-3 rounded-xl border bg-surface p-3" data-testid="bulk-panel">
          <div className="flex flex-wrap items-center gap-x-3">
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input ref={headerCheck} type="checkbox" className="size-5" checked={isEverythingSelected} disabled={isBusy} onChange={toggleEverything} data-testid="bulk-all" />
              {v.selectAll} ({total})
            </label>
            <span className="text-sm text-text-secondary" data-testid="bulk-count">({count})</span>
            {count > 0 ? (
              <Button type="button" variant="ghost" disabled={isBusy} onClick={clear} data-testid="bulk-clear">
                {v.clearSelection}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-text-secondary">{v.selectAllHint}</p>

          {count > 0 && canEdit ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {showKind ? (
                <label className="space-y-1.5 text-sm font-medium">
                  {v.kind}
                  <select value={kind} onChange={(event) => setKind(event.target.value)} className={selectClass} data-testid="bulk-kind">
                    <option value="">{v.noChange}</option>
                    <option value="SHORT">{strings.content.short}</option>
                    <option value="LONG_FORM">{strings.content.longVideo}</option>
                  </select>
                </label>
              ) : null}
              {showKind ? null : (
                <div className="sm:col-span-2">
                  <ContentPicker label={v.addTopics} type="TOPIC" value={topics} onChange={setTopics} max={10} />
                </div>
              )}
            </div>
          ) : null}

          {count > 0 ? (
            <div className="flex flex-wrap gap-2">
              {canEdit ? (
                <Button type="button" disabled={isBusy || !hasAssignment} onClick={assign} data-testid="bulk-apply">
                  {v.apply}
                </Button>
              ) : null}
              {canPublish && onPublish ? (
                <>
                  <Button type="button" variant="secondary" disabled={isBusy} onClick={() => publish(true)} data-testid="bulk-publish">
                    {strings.adminContent.publish}
                  </Button>
                  <Button type="button" variant="ghost" disabled={isBusy} onClick={() => publish(false)} data-testid="bulk-unpublish">
                    {strings.adminContent.unpublish}
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}

          {progress ? (
            <p role="status" className="text-sm" data-testid="bulk-progress">
              {progress}
            </p>
          ) : null}
          {message ? (
            <p role={message.isError ? "alert" : "status"} className={message.isError ? "text-sm text-destructive" : "text-sm text-text-secondary"} data-testid="bulk-message">
              {message.text}
            </p>
          ) : null}
        </section>
      ) : null}

      <ul className="divide-y rounded-xl border bg-surface" data-testid="admin-list">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2 ps-2" data-testid="bulk-row">
            {canEdit || canPublish ? (
              <label className="flex size-11 shrink-0 items-center justify-center">
                <span className="sr-only">
                  {v.select}: {row.title}
                </span>
                <input type="checkbox" className="size-5" checked={isChecked(row.id)} disabled={isBusy} onChange={() => toggle(row.id)} data-testid="bulk-check" />
              </label>
            ) : null}
            <Link href={row.href} className="flex min-h-14 min-w-0 flex-1 flex-wrap items-center gap-3 py-2 pe-4 outline-none hover:bg-surface-elevated focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset">
              {row.thumbnailUrl ? <img src={row.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="strict-origin-when-cross-origin" className="aspect-video w-20 shrink-0 rounded-md object-cover" /> : null}
              <span className="min-w-0 flex-1">
                <bdi className="block truncate text-sm font-medium">{row.title}</bdi>
                {row.hint ? <bdi className="block truncate text-xs text-text-secondary">{row.hint}</bdi> : null}
              </span>
              <span className="flex flex-wrap items-center gap-1">
                {row.badges?.map((badge) => (
                  <Badge key={badge.label} variant={badge.isWarning ? "destructive" : "outline"}>
                    {badge.label}
                  </Badge>
                ))}
                <StatusBadge status={row.status} isArchived={row.isArchived} />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <Dialog open={pending !== null} onOpenChange={(isOpen) => !isOpen && setPending(null)}>
        <DialogContent data-testid="bulk-confirm-dialog">
          <DialogTitle className="text-lg font-semibold">{v.confirmTitle(count)}</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-text-secondary">{pending?.description}</DialogDescription>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" onClick={() => pending && void perform(pending.run)} data-testid="bulk-confirm">
              {v.confirmAction}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {v.confirmCancel}
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
