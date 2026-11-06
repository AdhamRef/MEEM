"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import type { RefreshReport, StatisticsBackfillReport, YouTubeStatus } from "@/features/youtube/metadata-refresh.service";

function reportMessage(report: RefreshReport): string {
  if (report.stoppedBy === "QUOTA_EXCEEDED") return strings.admin.refreshStoppedQuota;
  if (report.stoppedBy === "API_ERROR") return strings.admin.refreshStoppedError;
  return `${strings.admin.refreshDone} ${strings.admin.refreshChecked}: ${report.checked}، ${strings.admin.refreshRemoved}: ${report.removedFromYouTube}، ${strings.admin.refreshWithdrawn}: ${report.withdrawn}.`;
}

export function YouTubeRefreshPanel({ status }: { status: YouTubeStatus }) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    setIsBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/youtube/refresh", { method: "POST" });
      if (!response.ok) throw new Error("Refresh failed");
      setMessage(reportMessage((await response.json()) as RefreshReport));
      router.refresh();
    } catch {
      setMessage(strings.admin.refreshFailed);
    } finally {
      setIsBusy(false);
    }
  };

  const backfillStatistics = async () => {
    setIsBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/youtube/backfill-statistics", { method: "POST" });
      if (!response.ok) throw new Error("Backfill failed");
      const report = (await response.json()) as StatisticsBackfillReport;
      if (report.stoppedBy === "QUOTA_EXCEEDED") setMessage(strings.admin.refreshStoppedQuota);
      else if (report.stoppedBy === "API_ERROR") setMessage(strings.admin.refreshStoppedError);
      else setMessage(strings.admin.backfillStatsDone(report.updated, report.remaining));
      router.refresh();
    } catch {
      setMessage(strings.admin.refreshFailed);
    } finally {
      setIsBusy(false);
    }
  };

  const explanation = !status.isConfigured ? strings.admin.apiNotConfigured : status.quotaExhausted ? strings.admin.quotaExhausted : null;

  return (
    <section aria-labelledby="youtube-status-title" className="space-y-3 rounded-xl border bg-surface p-4" data-testid="youtube-panel">
      <div className="space-y-1">
        <h2 id="youtube-status-title" className="font-semibold">
          {strings.admin.youtubeTitle}
        </h2>
        <p className="text-sm text-text-secondary">{strings.admin.youtubeDescription}</p>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-text-secondary">{strings.admin.videosDue}</dt>
          <dd className="text-lg font-semibold tabular-nums">{status.videosDueForRefresh}</dd>
        </div>
        <div>
          <dt className="text-text-secondary">{strings.admin.quotaToday}</dt>
          <dd className="text-lg font-semibold tabular-nums">{status.quotaUnitsToday}</dd>
        </div>
      </dl>

      {explanation ? <p className="text-sm text-text-secondary">{explanation}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={refresh} disabled={isBusy || !status.isConfigured || status.quotaExhausted}>
          {isBusy ? strings.admin.refreshing : strings.admin.refreshNow}
        </Button>
        <Button variant="secondary" onClick={backfillStatistics} disabled={isBusy || !status.isConfigured || status.quotaExhausted} data-testid="backfill-statistics">
          {strings.admin.backfillStats}
        </Button>
      </div>
      <p className="text-xs text-text-secondary">{strings.admin.backfillStatsHint}</p>

      <p role="status" className="min-h-5 text-sm text-text-secondary">
        {message}
      </p>
    </section>
  );
}
