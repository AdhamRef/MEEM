/* eslint-disable @next/next/no-img-element -- Covers come from configurable storage, and thumbnails load directly from YouTube by design. */
import { Bookmark, ImageOff, LogIn } from "lucide-react";
import Link from "next/link";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { summarizeContent } from "@/features/content/describe";
import type { LibraryEntry } from "@/features/users/library.service";
import { signInHref } from "@/lib/auth/callback-url";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/format";
import { RemoveFromListButton } from "./library-actions";

const l = strings.library;

export function LibraryTabs({ active }: { active: "saved" | "history" }) {
  const tab = "inline-flex min-h-11 items-center border-b-2 px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
  return (
    <nav aria-label={l.tabsLabel} className="flex gap-2 border-b" data-testid="library-tabs">
      <Link href="/saved" aria-current={active === "saved" ? "page" : undefined} className={cn(tab, active === "saved" ? "border-brand font-medium" : "border-transparent text-text-secondary hover:text-text-primary")}>
        {l.savedTab}
      </Link>
      <Link href="/history" aria-current={active === "history" ? "page" : undefined} className={cn(tab, active === "history" ? "border-brand font-medium" : "border-transparent text-text-secondary hover:text-text-primary")}>
        {l.historyTab}
      </Link>
    </nav>
  );
}

/** A real page with a way in, rather than a redirect. Guests can browse everything without signing in. */
export function LibraryGuestState({ path }: { path: string }) {
  return (
    <StateMessage
      icon={Bookmark}
      headingLevel="h1"
      title={l.guestTitle}
      description={l.guestDescription}
      action={
        <Button asChild>
          <Link href={signInHref(path)} data-testid="library-signin">
            <LogIn aria-hidden data-icon="inline-start" className="rtl:rotate-180" />
            {l.signIn}
          </Link>
        </Button>
      }
    />
  );
}

/** One row for any kind of content, with the source credited where YouTube's content is shown. */
export function LibraryRow({ entry, list }: { entry: LibraryEntry; list: "saved" | "history" }) {
  const dateLabel = list === "saved" ? l.savedOn : l.viewedOn;

  if (!entry.content) {
    return (
      <li className="flex min-h-16 items-center gap-3 p-3 text-text-secondary" data-testid="library-row-unavailable">
        <span className="flex aspect-16/9 w-24 shrink-0 items-center justify-center rounded-lg bg-surface-elevated">
          <ImageOff aria-hidden className="size-5" strokeWidth={1.5} />
        </span>
        <span className="min-w-0 flex-1 text-sm">{l.unavailable}</span>
        <RemoveFromListButton list={list} entityType={entry.entityType} entityId={entry.entityId} title={l.unavailable} />
      </li>
    );
  }

  const summary = summarizeContent(entry.content);
  return (
    <li className="flex items-center gap-3 p-3" data-testid="library-row" data-entity-type={entry.entityType}>
      <Link href={summary.href} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        {summary.imageUrl ? (
          <img src={summary.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="strict-origin-when-cross-origin" className="aspect-16/9 w-24 shrink-0 rounded-lg bg-black object-cover" />
        ) : (
          <span aria-hidden className="aspect-16/9 w-24 shrink-0 rounded-lg bg-surface-elevated" />
        )}
        <span className="min-w-0 flex-1 space-y-0.5">
          <bdi className="line-clamp-2 block text-start text-sm font-medium">{summary.title}</bdi>
          <span className="block truncate text-xs text-text-secondary">
            <bdi>{summary.source}</bdi>
          </span>
          <span className="block text-xs text-text-secondary">
            {dateLabel} <time dateTime={entry.at.toISOString()}>{formatDate(entry.at)}</time>
          </span>
        </span>
      </Link>
      <RemoveFromListButton list={list} entityType={entry.entityType} entityId={entry.entityId} title={summary.title} />
    </li>
  );
}
