import { Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { RecommendedTopics } from "@/components/explore/recommended-topics";
import { MixedContent } from "@/components/knowledge/content-card";
import { ArticleCard, cardGridClass, LibraryCard, PlaylistCard, ShortsStrip, TopicCard, VideoTile } from "@/components/knowledge/content-cards";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { listActiveCategories } from "@/features/categories/categories.service";
import { listExploreCollections } from "@/features/collections/collections.service";
import { getExploreSections, listPopularContent, POPULAR_WINDOW_DAYS } from "@/features/explore/explore.service";

const e = strings.explore;

export const metadata: Metadata = { title: e.pageTitle, description: e.pageDescription, alternates: { canonical: "/explore" } };

function Section({ id, title, note, href, children }: { id: string; title: string; note?: string; href?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} data-testid={`section-${id}`}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="max-w-3xl">
          <h2 id={id} className="text-xl font-semibold">
            {title}
          </h2>
          {note ? (
            <p dir="auto" className="mt-1 text-start text-sm text-text-secondary">
              {note}
            </p>
          ) : null}
        </div>
        {href ? (
          <Link href={href} className="text-sm text-brand underline-offset-4 hover:underline">
            {e.viewAll}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Editorially organised and the same for everyone. Empty sections are hidden, so nothing looks broken. */
export default async function ExplorePage() {
  await connection();
  const [categories, sections, collections, popular] = await Promise.all([listActiveCategories(), getExploreSections(), listExploreCollections(), listPopularContent()]);
  const { featuredTopics, updatedTopics, libraries, playlists, articles, newContent } = sections;

  const hasNewContent = newContent.articles.length + newContent.longVideos.length + newContent.shorts.length > 0;
  const hasAnything = categories.length + featuredTopics.length + updatedTopics.length + libraries.length + playlists.length + articles.length + collections.length + popular.length > 0 || hasNewContent;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-12 px-4 py-8 md:px-8" data-testid="explore-page">
      <header className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-semibold">{e.pageTitle}</h1>
        <p className="text-text-secondary">{e.pageDescription}</p>
      </header>

      {!hasAnything ? <StateMessage icon={Compass} title={e.emptyTitle} description={e.emptyDescription} /> : null}

      {categories.length ? (
        <Section id="categories" title={e.categories}>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {categories.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/topics?category=${encodeURIComponent(category.slug)}`}
                  className="flex h-full min-h-16 items-center rounded-xl border bg-surface p-4 font-medium outline-none transition-colors hover:border-brand hover:bg-surface-elevated focus-visible:ring-3 focus-visible:ring-ring/50"
                  data-testid="explore-category"
                >
                  {category.title}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {featuredTopics.length ? (
        <Section id="featured-topics" title={e.featuredTopics} href="/topics">
          <div className={cardGridClass}>
            {featuredTopics.map((topic) => (
              <TopicCard key={topic.id} topic={topic} />
            ))}
          </div>
        </Section>
      ) : null}

      <RecommendedTopics excludeIds={featuredTopics.map((topic) => topic.id)} />

      {collections.map((collection) => (
        <Section key={collection.id} id={`collection-${collection.id}`} title={collection.title} note={collection.description ?? undefined}>
          <MixedContent items={collection.items} />
        </Section>
      ))}

      {libraries.length ? (
        <Section id="libraries" title={e.libraries} href="/libraries">
          <div className={cardGridClass}>
            {libraries.map((library) => (
              <LibraryCard key={library.id} library={library} />
            ))}
          </div>
        </Section>
      ) : null}

      {playlists.length ? (
        <Section id="playlists" title={e.playlists} href="/playlists">
          <div className={cardGridClass}>
            {playlists.map((playlist) => (
              <PlaylistCard key={playlist.id} playlist={playlist} />
            ))}
          </div>
        </Section>
      ) : null}

      {articles.length ? (
        <Section id="selected-articles" title={e.articles}>
          <div className={cardGridClass}>
            {articles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        </Section>
      ) : null}

      {popular.length ? (
        <Section id="popular" title={e.popular} note={e.popularNote(POPULAR_WINDOW_DAYS)}>
          <MixedContent items={popular} />
        </Section>
      ) : null}

      {hasNewContent ? (
        <Section id="new-content" title={e.newContent}>
          <div className="space-y-4">
            {newContent.articles.length + newContent.longVideos.length ? (
              <div className={cardGridClass}>
                {newContent.articles.map((article) => (
                  <ArticleCard key={article.id} article={article} />
                ))}
                {newContent.longVideos.map((video) => (
                  <VideoTile key={video.id} video={video} />
                ))}
              </div>
            ) : null}
            {newContent.shorts.length ? <ShortsStrip videos={newContent.shorts} /> : null}
          </div>
        </Section>
      ) : null}

      {updatedTopics.length ? (
        <Section id="updated-topics" title={e.updatedTopics} href="/topics">
          <div className={cardGridClass}>
            {updatedTopics.map((topic) => (
              <TopicCard key={topic.id} topic={topic} />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
