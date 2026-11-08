"use client";

import { Gauge } from "lucide-react";
import { useEffect, useState } from "react";
import { strings } from "@/config/strings.ar";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/utils/format";

const q = strings.quota;
const LOW_SHARE = 0.85;

interface QuotaMeterProps {
  used: number;
  limit: number;
  ceiling: number;
  isExhausted: boolean;
  /** ISO time of the next reset, at midnight in Los Angeles. */
  resetsAt: string;
}

function untilReset(resetsAt: string, now: number): string {
  const minutes = Math.max(0, Math.round((new Date(resetsAt).getTime() - now) / 60_000));
  if (minutes < 1) return q.resetsSoon;
  return q.resetsIn(q.hours(Math.floor(minutes / 60), minutes % 60));
}

/**
 * Used out of YouTube's daily allowance, so "0" plainly means nothing spent yet, with a mark for
 * the share the hourly check may use and a live countdown to the reset.
 */
export function QuotaMeter({ used, limit, ceiling, isExhausted, resetsAt }: QuotaMeterProps) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // The countdown only exists in the browser, so the server and first render agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- The clock starts once mounted.
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const share = Math.min(1, used / limit);
  const ceilingShare = Math.min(1, ceiling / limit);
  const isLow = !isExhausted && used >= Math.min(ceiling, limit * LOW_SHARE);
  const status = isExhausted ? q.statusOut : isLow ? q.statusLow : q.statusOk;
  const remaining = Math.max(0, limit - used);

  return (
    <section aria-label={q.title} className="space-y-3 rounded-2xl border bg-surface p-4 sm:p-5" data-testid="quota-meter">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Gauge aria-hidden className="size-4 text-brand" />
          {q.title}
        </h2>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", isExhausted ? "bg-destructive/15 text-destructive" : isLow ? "bg-brand/15 text-brand" : "bg-surface-elevated text-text-secondary")} data-testid="quota-status">
          {status}
        </span>
      </div>

      <div className="relative">
        <div role="meter" aria-label={q.meterLabel} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-valuetext={q.used(formatNumber(used), formatNumber(limit))} className="h-2.5 w-full overflow-hidden rounded-full bg-surface-elevated">
          <div className={cn("h-full rounded-full transition-[width]", isExhausted ? "bg-destructive" : "bg-brand")} style={{ inlineSize: `${share * 100}%` }} />
        </div>
        {ceilingShare < 1 ? <span aria-hidden className="absolute -top-1 h-4.5 w-0.5 rounded-full bg-text-secondary/70" style={{ insetInlineStart: `${ceilingShare * 100}%` }} /> : null}
      </div>

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
        <span className="font-medium text-text-primary" data-testid="quota-used">
          {q.used(formatNumber(used), formatNumber(limit))}
        </span>
        <span>{q.remaining(formatNumber(remaining))}</span>
        <span>{q.ceiling(formatNumber(ceiling))}</span>
        {now !== null ? <span suppressHydrationWarning>{untilReset(resetsAt, now)}</span> : null}
      </p>
    </section>
  );
}
