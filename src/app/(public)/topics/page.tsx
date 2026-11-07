import { LayoutGrid, Library, ListVideo } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { cardGridClass, ContentSection, TopicCard } from "@/components/knowledge/content-cards";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { listFeaturedTopics, listPublicTopics } from "@/features/topics/topics.service";
import { connection } from "next/server";

export const metadata: Metadata = { title: strings.topics.pageTitle, description: strings.topics.pageDescription, alternates: { canonical: "/topics" } };

interface PageProps {
  searchParams: Promise<{ cursor?: string }>;
}

export default async function TopicsPage({ searchParams }: PageProps) {
  await connection();
  const { cursor } = await searchParams;
  const [featured, topics] = await Promise.all([cursor ? [] : listFeaturedTopics(), listPublicTopics({ cursor })]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 md:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <h1 className="text-3xl font-semibold">{strings.topics.pageTitle}</h1>
          <p className="text-text-secondary">{strings.topics.pageDescription}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <Link href="/libraries">
              <Library aria-hidden data-icon="inline-start" />
              {strings.topics.browseLibraries}
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/playlists">
              <ListVideo aria-hidden data-icon="inline-start" />
              {strings.topics.browsePlaylists}
            </Link>
          </Button>
        </div>
      </header>

      <ContentSection id="featured-topics" title={strings.topics.featured} isEmpty={featured.length === 0}>
        <div className={cardGridClass}>
          {featured.map((topic) => (
            <TopicCard key={topic.id} topic={topic} />
          ))}
        </div>
      </ContentSection>

      {topics.items.length ? (
        <section aria-labelledby="all-topics">
          <h2 id="all-topics" className="mb-4 text-lg font-semibold">
            {strings.topics.all}
          </h2>
          <div className={cardGridClass} data-testid="topic-list">
            {topics.items.map((topic) => (
              <TopicCard key={topic.id} topic={topic} />
            ))}
          </div>
          {topics.nextCursor ? (
            <div className="mt-6 text-center">
              <Button asChild variant="secondary">
                <Link href={`/topics?${new URLSearchParams({ cursor: topics.nextCursor })}`}>{strings.content.showMore}</Link>
              </Button>
            </div>
          ) : null}
        </section>
      ) : (
        <StateMessage icon={LayoutGrid} title={strings.topics.emptyTitle} description={strings.topics.emptyDescription} />
      )}
    </div>
  );
}
