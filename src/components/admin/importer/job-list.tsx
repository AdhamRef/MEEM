"use client";

import { LoaderCircle, Pause, Play, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteImportJobAction, pauseImportJobAction, resumeImportJobAction, runDiscoveryStepAction, runImportStepAction } from "@/app/(admin)/admin/youtube-importer/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { strings } from "@/config/strings.ar";
import { canRunUnattended, describeActivity, nextJobToRun, secondsSince, STALE_AFTER_MS, withJobLock, type JobActivity, type JobStatus } from "@/features/youtube/import/job-activity";
import { formatDate } from "@/lib/utils/format";
import { ChannelAvatar, ChannelLink, WorkingBar } from "./job-visuals";

const t = strings.importer;

export interface JobRow {
  id: string;
  channelId: string;
  channelTitle: string;
  channelHandle: string | null;
  channelImage: string | null;
  youtubeChannelId: string;
  shortCount: number;
  longCount: number;
  failedCount: number;
  type: "IMPORT" | "SYNC";
  status: JobStatus;
  discoveredCount: number;
  importedCount: number;
  createdAt: string;
  updatedAt: string;
}

const REFRESH_MS = 10_000;

function ActivityBadge({ activity, status }: { activity: JobActivity; status: JobStatus }) {
  if (activity === "RUNNING_HERE" || activity === "RUNNING_ELSEWHERE") {
    return (
      <Badge data-activity={activity}>
        <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
        {activity === "RUNNING_HERE" ? t.activity.running : t.activity.runningElsewhere}
      </Badge>
    );
  }
  if (activity === "WAITING") return <Badge variant="secondary" data-activity={activity}>{t.activity.waiting}</Badge>;
  if (activity === "WAITING_FOR_SAME_CHANNEL") return <Badge variant="secondary" data-activity={activity}>{t.activity.waitingForChannel}</Badge>;
  if (activity === "HALTED") return <Badge variant="outline" data-activity={activity}>{t.activity.halted}</Badge>;
  if (activity === "FAILED") return <Badge variant="destructive" data-activity={activity}>{t.activity.failed}</Badge>;
  return (
    <Badge variant={status === "PAUSED" ? "destructive" : "secondary"} data-activity={activity} data-status={status}>
      {t.status[status]}
    </Badge>
  );
}

/**
 * There's no background worker, so unfinished jobs run in whichever page is open. This page
 * runs them one after another and shows what's really happening. "Running" appears only when
 * a step is actually in progress or the server has just saved progress, so a label can't
 * outlive the work it describes.
 */
