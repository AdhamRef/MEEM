/* eslint-disable @next/next/no-img-element -- Channel images load directly from YouTube by design, and aren't re-processed or re-hosted. */
import { ExternalLink, Tv } from "lucide-react";
import type { ReactNode } from "react";
import { strings } from "@/config/strings.ar";
import { cn } from "@/lib/utils";

export interface JobChannel {
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
  youtubeChannelId: string;
}

export const youtubeChannelUrl = (channelId: string) => `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`;

export function ChannelAvatar({ url, className }: { url: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" loading="lazy" decoding="async" referrerPolicy="strict-origin-when-cross-origin" className={cn("shrink-0 rounded-full bg-surface-elevated object-cover", className)} />
  ) : (
    <span aria-hidden className={cn("flex shrink-0 items-center justify-center rounded-full bg-surface-elevated text-text-secondary", className)}>
      <Tv className="size-1/2" strokeWidth={1.5} />
    </span>
  );
}

/** Beside the title and never inside a larger link, so it can be used on its own. */
export function ChannelLink({ channelId, label = strings.importer.openChannel }: { channelId: string; label?: string }) {
  return (
    <a href={youtubeChannelUrl(channelId)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 rounded text-xs text-brand underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50" data-testid="channel-link">
      {label}
      <ExternalLink aria-hidden className="size-3" />
    </a>
  );
}

export function StatTile({ label, value, hint, testId, tone }: { label: string; value: ReactNode; hint?: string; testId?: string; tone?: "alert" }) {
  return (
    <div className="min-w-0 rounded-xl border bg-surface p-3">
      <dt className="truncate text-xs text-text-secondary">{label}</dt>
      <dd className={cn("mt-1 truncate text-xl font-semibold tabular-nums", tone === "alert" && "text-destructive")} data-testid={testId}>
        {value}
      </dd>
      {hint ? <dd className="mt-0.5 text-xs text-text-secondary">{hint}</dd> : null}
    </div>
  );
}

/** Pulses, rather than filling up, while the total isn't known. It only appears during real work. */
export function WorkingBar() {
  return (
    <div aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-surface-elevated" data-testid="working-bar">
      <div className="h-full w-full animate-pulse rounded-full bg-brand motion-reduce:animate-none" />
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 w-full overflow-hidden rounded-full bg-surface-elevated" data-testid="import-progress">
      <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  );
}
