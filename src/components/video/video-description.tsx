"use client";

import { ChevronDown, ChevronUp, ListOrdered } from "lucide-react";
import { useId, useState } from "react";
import { strings } from "@/config/strings.ar";
import { splitDescription, type Chapter } from "@/features/shorts/description";
import { formatDuration } from "@/features/playlists/rules";
import { formatCount } from "@/lib/format/video-time";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils/format";

const w = strings.watch;
const clock = (seconds: number) => formatDuration(seconds) ?? "0:00";

interface VideoDescriptionProps {
  description: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  uploadedAt: string | null;
  chapters: Chapter[];
  /** Null when there's no player that can seek, so timestamps stay plain text. */
  onSeek: ((seconds: number) => void) | null;
}

/** YouTube's text exactly as stored, never edited, with its timestamps made seekable and its links clickable. */
export function VideoDescription({ description, durationSeconds, viewCount, uploadedAt, chapters, onSeek }: VideoDescriptionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const bodyId = useId();
  const hasText = Boolean(description?.trim());
  const meta = [viewCount !== null ? `${formatCount(viewCount)} ${strings.feed.views}` : null, uploadedAt ? w.uploaded(formatDate(uploadedAt)) : null].filter(Boolean).join(" · ");
  if (!hasText && !meta && chapters.length === 0) return null;

  const seek = (seconds: number) => {
    onSeek?.(seconds);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <section className="rounded-2xl bg-surface-elevated/70 p-3 text-sm sm:p-4" data-testid="video-description">
      {meta ? (
        <p className="mb-1 font-medium" suppressHydrationWarning>
          <bdi>{meta}</bdi>
        </p>
      ) : null}

      {hasText ? (
        <div id={bodyId} dir="auto" className={cn("text-start leading-relaxed whitespace-pre-line text-text-secondary", !isOpen && "line-clamp-3")} data-testid="video-description-text">
          {splitDescription(description!, durationSeconds).map((segment, index) => {
            if (segment.type === "link") {
              return (
                <a key={index} href={segment.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="break-all text-brand underline-offset-4 hover:underline">
                  {segment.text}
                </a>
              );
            }
            if (segment.type === "time" && onSeek) {
              return (
                <button key={index} type="button" onClick={() => seek(segment.seconds)} aria-label={w.jumpTo(segment.text)} className="rounded text-brand underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
                  <bdi dir="ltr">{segment.text}</bdi>
                </button>
              );
            }
            return <span key={index}>{segment.text}</span>;
          })}
        </div>
      ) : null}

      {isOpen && chapters.length ? (
        <div className="mt-4 space-y-2" data-testid="video-chapters">
          <h3 className="flex items-center gap-2 font-semibold">
            <ListOrdered aria-hidden className="size-4" />
            {w.chapters}
          </h3>
          <ol className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
            {chapters.map((chapter) => (
              <li key={chapter.seconds} className="w-44 shrink-0 snap-start">
                <button
                  type="button"
                  disabled={!onSeek}
                  onClick={() => seek(chapter.seconds)}
                  aria-label={w.chapterJump(chapter.title, clock(chapter.seconds))}
                  className="flex h-full w-full flex-col gap-1 rounded-xl border bg-surface p-2.5 text-start outline-none hover:bg-surface-elevated focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
                >
                  <bdi dir="ltr" className="text-xs font-semibold text-brand tabular-nums">
                    {clock(chapter.seconds)}
                  </bdi>
                  <span dir="auto" className="line-clamp-2 text-xs">
                    {chapter.title}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {hasText || chapters.length ? (
        <button type="button" aria-expanded={isOpen} aria-controls={bodyId} onClick={() => setIsOpen((open) => !open)} className="mt-2 inline-flex min-h-9 items-center gap-1 rounded-lg font-semibold outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50" data-testid="video-description-toggle">
          {isOpen ? w.showLess : w.showMore}
          {isOpen ? <ChevronUp aria-hidden className="size-4" /> : <ChevronDown aria-hidden className="size-4" />}
        </button>
      ) : null}
    </section>
  );
}
