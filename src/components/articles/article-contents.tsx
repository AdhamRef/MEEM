"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Heading {
  anchor: string;
  level: number;
  text: string;
}

/**
 * The article's contents, with the section being read marked. Without JavaScript it's still a
 * plain list of links, so nothing depends on the highlighting.
 */
export function ArticleContents({ headings }: { headings: Heading[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const elements = headings.map((heading) => document.getElementById(heading.anchor)).filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;
    // The last heading above a line a quarter of the way down the screen is the one being read.
    const observer = new IntersectionObserver(
      () => {
        const line = window.innerHeight * 0.25;
        let current: string | null = null;
        for (const element of elements) if (element.getBoundingClientRect().top <= line) current = element.id;
        setActive(current ?? elements[0]!.id);
      },
      { rootMargin: "0px 0px -75% 0px", threshold: [0, 1] },
    );
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [headings]);

  return (
    <ol className="space-y-1 border-s text-sm">
      {headings.map((heading) => {
        const isActive = heading.anchor === active;
        return (
          <li key={heading.anchor}>
            <a
              href={`#${heading.anchor}`}
              dir="auto"
              aria-current={isActive ? "location" : undefined}
              className={cn(
                "-ms-px block border-s-2 py-1 text-start underline-offset-4 outline-none hover:text-text-primary focus-visible:underline",
                heading.level === 3 ? "ps-6" : heading.level === 4 ? "ps-9" : "ps-3",
                isActive ? "border-brand font-medium text-text-primary" : "border-transparent text-text-secondary",
              )}
            >
              {heading.text}
            </a>
          </li>
        );
      })}
    </ol>
  );
}
