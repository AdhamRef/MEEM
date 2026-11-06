import { Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ExploreFeed } from "@/components/explore/explore-feed";
import { ExploreShortCard, ExploreVideoCard } from "@/components/explore/explore-cards";
import { RecommendedTopics } from "@/components/explore/recommended-topics";
import { Shelf } from "@/components/explore/shelf";
import { MixedContent } from "@/components/knowledge/content-card";
import { ArticleCard, LibraryCard, PlaylistCard, TopicCard } from "@/components/knowledge/content-cards";
import { SearchBox } from "@/components/search/search-box";
import { StateMessage } from "@/components/shared/state-message";
import { EXPLORE_LONG_PAGE, EXPLORE_SHORTS_PAGE } from "@/config/feed";
import { strings } from "@/config/strings.ar";
import { listActiveCategories } from "@/features/categories/categories.service";
import { listExploreCollections } from "@/features/collections/collections.service";
import { getExploreSections, listExploreVideos, listPopularContent, POPULAR_WINDOW_DAYS } from "@/features/explore/explore.service";
import { cn } from "@/lib/utils";

const e = strings.explore;

export const metadata: Metadata = { title: e.pageTitle, description: e.pageDescription, alternates: { canonical: "/explore" } };

const chipClass = "inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-9";

function Chip({ href, isActive, testId, children }: { href: string; isActive: boolean; testId?: string; children: string }) {
  return (
    <Link href={href} aria-current={isActive ? "page" : undefined} data-testid={testId} className={cn(chipClass, isActive ? "bg-text-primary text-background" : "bg-surface-elevated text-text-primary hover:bg-border")}>
      {children}
    </Link>
  );
}

/**
 * Laid out like a video site's home page, and the same for everyone: this never reads who's
 * asking, so it can't turn into a second For You (§16). The editorial sections the specification
 * asks for are all still here, as shelves between the videos. Empty ones are hidden.
 */
export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ category?: string | string[] }> }) {
  await connection();
  const { category: rawCategory } = await searchParams;
  const categories = await listActiveCategories();
  const selected = typeof rawCategory === "string" ? (categories.find((category) => category.slug === rawCategory) ?? null) : null;

  const [initialVideos, initialShorts, sections, collections, popular] = await Promise.all([
    listExploreVideos({ kind: "LONG_FORM", categoryId: selected?.id, size: EXPLORE_LONG_PAGE }),
    listExploreVideos({ kind: "SHORT", categoryId: selected?.id, size: EXPLORE_SHORTS_PAGE }),
    getExploreSections(),
    listExploreCollections(),
    listPopularContent(),
  ]);
  const { featuredTopics, updatedTopics, libraries, playlists, articles, newContent } = sections;

  const hasVideos = initialVideos.items.length + initialShorts.items.length > 0;
  const hasNewContent = newContent.articles.length + newContent.longVideos.length + newContent.shorts.length > 0;
  const hasEditorial = featuredTopics.length + updatedTopics.length + libraries.length + playlists.length + articles.length + collections.length + popular.length > 0 || hasNewContent;
  const now = new Date();

  // A chosen category narrows the videos. The wider shelves belong to the "all" view.
  const shelves = selected
    ? []
    : [
        <Shelf key="featured-topics" id="featured-topics" title={e.featuredTopics} href="/topics">
          {featuredTopics.map((topic) => (
            <TopicCard key={topic.id} topic={topic} />
          ))}
        </Shelf>,
        <RecommendedTopics key="recommended" excludeIds={featuredTopics.map((topic) => topic.id)} />,
        <Shelf key="playlists" id="playlists" title={e.playlists} href="/playlists">
          {playlists.map((playlist) => (
            <PlaylistCard key={playlist.id} playlist={playlist} />
          ))}
        </Shelf>,
        ...collections.map((collection) => (
          <section key={collection.id} aria-labelledby={`collection-${collection.id}`} data-testid={`section-collection-${collection.id}`}>
            <h2 id={`collection-${collection.id}`} className="text-lg font-semibold">
              {collection.title}
            </h2>
            {collection.description ? (
              <p dir="auto" className="mb-3 text-start text-xs text-text-secondary">
                {collection.description}
              </p>
            ) : null}
            <MixedContent items={collection.items} />
          </section>
        )),
        <Shelf key="articles" id="selected-articles" title={e.articles}>
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </Shelf>,
        <Shelf key="libraries" id="libraries" title={e.libraries} href="/libraries">
          {libraries.map((library) => (
            <LibraryCard key={library.id} library={library} />
          ))}
        </Shelf>,
        popular.length ? (
          <section key="popular" aria-labelledby="popular" data-testid="section-popular">
            <h2 id="popular" className="text-lg font-semibold">
              {e.popular}
            </h2>
            <p dir="auto" className="mb-3 text-start text-xs text-text-secondary">
              {e.popularNote(POPULAR_WINDOW_DAYS)}
            </p>
            <MixedContent items={popular} />
          </section>
        ) : null,
        hasNewContent ? (
          <Shelf key="new-content" id="new-content" title={e.newContent}>
            {[
              ...newContent.longVideos.map((video) => <ExploreVideoCard key={video.id} video={video} now={now} isInShelf />),
              ...newContent.shorts.map((video) => <ExploreShortCard key={video.id} video={video} />),
              ...newContent.articles.map((article) => <ArticleCard key={article.id} article={article} />),
            ]}
          </Shelf>
        ) : null,
        <Shelf key="updated-topics" id="updated-topics" title={e.updatedTopics} href="/topics">
          {updatedTopics.map((topic) => (
            <TopicCard key={topic.id} topic={topic} />
          ))}
        </Shelf>,
      ].filter(Boolean);

  const isEmpty = !hasVideos && (selected !== null || (!hasEditorial && categories.length === 0));

  return (
    <div className="w-full" data-testid="explore-page">
      <h1 className="sr-only">{e.pageTitle}</h1>

      <div className="sticky top-(--top-bar-height) z-20 border-b bg-background/95 backdrop-blur-sm md:top-0">
        <div className="mx-auto max-w-2xl px-4 pt-3 md:px-6" data-testid="explore-search">
          <SearchBox initialQuery="" isCompact />
        </div>
        {categories.length ? (
          <nav aria-label={e.categories} data-testid="section-categories" className="scroll-row flex gap-2 overflow-x-auto px-4 py-3 md:px-6">
            <Chip href="/explore" isActive={selected === null}>
              {e.all}
            </Chip>
            {categories.map((category) => (
              <Chip key={category.id} href={`/explore?category=${encodeURIComponent(category.slug)}`} isActive={selected?.id === category.id} testId="explore-category">
                {category.title}
              </Chip>
            ))}
          </nav>
        ) : (
          <div className="h-3" />
        )}
      </div>

      <div className="px-4 pt-4 pb-10 md:px-6">
        {isEmpty ? (
          <StateMessage icon={Compass} title={selected ? e.emptyCategoryTitle : e.emptyTitle} description={selected ? e.emptyCategoryDescription : e.emptyDescription} />
        ) : (
          // Keyed, so choosing another category starts its list afresh.
          <ExploreFeed key={selected?.id ?? "all"} categoryId={selected?.id ?? null} initialVideos={initialVideos} initialShorts={initialShorts} shelves={shelves} />
        )}
      </div>
    </div>
  );
}