export function JobList({ jobs: serverJobs }: { jobs: JobRow[] }) {
  const router = useRouter();
  const [live, setLive] = useState<Record<string, Partial<JobRow>>>({});
  const [runningId, setRunningId] = useState<string | null>(null);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [lastProgressAt, setLastProgressAt] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<{ job: JobRow } | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Whichever is newer wins, since another tab or person may have moved a job along since.
  const jobs = useMemo(
    () =>
      serverJobs
        .filter((job) => !deletedIds.has(job.id))
        .map((job) => {
          const update = live[job.id];
          return update?.updatedAt && update.updatedAt >= job.updatedAt ? { ...job, ...update } : job;
        }),
    [serverJobs, live, deletedIds],
  );
  const jobsRef = useRef(jobs);
  const isPausedRef = useRef(isPaused);
  const failedRef = useRef(new Set<string>());
  // Set when the page goes away. A ref, because React's development mode runs effects twice.
  const hasLeftRef = useRef(false);
  useEffect(() => {
    jobsRef.current = jobs;
    isPausedRef.current = isPaused;
  });

  const failedIds = useMemo(() => new Set(Object.keys(failures)), [failures]);
  const hasUnfinished = jobs.some((job) => canRunUnattended(job.status));

  const runStepsFor = useCallback(async (job: { id: string; status: JobStatus }): Promise<void> => {
    const action = job.status === "IMPORTING" ? runImportStepAction : runDiscoveryStepAction;
    for (;;) {
      if (isPausedRef.current || hasLeftRef.current) return;
      const result = await action(job.id);
      if (!result.ok) {
        failedRef.current.add(job.id);
        setFailures((current) => ({ ...current, [job.id]: result.message }));
        return;
      }
      const stamp = Date.now();
      setLastProgressAt(stamp);
      setLive((current) => ({
        ...current,
        [job.id]: { status: result.data.status, discoveredCount: result.data.discoveredCount, importedCount: result.data.importedCount, updatedAt: new Date(stamp).toISOString() },
      }));
      if (result.data.status === "PAUSED" && result.data.message) {
        failedRef.current.add(job.id);
        setFailures((current) => ({ ...current, [job.id]: result.data.message as string }));
        return;
      }
      if (!canRunUnattended(result.data.status)) return;
    }
  }, []);

  /** Works through unfinished jobs until there are none left, or the page closes. */
  const run = useCallback(async () => {
    const heldElsewhere = new Set<string>();
    for (;;) {
      if (hasLeftRef.current || isPausedRef.current) return;
      const job = nextJobToRun(jobsRef.current, new Set([...failedRef.current, ...heldElsewhere]));
      if (!job) return;

      setRunningId(job.id);
      setLastProgressAt(Date.now());
      const gotLock = await withJobLock(job.id, () => runStepsFor(job));
      setRunningId(null);
      if (!gotLock) heldElsewhere.add(job.id);
      // The state update that moves this job on must land before choosing the next one.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }, [runStepsFor]);

  const isRunningRef = useRef(false);
  const start = useCallback(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    void run().finally(() => {
      isRunningRef.current = false;
      if (!hasLeftRef.current) router.refresh();
    });
  }, [run, router]);

  const [runToken, setRunToken] = useState(0);
  useEffect(() => {
    hasLeftRef.current = false;
    if (!isPaused) start();
    return () => {
      hasLeftRef.current = true;
    };
  }, [isPaused, start, runToken]);

  // Keeps "last progress" honest, and picks up work done in another tab or by someone else.
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const refresh = hasUnfinished
      ? setInterval(() => {
          router.refresh();
          // A job another tab was holding may be free now.
          if (!isPausedRef.current) start();
        }, REFRESH_MS)
      : null;
    return () => {
      clearInterval(clock);
      if (refresh) clearInterval(refresh);
    };
  }, [hasUnfinished, router, start]);

  const clearFailure = (id: string) => {
    failedRef.current.delete(id);
    setFailures((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
  };

  /** A paused or cancelled job only goes back to work when someone asks, and this is them asking. */
  const resume = async (id: string) => {
    clearFailure(id);
    const job = jobsRef.current.find((candidate) => candidate.id === id);
    if (job?.status === "PAUSED" || job?.status === "CANCELLED") {
      const result = await resumeImportJobAction(id);
      if (!result.ok) {
        setFailures((current) => ({ ...current, [id]: result.message }));
        return;
      }
      setLive((current) => ({ ...current, [id]: { ...current[id], status: result.data.status, updatedAt: new Date().toISOString() } }));
    }
    setIsPaused(false);
    setRunToken((token) => token + 1);
  };

  /** Keeps the job's place, so it needs no confirmation. */
  const pause = async (id: string) => {
    const result = await pauseImportJobAction(id);
    if (!result.ok) {
      setFailures((current) => ({ ...current, [id]: result.message }));
      return;
    }
    const job = jobsRef.current.find((candidate) => candidate.id === id);
    setLive((current) => ({ ...current, [id]: { ...current[id], status: job?.status === "IMPORTING" ? "READY_FOR_REVIEW" : "PAUSED", updatedAt: new Date().toISOString() } }));
    router.refresh();
  };

  /** Asks first, because this can't be undone. */
  const confirmAction = async () => {
    if (!pending) return;
    const { job } = pending;
    setIsActing(true);
    setActionError(null);
    // This page must not start on it again, whatever a step under way reports.
    failedRef.current.add(job.id);
    const result = await deleteImportJobAction(job.id);
    setIsActing(false);
    if (!result.ok) {
      failedRef.current.delete(job.id);
      setActionError(result.message);
      return;
    }
    setPending(null);
    setDeletedIds((current) => new Set([...current, job.id]));
    setFailures((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== job.id)));
    router.refresh();
  };

  const running = jobs.find((job) => job.id === runningId);
  const quietFor = lastProgressAt === null ? 0 : secondsSince(lastProgressAt, now);
  const isSlow = running && quietFor * 1000 > STALE_AFTER_MS;

  return (
    <div className="space-y-2">
      {hasUnfinished ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-surface p-3 text-sm" role="status" data-testid="importer-activity">
          <p className="min-w-0 flex-1">
            {running ? (
              <>
                <span className="font-medium">
                  {t.activity.workingOn} <bdi>{running.channelTitle}</bdi>
                </span>
                <span className={isSlow ? "block text-destructive" : "block text-text-secondary"} data-testid="importer-last-progress">
                  {isSlow ? t.activity.slow(quietFor) : t.activity.lastProgress(quietFor)}
                </span>
              </>
            ) : isPaused ? (
              t.activity.pausedByYou
            ) : (
              t.activity.idle
            )}
            <span className="block text-xs text-text-secondary">{t.activity.keepOpen}</span>
          </p>
          <Button type="button" variant="secondary" onClick={() => setIsPaused((current) => !current)} data-testid="importer-pause">
            {isPaused ? <Play aria-hidden data-icon="inline-start" /> : <Pause aria-hidden data-icon="inline-start" />}
            {isPaused ? t.activity.resumeAll : t.activity.pauseAll}
          </Button>
        </div>
      ) : null}

      <ul className="grid gap-3 md:grid-cols-2" data-testid="job-list">
        {jobs.map((job) => {
          const activity = describeActivity(job, jobs, { runningId, failedIds, isPaused, now });
          const stats = [
            { label: t.discovered, value: job.discoveredCount, testId: "job-discovered" },
            { label: t.summary.shorts, value: job.shortCount },
            { label: t.summary.longs, value: job.longCount },
            { label: t.imported, value: job.importedCount },
          ];
          return (
            <li key={job.id} className={`flex flex-col gap-3 rounded-2xl border bg-surface p-4 transition-colors ${activity === "RUNNING_HERE" ? "border-brand" : ""}`} data-testid="job-row" data-job-status={job.status}>
              <div className="flex items-start gap-3">
                <ChannelAvatar url={job.channelImage} className="size-12" />
                <div className="min-w-0 flex-1">
                  <Link href={`/admin/youtube-importer/${job.id}`} className="block truncate rounded font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
                    <bdi>{job.channelTitle || t.channelWithdrawn}</bdi>
                  </Link>
                  <p className="truncate text-xs text-text-secondary">
                    {job.channelHandle ? (
                      <>
                        <bdi dir="ltr">{job.channelHandle}</bdi> ·{" "}
                      </>
                    ) : null}
                    {job.type === "SYNC" ? t.typeSync : t.typeImport} · {formatDate(new Date(job.createdAt))}
                  </p>
                  <ChannelLink channelId={job.youtubeChannelId} />
                </div>
                <ActivityBadge activity={activity} status={job.status} />
              </div>

              {activity === "RUNNING_HERE" ? <WorkingBar /> : null}

              <dl className="grid grid-cols-4 gap-2 rounded-xl bg-surface-elevated p-2 text-center">
                {stats.map((stat) => (
                  <div key={stat.label} className="min-w-0">
                    <dd className="text-base font-semibold tabular-nums" data-testid={stat.testId}>
                      {stat.value}
                    </dd>
                    <dt className="truncate text-xs text-text-secondary">{stat.label}</dt>
                  </div>
                ))}
              </dl>

              {failures[job.id] ? (
                <p role="alert" className="text-xs text-destructive" data-testid="job-failure">
                  {failures[job.id]}
                </p>
              ) : null}

              <div className="mt-auto flex flex-wrap items-center gap-2">
                <Button asChild variant={job.status === "READY_FOR_REVIEW" ? "default" : "secondary"}>
                  <Link href={`/admin/youtube-importer/${job.id}`} data-testid="job-open">
                    {job.status === "READY_FOR_REVIEW" ? t.reviewJob : t.openJob}
                  </Link>
                </Button>
                {activity === "FAILED" || (activity === "SETTLED" && (job.status === "PAUSED" || job.status === "CANCELLED")) ? (
                  <Button type="button" onClick={() => void resume(job.id)} aria-label={t.resumeNamed(job.channelTitle)} data-testid="job-retry">
                    <Play aria-hidden data-icon="inline-start" />
                    {t.resume}
                  </Button>
                ) : null}
                <span className="ms-auto flex items-center gap-1">
                  {canRunUnattended(job.status) ? (
                    <Button type="button" variant="ghost" size="icon" aria-label={t.pauseNamed(job.channelTitle)} title={t.pauseJob} onClick={() => void pause(job.id)} data-testid="job-pause">
                      <Pause aria-hidden />
                    </Button>
                  ) : null}
                  <Button type="button" variant="ghost" size="icon" aria-label={t.deleteNamed(job.channelTitle)} title={t.deleteJob} onClick={() => setPending({ job })} data-testid="job-delete">
                    <Trash2 aria-hidden />
                  </Button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={pending !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setPending(null);
            setActionError(null);
          }
        }}
      >
        <DialogContent data-testid="job-action-dialog">
          <DialogTitle className="text-lg font-semibold">{t.deleteTitle}</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-text-secondary">
            <bdi className="block font-medium text-text-primary">{pending?.job.channelTitle}</bdi>
            {t.deleteDescription}
          </DialogDescription>
          {actionError ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {actionError}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" variant="destructive" disabled={isActing} onClick={confirmAction} data-testid="job-action-confirm">
              {t.deleteConfirm}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={isActing}>
                {t.cancelBack}
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
