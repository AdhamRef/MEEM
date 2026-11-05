import { LayoutGrid, Library, ListVideo } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { cardGridClass, ContentSection, TopicCard } from "@/components/knowledge/content-cards";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { listActiveCategories } from "@/features/categories/categories.service";
import { listFeaturedTopics, listPublicTopics } from "@/features/topics/topics.service";
import { connection } from "next/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: strings.topics.pageTitle, description: strings.topics.pageDescription, alternates: { canonical: "/topics" } };

interface PageProps {
  searchParams: Promise<{ category?: string; cursor?: string }>;
}

export default async function TopicsPage({ searchParams }: PageProps) {
  await connection();
  const { category: categorySlug, cursor } = await searchParams;

  const categories = await listActiveCategories();
  const selected = categories.find((category) => category.slug === categorySlug);
  const [featured, topics] = await Promise.all([selected || cursor ? [] : listFeaturedTopics(), listPublicTopics({ cursor, categoryId: selected?.id })]);

  const chipClass = "inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50";
  const pageHref = (params: Record<string, string | undefined>) => {
    const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
    return query ? `/topics?${query}` : "/topics";
  };

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

      {categories.length ? (
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" data-testid="topic-categories">
          <li>
            <Link href="/topics" aria-current={selected ? undefined : "page"} className={cn(chipClass, selected ? "bg-surface hover:bg-surface-elevated" : "border-brand bg-surface-elevated")}>
              {strings.topics.allCategories}
            </Link>
          </li>
          {categories.map((category) => (
            <li key={category.id}>
              <Link href={pageHref({ category: category.slug })} aria-current={selected?.id === category.id ? "page" : undefined} className={cn(chipClass, selected?.id === category.id ? "border-brand bg-surface-elevated" : "bg-surface hover:bg-surface-elevated")}>
                {category.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

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
            {selected?.title ?? strings.topics.all}
          </h2>
          <div className={cardGridClass} data-testid="topic-list">
            {topics.items.map((topic) => (
              <TopicCard key={topic.id} topic={topic} />
            ))}
          </div>
          {topics.nextCursor ? (
            <div className="mt-6 text-center">
              <Button asChild variant="secondary">
                <Link href={pageHref({ category: selected?.slug, cursor: topics.nextCursor })}>{strings.content.showMore}</Link>
              </Button>
            </div>
          ) : null}
        </section>
      ) : (
        <StateMessage icon={LayoutGrid} title={strings.topics.emptyTitle} description={selected ? strings.topics.emptyCategory : strings.topics.emptyDescription} />
      )}
    </div>
  );
}
