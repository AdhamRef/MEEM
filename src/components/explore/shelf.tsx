"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Children, useRef, type ComponentType, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { cn } from "@/lib/utils";

interface ShelfProps {
  id: string;
  title: string;
  note?: string;
  href?: string;
  icon?: ComponentType<{ className?: string }>;
  /** Tailwind classes for the width of each item. */
  itemClass?: string;
  children: ReactNode;
}

/** A titled row that scrolls sideways, with arrows on larger screens. Nothing renders without items. */
export function Shelf({ id, title, note, href, icon: Icon, itemClass = "w-72", children }: ShelfProps) {
  const rowRef = useRef<HTMLUListElement>(null);
  const items = Children.toArray(children);
  if (items.length === 0) return null;

  // In right-to-left pages, moving forward means a negative scroll position.
  const move = (direction: 1 | -1) => {
    const row = rowRef.current;
    if (!row) return;
    const distance = row.clientWidth * 0.8 * direction;
    row.scrollBy({ left: getComputedStyle(row).direction === "rtl" ? -distance : distance, behavior: "smooth" });
  };

  return (
    <section aria-labelledby={id} data-testid={`section-${id}`} className="min-w-0">
      <div className="mb-3 flex items-center gap-2">
        {Icon ? <Icon aria-hidden className="size-5 text-brand" /> : null}
        <div className="min-w-0 flex-1">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          {note ? (
            <p dir="auto" className="text-start text-xs text-text-secondary">
              {note}
            </p>
          ) : null}
        </div>
        {href ? (
          <Link href={href} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm text-brand outline-none hover:bg-surface-elevated focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-9">
            {strings.explore.viewAll}
          </Link>
        ) : null}
        <div className="hidden gap-1 md:flex">
          <Button variant="ghost" size="icon" className="rounded-full" aria-label={strings.explore.scrollBack} title={strings.explore.scrollBack} onClick={() => move(-1)}>
            <ChevronLeft aria-hidden className="rtl:rotate-180" />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full" aria-label={strings.explore.scrollForward} title={strings.explore.scrollForward} onClick={() => move(1)}>
            <ChevronRight aria-hidden className="rtl:rotate-180" />
          </Button>
        </div>
      </div>
      <ul ref={rowRef} tabIndex={0} aria-labelledby={id} className="scroll-row -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:mx-0 md:px-0">
        {items.map((item, index) => (
          <li key={index} className={cn("shrink-0 snap-start", itemClass)}>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
