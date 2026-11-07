"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cardGridClass, TopicCard } from "@/components/knowledge/content-cards";
import { usePreferences } from "@/components/preferences/preferences-provider";
import { strings } from "@/config/strings.ar";
import type { TopicCardData } from "@/features/content/cards";

const e = strings.explore;

/**
 * The one part of Explore that depends on the person, and it only reflects topics they
 * chose themselves. With none chosen it isn't shown, so Explore stays the same for everyone
 * by default (§16). It loads in the browser so the page itself never reads a session.
 */
export function RecommendedTopics({ excludeIds }: { excludeIds: string[] }) {
  const { status, selectedTopicIds } = usePreferences();
  const [topics, setTopics] = useState<TopicCardData[]>([]);
  const chosen = selectedTopicIds.join(",");

  useEffect(() => {
    if (status !== "ready" || !chosen) return;
    const controller = new AbortController();
    fetch(`/api/explore/topics?ids=${chosen}`, { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<{ topics: TopicCardData[] }>) : { topics: [] }))
      .then((body) => setTopics(body.topics))
      .catch(() => {
        // This section is an extra. The rest of the page doesn't depend on it.
      });
    return () => controller.abort();
  }, [status, chosen]);

  const visible = chosen ? topics.filter((topic) => !excludeIds.includes(topic.id)) : [];
  if (visible.length === 0) return null;

  return (
    <section aria-labelledby="recommended-topics" data-testid="section-recommended-topics">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 id="recommended-topics" className="text-lg font-semibold">
            {e.recommendedTopics}
          </h2>
          <p className="text-sm text-text-secondary">{e.recommendedNote}</p>
        </div>
        <Link href="/interests" className="text-sm text-brand underline-offset-4 hover:underline">
          {e.manageInterests}
        </Link>
      </div>
      <div className={cardGridClass}>
        {visible.map((topic) => (
          <TopicCard key={topic.id} topic={topic} />
        ))}
      </div>
    </section>
  );
}
