"use client";

import { Check, HeartHandshake, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { strings } from "@/config/strings.ar";
import { cn } from "@/lib/utils";

const f = strings.feed;

interface Topic {
  id: string;
  title: string;
}

interface InterestsDrawerProps {
  topics: Topic[];
  /** The person's own choices, shown first. */
  selectedTopicIds: string[];
  /** The topic the feed is showing, or null for "for you". */
  activeTopicId: string | null;
  onSelect: (topicId: string | null) => void;
}

function Choice({ label, isActive, onSelect, icon }: { label: string; isActive: boolean; onSelect: () => void; icon?: React.ReactNode }) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={isActive}
        onClick={onSelect}
        className={cn(
          "flex min-h-12 w-full items-center gap-3 rounded-2xl border px-4 text-start text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
          isActive ? "border-brand bg-brand/10 font-semibold text-text-primary" : "border-transparent bg-surface hover:bg-surface/70",
        )}
        data-testid="interest-choice"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {isActive ? <Check aria-hidden className="size-4 shrink-0 text-brand" /> : null}
      </button>
    </li>
  );
}

/**
 * One button over the feed instead of a row of scrolling tabs. It opens the person's interests,
 * to switch what the feed shows, with the full choice of interests one tap further.
 */
export function InterestsDrawer({ topics, selectedTopicIds, activeTopicId, onSelect }: InterestsDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const chosen = new Set(selectedTopicIds);
  const yours = topics.filter((topic) => chosen.has(topic.id));
  const others = topics.filter((topic) => !chosen.has(topic.id));
  const active = topics.find((topic) => topic.id === activeTopicId);

  const select = (topicId: string | null) => {
    onSelect(topicId);
    setIsOpen(false);
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={active ? `${f.interestsButton}: ${active.title}` : f.interestsButton}
          className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-black/35 px-3 text-white outline-none backdrop-blur-md transition-colors hover:bg-black/50 focus-visible:ring-3 focus-visible:ring-ring/50"
          data-testid="interests-button"
        >
          <HeartHandshake aria-hidden className="size-5" strokeWidth={1.75} />
          {active ? <span className="max-w-32 truncate text-sm font-medium">{active.title}</span> : null}
        </button>
      </SheetTrigger>
      <SheetContent closeLabel={f.close} data-testid="interests-drawer">
        <div className="space-y-1 pe-10">
          <SheetTitle className="text-lg font-bold">{f.interestsTitle}</SheetTitle>
          <SheetDescription className="text-sm text-text-secondary">{f.interestsHint}</SheetDescription>
        </div>

        <div className="-mx-1 min-h-0 flex-1 space-y-5 overflow-y-auto px-1">
          <ul className="space-y-2">
            <Choice label={f.forYou} isActive={activeTopicId === null} onSelect={() => select(null)} icon={<Sparkles aria-hidden className="size-4 shrink-0 text-brand" />} />
          </ul>

          <section className="space-y-2" aria-labelledby="interests-yours">
            <h3 id="interests-yours" className="text-xs font-semibold text-text-secondary">
              {f.yourTopics}
            </h3>
            {yours.length ? (
              <ul className="space-y-2">
                {yours.map((topic) => (
                  <Choice key={topic.id} label={topic.title} isActive={activeTopicId === topic.id} onSelect={() => select(topic.id)} />
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl border border-dashed p-4 text-sm text-text-secondary">{f.noInterests}</p>
            )}
          </section>

          {others.length ? (
            <section className="space-y-2" aria-labelledby="interests-others">
              <h3 id="interests-others" className="text-xs font-semibold text-text-secondary">
                {f.otherTopics}
              </h3>
              <ul className="grid grid-cols-2 gap-2">
                {others.map((topic) => (
                  <Choice key={topic.id} label={topic.title} isActive={activeTopicId === topic.id} onSelect={() => select(topic.id)} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <Link
          href="/interests"
          onClick={() => setIsOpen(false)}
          className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50"
          data-testid="interests-add"
        >
          <Plus aria-hidden className="size-4" />
          {f.addInterests}
        </Link>
      </SheetContent>
    </Sheet>
  );
}
