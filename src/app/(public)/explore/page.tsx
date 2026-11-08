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
import { listBrowsableTopics } from "@/features/topics/catalogue.service";
import { listExploreCollections } from "@/features/collections/collections.service";
import { getExploreSections, listExploreVideos, listPopularContent, POPULAR_WINDOW_DAYS } from "@/features/explore/explore.service";
import { cn } from "@/lib/utils";

const e = strings.explore;

export const metadata: Metadata = { title: e.pageTitle, description: e.pageDescription, alternates: { canonical: "/explore" } };

const chipClass = "inline-flex min-h-9 shrink-0 items-center rounded-lg px-3.5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50";

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
export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ topic?: string | string[] }> }) {
  await connection();
  const { topic: rawTopic } = await searchParams;
  const topics = await listBrowsableTopics();
  const selected = typeof rawTopic === "string" ? (topics.find((topic) => topic.slug === rawTopic) ?? null) : null;

  const [initialVideos, initialShorts, sections, collections, popular] = await Promise.all([
    listExploreVideos({ kind: "LONG_FORM", topicId: selected?.id, size: EXPLORE_LONG_PAGE }),
    listExploreVideos({ kind: "SHORT", topicId: selected?.id, size: EXPLORE_SHORTS_PAGE }),
    getExploreSections(),
    listExploreCollections(),
    listPopularContent(),
  ]);
  const { featuredTopics, updatedTopics, libraries, playlists, articles, newContent } = sections;

  const hasVideos = initialVideos.items.length + initialShorts.items.length > 0;
  const hasNewContent = newContent.articles.length + newContent.longVideos.length + newContent.shorts.length > 0;
  const hasEditorial = featuredTopics.length + updatedTopics.length + libraries.length + playlists.length + articles.length + collections.length + popular.length > 0 || hasNewContent;
  const now = new Date();

  // A chosen topic narrows the videos. The wider shelves belong to the "all" view.
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

  const isEmpty = !hasVideos && (selected !== null || (!hasEditorial && topics.length === 0));

  return (
    <div className="w-full" data-testid="explore-page">
      <h1 className="sr-only">{e.pageTitle}</h1>

      {/* One compact block, as on YouTube: search, then a single row of chips that scrolls on its own. */}
      <div className="sticky top-(--top-bar-height) z-20 bg-background/90 backdrop-blur-md md:top-0">
        <div className="mx-auto max-w-2xl px-4 pt-2.5 md:px-6 md:pt-4" data-testid="explore-search">
          <SearchBox initialQuery="" isCompact />
        </div>
        {topics.length ? (
          <nav aria-label={e.topics} data-testid="section-topics" className="scroll-row flex gap-2 overflow-x-auto px-4 py-2.5 [mask-image:linear-gradient(to_left,transparent,black_1rem,black_calc(100%-1rem),transparent)] md:justify-center-safe md:px-6 md:py-3">
            <Chip href="/explore" isActive={selected === null}>
              {e.all}
            </Chip>
            {topics.map((topic) => (
              <Chip key={topic.id} href={`/explore?topic=${encodeURIComponent(topic.slug)}`} isActive={selected?.id === topic.id} testId="explore-topic">
                {topic.title}
              </Chip>
            ))}
          </nav>
        ) : (
          <div className="h-3" />
        )}
      </div>

      <div className="mx-auto max-w-[1800px] px-4 pt-3 pb-10 md:px-6 md:pt-5">
        {isEmpty ? (
          <StateMessage icon={Compass} title={selected ? e.emptyTopicTitle : e.emptyTitle} description={selected ? e.emptyTopicDescription : e.emptyDescription} />
        ) : (
          // Keyed, so choosing another topic starts its list afresh.
          <ExploreFeed key={selected?.id ?? "all"} topicId={selected?.id ?? null} initialVideos={initialVideos} initialShorts={initialShorts} shelves={shelves} />
        )}
      </div>
    </div>
  );
}
