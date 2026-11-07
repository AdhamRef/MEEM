"use client";

/* eslint-disable @next/next/no-img-element -- Thumbnails load directly from YouTube by design, and aren't re-processed or re-hosted. */
import { useRouter } from "next/navigation";
import { Ban, ExternalLink, LoaderCircle, Pause, Play, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { assignSelectedCandidatesAction, cancelImportJobAction, deleteImportJobAction, getJobSummaryAction, pauseImportJobAction, resumeImportJobAction, listCandidatesAction, runDiscoveryStepAction, runImportStepAction, setCandidatesSelectedAction } from "@/app/(admin)/admin/youtube-importer/actions";
import { ContentPicker } from "@/components/admin/content/content-picker";
import { selectClass } from "@/components/admin/content/list-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { strings } from "@/config/strings.ar";
import { formatDuration } from "@/features/playlists/rules";
import type { PickerItem } from "@/features/relationships/picker.service";
import type { JobProgress, JobSummary } from "@/features/youtube/import/import.service";
import { formatTotalDuration, secondsSince, withJobLock } from "@/features/youtube/import/job-activity";
import { cn } from "@/lib/utils";
import { youtubeWatchUrl } from "@/lib/youtube/ids";
import { pickThumbnailUrl } from "@/lib/youtube/normalize";
import { ChannelAvatar, ChannelLink, ProgressBar, StatTile, WorkingBar, type JobChannel } from "./job-visuals";
import { formatDate } from "@/lib/utils/format";

const t = strings.importer;

type ListResult = Extract<Awaited<ReturnType<typeof listCandidatesAction>>, { ok: true }>["data"];
type Candidate = ListResult["items"][number];

type FilterKey = "all" | "short" | "long" | "imported" | "notImported" | "selected" | "unselected";
const FILTERS: Record<FilterKey, Record<string, unknown>> = {
  all: {},
  short: { classification: "SHORT_CANDIDATE" },
  long: { classification: "LONG_FORM_CANDIDATE" },
  imported: { imported: true },
  notImported: { imported: false },
  selected: { selected: true },
  unselected: { selected: false },
};

interface JobWorkspaceProps {
  jobId: string;
  jobType: "IMPORT" | "SYNC";
  channel: JobChannel;
  startedAt: string;
  initial: JobProgress;
  initialErrors: string[];
}

/**
 * The browser drives the job in small steps. Each is saved on the server, so closing this page
 * loses nothing: opening it again continues from the same place.
 */
export function JobWorkspace({ jobId, jobType, channel, startedAt, initial, initialErrors }: JobWorkspaceProps) {
  const router = useRouter();
  const [progress, setProgress] = useState<JobProgress>(initial);
  const [notice, setNotice] = useState<string | null>(initial.message ?? initialErrors.at(-1) ?? null);
  const [isCancelConfirm, setIsCancelConfirm] = useState(false);
  const stopRef = useRef(false);
  const [isWorking, setIsWorking] = useState(false);
  const [hasStepFailed, setHasStepFailed] = useState(false);
  const [lastProgressAt, setLastProgressAt] = useState(0);
  const [now, setNow] = useState(0);

  const [filter, setFilter] = useState<FilterKey>("all");
  const [list, setList] = useState<ListResult | null>(null);
  const [summary, setSummary] = useState<JobSummary | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const [kind, setKind] = useState("");
  const [libraries, setLibraries] = useState<PickerItem[]>([]);
  const [playlists, setPlaylists] = useState<PickerItem[]>([]);

  const status = progress.status;
  const isReview = status === "READY_FOR_REVIEW";
  const isFinished = status === "COMPLETED" || status === "CANCELLED";

  const load = useCallback(
    async (key: FilterKey, cursor?: string) => {
      const result = await listCandidatesAction({ jobId, filter: FILTERS[key], ...(cursor ? { cursor } : {}) });
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setList((current) => (cursor && current ? { ...result.data, items: [...current.items, ...result.data.items] } : result.data));
    },
    [jobId],
  );

  /** Runs one server step after another until it stops, is cancelled, or the page closes. */
  const drive = useCallback(
    async (step: (id: string) => Promise<{ ok: true; data: JobProgress } | { ok: false; message: string }>, keepGoing: (status: JobProgress["status"]) => boolean) => {
      stopRef.current = false;
      setHasStepFailed(false);
      setIsWorking(true);
      setLastProgressAt(Date.now());
      setNow(Date.now());
      try {
        // Another tab already working on this job shouldn't spend quota on it twice.
        await withJobLock(jobId, async () => {
          for (;;) {
            if (stopRef.current) return;
            const result = await step(jobId);
            if (!result.ok) {
              setNotice(result.message);
              setHasStepFailed(true);
              return;
            }
            setProgress(result.data);
            setLastProgressAt(Date.now());
            if (result.data.message) setNotice(result.data.message);
            if (!keepGoing(result.data.status)) return;
          }
        });
      } finally {
        setIsWorking(false);
      }
    },
    [jobId],
  );

  const isDriving = useRef(false);

  // Picks up by itself after a page reload or a returning visit.
  useEffect(() => {
    if (isDriving.current) return;
    isDriving.current = true;
    let isCurrent = true;

    void (async () => {
      if (initial.status === "DISCOVERING") await drive(runDiscoveryStepAction, (next) => next === "DISCOVERING");
      else if (initial.status === "IMPORTING") await drive(runImportStepAction, (next) => next === "IMPORTING");
      if (isCurrent) isDriving.current = false;
    })();

    return () => {
      isCurrent = false;
      stopRef.current = true;
      isDriving.current = false;
    };
  }, [drive, initial.status]);

  useEffect(() => {
    if (!isWorking) return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [isWorking]);

  // Keeps showing what's arrived while fetching, up to the first page. After that the list
  // stays where it is, so someone reading it isn't moved about.
  const previewSize = Math.min(progress.discoveredCount, 50);
  useEffect(() => {
    let isCurrent = true;
    void listCandidatesAction({ jobId, filter: FILTERS[filter] }).then((result) => {
      if (!isCurrent) return;
      if (result.ok) setList(result.data);
      else setNotice(result.message);
    });
    return () => {
      isCurrent = false;
    };
  }, [jobId, filter, status, previewSize]);

  useEffect(() => {
    let isCurrent = true;
    void getJobSummaryAction(jobId).then((result) => {
      if (isCurrent && result.ok) setSummary(result.data);
    });
    return () => {
      isCurrent = false;
    };
  }, [jobId, status, progress.discoveredCount, progress.importedCount]);

  const resume = async () => {
    setNotice(null);
    if (status === "IMPORTING") {
      await drive(runImportStepAction, (next) => next === "IMPORTING");
      return;
    }
    if (status === "PAUSED" || status === "CANCELLED") {
      const result = await resumeImportJobAction(jobId);
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setProgress(result.data);
    }
    await drive(runDiscoveryStepAction, (next) => next === "DISCOVERING");
    router.refresh();
  };

  const pause = async () => {
    stopRef.current = true;
    const result = await pauseImportJobAction(jobId);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setProgress((current) => ({ ...current, status: current.status === "IMPORTING" ? "READY_FOR_REVIEW" : "PAUSED" }));
    router.refresh();
  };

  const runBusy = async (work: () => Promise<void>) => {
    setIsBusy(true);
    setNotice(null);
    await work();
    setIsBusy(false);
  };

  const select = (input: Record<string, unknown>, isSelected: boolean) =>
    runBusy(async () => {
      const result = await setCandidatesSelectedAction({ jobId, isSelected, ...input });
      if (!result.ok) setNotice(result.message);
      await load(filter);
    });

  const applyAssignment = () =>
    runBusy(async () => {
      const result = await assignSelectedCandidatesAction({
        jobId,
        ...(kind ? { kind } : {}),
        libraryIds: libraries.map((item) => item.id),
        playlistIds: playlists.map((item) => item.id),
      });
      setNotice(result.ok ? t.assigned(result.data.changed) : result.message);
      await load(filter);
    });

  const startImport = async () => {
    setNotice(null);
    setProgress((current) => ({ ...current, status: "IMPORTING" }));
    await drive(runImportStepAction, (next) => next === "IMPORTING" || next === "READY_FOR_REVIEW");
    router.refresh();
  };

  const cancel = async () => {
    setIsCancelConfirm(false);
    stopRef.current = true;
    const result = await cancelImportJobAction(jobId);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setProgress((current) => ({ ...current, status: "CANCELLED" }));
    router.refresh();
  };

  const [isDeleteConfirm, setIsDeleteConfirm] = useState(false);
  const removeJob = async () => {
    stopRef.current = true;
    const result = await deleteImportJobAction(jobId);
    if (!result.ok) {
      setIsDeleteConfirm(false);
      setNotice(result.message);
      return;
    }
    router.push("/admin/youtube-importer");
    router.refresh();
  };

  const statusLabel = t.status[status];
  const selectedCount = list?.selected ?? summary?.selected ?? 0;
  const importDone = progress.importedCount + progress.duplicateCount + progress.failedCount;
  const importTotal = selectedCount;

  const filterCount = (key: FilterKey): number | null => {
    if (!summary) return null;
    const counts: Record<FilterKey, number> = {
      all: summary.total,
      short: summary.shorts,
      long: summary.longs,
      imported: summary.alreadyImported,
      notImported: summary.total - summary.alreadyImported,
      selected: selectedCount,
      unselected: summary.total - selectedCount,
    };
    return counts[key];
  };

  return (
    <div className="space-y-5" data-testid="import-workspace">
      <section className="space-y-4 rounded-2xl border bg-surface p-4 md:p-5" aria-live="polite">
        <div className="flex flex-wrap items-start gap-4">
          <ChannelAvatar url={channel.thumbnailUrl} className="size-16" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">
                <bdi>{channel.title || t.channelWithdrawn}</bdi>
              </h2>
              <Badge variant={status === "PAUSED" ? "destructive" : "secondary"} data-testid="job-status" data-status={status}>
                {statusLabel}
              </Badge>
            </div>
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-text-secondary">
              {channel.handle ? <bdi dir="ltr">{channel.handle}</bdi> : null}
              <span>{jobType === "SYNC" ? t.typeSync : t.typeImport}</span>
              <span>· {formatDate(new Date(startedAt))}</span>
            </p>
            <ChannelLink channelId={channel.youtubeChannelId} />
          </div>
        </div>

        {status === "DISCOVERING" || status === "IMPORTING" ? (
          <div className="space-y-2" data-testid="job-activity" data-working={isWorking}>
            <p className="flex items-center gap-2 text-sm">
              {isWorking ? (
                <>
                  <LoaderCircle aria-hidden className="size-4 animate-spin text-brand motion-reduce:animate-none" />
                  {t.activity.runningJob} · {t.activity.lastProgress(secondsSince(lastProgressAt, now))}
                </>
              ) : (
                <span className="text-text-secondary">{t.activity.stoppedHere}</span>
              )}
            </p>
            {isWorking && status === "DISCOVERING" ? <WorkingBar /> : null}
          </div>
        ) : null}
        {status === "IMPORTING" && importTotal > 0 ? <ProgressBar value={importDone} max={importTotal} label={t.importProgress(importDone, importTotal)} /> : null}

        {notice ? (
          <p role="status" className="rounded-lg bg-surface-elevated px-3 py-2 text-sm" data-testid="job-notice">
            {notice}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {status === "PAUSED" || status === "CANCELLED" || ((status === "DISCOVERING" || status === "IMPORTING") && !isWorking) || hasStepFailed ? (
            <Button type="button" onClick={resume} data-testid="job-resume">
              <Play aria-hidden data-icon="inline-start" />
              {t.resume}
            </Button>
          ) : null}
          {(status === "DISCOVERING" || status === "IMPORTING") && isWorking ? (
            <Button type="button" variant="secondary" onClick={pause} data-testid="job-pause">
              <Pause aria-hidden data-icon="inline-start" />
              {t.pauseJob}
            </Button>
          ) : null}
          {!isFinished ? (
            <Button type="button" variant="secondary" onClick={() => setIsCancelConfirm(true)} data-testid="job-cancel">
              <Ban aria-hidden data-icon="inline-start" />
              {t.cancel}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => setIsDeleteConfirm(true)} data-testid="job-delete">
            <Trash2 aria-hidden data-icon="inline-start" />
            {t.deleteJob}
          </Button>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="job-stats">
        <StatTile label={t.discovered} value={progress.discoveredCount} testId="count-discovered" />
        <StatTile label={t.summary.shorts} value={summary?.shorts ?? "–"} testId="count-shorts" />
        <StatTile label={t.summary.longs} value={summary?.longs ?? "–"} testId="count-longs" />
        <StatTile label={t.summary.totalDuration} value={summary ? formatTotalDuration(summary.totalSeconds, t.summary.hoursMinutes, t.summary.minutesOnly) : "–"} />
        <StatTile label={t.imported} value={progress.importedCount} testId="count-imported" />
        <StatTile label={t.summary.selected} value={selectedCount} testId="count-selected" />
        {summary?.oldest && summary.newest ? <StatTile label={t.summary.dateRange} value={<span className="text-sm">{formatDate(new Date(summary.oldest))}</span>} hint={`${t.summary.until} ${formatDate(new Date(summary.newest))}`} /> : null}
        {summary && summary.alreadyImported > 0 ? <StatTile label={t.summary.alreadyImported} value={summary.alreadyImported} /> : null}
        {summary && summary.notEmbeddable > 0 ? <StatTile label={t.summary.notEmbeddable} value={summary.notEmbeddable} tone="alert" /> : null}
        {progress.duplicateCount > 0 ? <StatTile label={t.duplicates} value={progress.duplicateCount} testId="count-duplicates" /> : null}
        {progress.skippedCount > 0 ? <StatTile label={t.skipped} value={progress.skippedCount} testId="count-skipped" /> : null}
        {progress.failedCount > 0 ? <StatTile label={t.failed} value={progress.failedCount} testId="count-failed" tone="alert" /> : null}
      </dl>

      <div className={isReview ? "grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]" : undefined}>
        <section className="min-w-0 space-y-4" data-testid="import-preview">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.filterLabel}>
            {(Object.keys(FILTERS) as FilterKey[]).map((key) => {
              const count = filterCount(key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                    filter === key ? "border-brand bg-surface-elevated" : "bg-surface hover:bg-surface-elevated",
                  )}
                  data-testid={`import-filter-${key}`}
                >
                  {t.filters[key]}
                  {count === null ? null : <span className="text-xs text-text-secondary tabular-nums">{count}</span>}
                </button>
              );
            })}
          </div>

          {isReview ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" disabled={isBusy} onClick={() => select({ filter: FILTERS[filter] }, true)} data-testid="select-all">
                {t.selectAll} {list ? `(${list.matching})` : ""}
              </Button>
              <Button type="button" variant="ghost" disabled={isBusy} onClick={() => select({ filter: FILTERS[filter] }, false)} data-testid="select-none">
                {t.selectNone}
              </Button>
            </div>
          ) : status === "DISCOVERING" && progress.discoveredCount > 0 ? (
            <p className="text-sm text-text-secondary" data-testid="preview-while-discovering">
              {t.previewWhileDiscovering}
            </p>
          ) : null}

          {list?.items.length === 0 && status !== "DISCOVERING" ? (
            <p className="rounded-xl border bg-surface p-6 text-center text-text-secondary" data-testid="preview-empty">
              {progress.discoveredCount === 0 ? (jobType === "SYNC" ? t.nothingNew : t.nothingFound) : t.noMatches}
            </p>
          ) : null}

          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="candidate-list">
            {list?.items.map((candidate) => (
              <CandidateCard key={candidate.id} candidate={candidate} isEditable={isReview} isBusy={isBusy} onToggle={(next) => select({ candidateIds: [candidate.id] }, next)} />
            ))}
          </ul>

          {list?.nextCursor ? (
            <div className="text-center">
              <Button type="button" variant="secondary" onClick={() => list.nextCursor && load(filter, list.nextCursor)} data-testid="load-more">
                {strings.adminContent.loadMore}
              </Button>
            </div>
          ) : null}
        </section>

        {isReview ? (
          <aside className="space-y-3 rounded-xl border bg-surface p-4 lg:sticky lg:top-4" data-testid="assignment-panel">
            <h3 className="font-semibold">
              {t.assignTitle} <span className="font-normal text-text-secondary tabular-nums">({selectedCount})</span>
            </h3>
            <label className="block space-y-1.5 text-sm font-medium">
              {t.kindLabel}
              <select value={kind} onChange={(event) => setKind(event.target.value)} className={selectClass} data-testid="assign-kind">
                <option value="">{t.kindKeep}</option>
                <option value="SHORT">{strings.content.short}</option>
                <option value="LONG_FORM">{strings.content.longVideo}</option>
              </select>
            </label>
            <ContentPicker label={strings.editor.libraries} type="LIBRARY" value={libraries} onChange={setLibraries} />
            <ContentPicker label={t.curatedPlaylists} type="PLAYLIST" value={playlists} onChange={setPlaylists} />
            <Button type="button" variant="secondary" className="w-full" disabled={isBusy || selectedCount === 0} onClick={applyAssignment} data-testid="assign-apply">
              {t.assignApply}
            </Button>
            <p className="text-xs text-text-secondary">{t.topicsFollowChannel}</p>
            <p className="text-xs text-text-secondary">{t.draftNote}</p>
          </aside>
        ) : null}
      </div>

      {isReview ? (
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur-sm">
          <Button type="button" disabled={isBusy || selectedCount === 0} onClick={startImport} data-testid="import-start">
            {t.importSelected(selectedCount)}
          </Button>
          <span className="text-xs text-text-secondary">{t.importHint}</span>
        </div>
      ) : null}

      <Dialog open={isDeleteConfirm} onOpenChange={setIsDeleteConfirm}>
        <DialogContent data-testid="delete-dialog">
          <DialogTitle className="text-lg font-semibold">{t.deleteTitle}</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-text-secondary">{t.deleteDescription}</DialogDescription>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" variant="destructive" onClick={removeJob} data-testid="delete-confirm">
              {t.deleteConfirm}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t.cancelBack}
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isCancelConfirm} onOpenChange={setIsCancelConfirm}>
        <DialogContent data-testid="cancel-dialog">
          <DialogTitle className="text-lg font-semibold">{t.cancelTitle}</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-text-secondary">{t.cancelDescription}</DialogDescription>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" variant="destructive" onClick={cancel} data-testid="cancel-confirm">
              {t.cancelConfirm}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t.cancelBack}
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CandidateCard({ candidate, isEditable, isBusy, onToggle }: { candidate: Candidate; isEditable: boolean; isBusy: boolean; onToggle: (next: boolean) => void }) {
  const thumbnail = pickThumbnailUrl(candidate.thumbnails);
  const duration = formatDuration(candidate.durationSeconds);
  const canSelect = isEditable && !candidate.alreadyImported && candidate.isEmbeddable;
  const watchUrl = youtubeWatchUrl(candidate.youtubeVideoId);

  return (
    <li className={cn("flex flex-col overflow-hidden rounded-xl border bg-surface transition-colors", candidate.isSelected && "border-brand")} data-testid="candidate" data-selected={candidate.isSelected}>
      <div className="relative">
        <a href={watchUrl} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden className="block">
          {thumbnail ? (
            <img src={thumbnail} alt="" loading="lazy" decoding="async" referrerPolicy="strict-origin-when-cross-origin" className="aspect-video w-full bg-black object-cover" />
          ) : (
            <span className="block aspect-video w-full bg-surface-elevated" />
          )}
        </a>
        {duration ? (
          <bdi dir="ltr" className="absolute end-2 bottom-2 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">
            {duration}
          </bdi>
        ) : null}
        {isEditable ? (
          <label className="absolute start-1 top-1 flex size-11 items-center justify-center rounded-lg">
            <span className="sr-only">
              {t.selectVideo}: {candidate.title}
            </span>
            <input type="checkbox" className="size-5 accent-brand" checked={candidate.isSelected} disabled={!canSelect || isBusy} onChange={(event) => onToggle(event.target.checked)} data-testid="candidate-check" />
          </label>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <a href={watchUrl} target="_blank" rel="noopener noreferrer" dir="auto" className="line-clamp-2 rounded text-start text-sm leading-snug font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
          {candidate.title}
        </a>
        {candidate.description ? (
          <p dir="auto" className="line-clamp-2 text-start text-xs text-text-secondary">
            {candidate.description}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary" data-testid="candidate-class">
            {candidate.classification === "SHORT_CANDIDATE" ? t.shortCandidate : t.longCandidate}
          </Badge>
          {candidate.alreadyImported ? <Badge variant="outline">{t.alreadyImported}</Badge> : null}
          {!candidate.isEmbeddable ? <Badge variant="destructive">{t.notEmbeddable}</Badge> : null}
          {candidate.result !== "PENDING" ? <Badge variant={candidate.result === "FAILED" ? "destructive" : "outline"}>{t.results[candidate.result]}</Badge> : null}
          {candidate.assignment?.kind ? <Badge variant="outline">{candidate.assignment.kind === "SHORT" ? strings.content.short : strings.content.longVideo}</Badge> : null}
        </div>
        <div className="mt-auto space-y-0.5 pt-1 text-xs text-text-secondary">
          <p>
            {candidate.channelTitle ? (
              <>
                <bdi>{candidate.channelTitle}</bdi> ·{" "}
              </>
            ) : null}
            {strings.feed.source}
            {candidate.ytPublishedAt ? ` · ${formatDate(candidate.ytPublishedAt)}` : ""}
          </p>
          <a href={watchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 text-brand underline-offset-4 hover:underline" data-testid="candidate-watch">
            {strings.feed.watchOnYouTube}
            <ExternalLink aria-hidden className="size-3" />
          </a>
        </div>
      </div>
    </li>
  );
}
