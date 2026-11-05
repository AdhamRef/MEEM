"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { strings } from "@/config/strings.ar";
import type { SearchSuggestion } from "@/features/search/search.service";

const DEBOUNCE_MS = 200;
const MIN_CHARACTERS = 2;

/**
 * A plain GET form, so searching works before the page's scripts load. Suggestions only add to it,
 * and if they fail, the form still works. Nothing is stored about what's typed.
 */
export function SearchBox({ initialQuery, children }: { initialQuery: string; children?: ReactNode }) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const hasEdited = useRef(false);

  useEffect(() => {
    if (!hasEdited.current) return;
    const typed = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (typed.length < MIN_CHARACTERS) {
        setSuggestions([]);
        return;
      }
      try {
        const response = await fetch(`/api/search/suggestions?q=${encodeURIComponent(typed)}`, { signal: controller.signal });
        const body = response.ok ? ((await response.json()) as { suggestions: SearchSuggestion[] }) : { suggestions: [] };
        setSuggestions(body.suggestions);
        setActiveIndex(-1);
      } catch {
        // Suggestions are a convenience. Pressing search still works.
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const isShowing = isOpen && suggestions.length > 0;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setIsOpen(false);
      return;
    }
    if (!isShowing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      // One position past the end means no suggestion is active, which returns to typing.
      setActiveIndex((current) => {
        const positions = suggestions.length + 1;
        return ((current + 1 + step + positions) % positions) - 1;
      });
    } else if (event.key === "Enter" && activeIndex >= 0 && suggestions[activeIndex]) {
      event.preventDefault();
      setIsOpen(false);
      router.push(suggestions[activeIndex].href);
    }
  };

  return (
    <form action="/search" method="get" role="search" className="space-y-3" data-testid="search-form">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary" />
          <Input
            name="q"
            type="search"
            dir="auto"
            value={query}
            maxLength={120}
            autoComplete="off"
            placeholder={strings.search.placeholder}
            aria-label={strings.search.label}
            role="combobox"
            aria-expanded={isShowing}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={isShowing && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
            className="h-12 ps-9 text-base"
            data-testid="search-input"
            onChange={(event) => {
              hasEdited.current = true;
              setQuery(event.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            // Long enough for a click on a suggestion to land before the list closes.
            onBlur={() => setTimeout(() => setIsOpen(false), 150)}
            onKeyDown={onKeyDown}
          />
          <ul id={listId} role="listbox" aria-label={strings.search.suggestions} hidden={!isShowing} className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border bg-surface-elevated shadow-lg" data-testid="search-suggestions">
            {suggestions.map((suggestion, index) => (
              <li
                key={`${suggestion.href}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`flex min-h-11 cursor-pointer flex-col justify-center px-3 py-2 text-sm hover:bg-surface ${index === activeIndex ? "bg-surface" : ""}`}
                // Before the input's blur, so the list is still there to be clicked.
                onMouseDown={(event) => {
                  event.preventDefault();
                  setIsOpen(false);
                  router.push(suggestion.href);
                }}
              >
                <bdi className="block truncate">{suggestion.label}</bdi>
                <bdi className="block truncate text-xs text-text-secondary">{suggestion.hint}</bdi>
              </li>
            ))}
          </ul>
        </div>
        <Button type="submit" className="h-12" data-testid="search-submit">
          {strings.search.submit}
        </Button>
      </div>
      {children}
    </form>
  );
}
