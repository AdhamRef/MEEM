/* eslint-disable @next/next/no-img-element -- Covers are resized on upload, and their host depends on the storage provider. */
import { ChevronDown, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ContentActions } from "@/components/knowledge/content-actions";
import { ViewRecorder } from "@/components/knowledge/view-recorder";
import { ReadingProgress } from "@/components/articles/reading-progress";
import { ArticleCard, cardGridClass, ContentSection, PlaylistCard, ResourceCard, ShortsStrip, slugHref, TopicCard, VideoTile } from "@/components/knowledge/content-cards";
import { JsonLd } from "@/components/shared/json-ld";
import { articleJsonLd } from "@/lib/seo";
import { strings } from "@/config/strings.ar";
import { getArticleConnections, getPublishedArticleBySlug } from "@/features/articles/articles.service";
import { listPublicPlaylistsFor } from "@/features/playlists/playlists.service";
import { ArticleBody } from "@/lib/content/content-renderer";
import { formatDate } from "@/lib/utils/format";

interface PageProps {
  params: Promise<{ slug: string }>;
}

const loadArticle = cache(getPublishedArticleBySlug);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const article = await loadArticle((await params).slug);
  if (!article) return {};
  const title = article.seo?.title ?? article.title;
  const description = article.seo?.description ?? article.excerpt ?? undefined;
  return {
    title,
    description,
    alternates: { canonical: slugHref("articles", article.slug) },
    openGraph: { type: "article", title, description, images: article.coverImage ? [article.coverImage] : undefined, publishedTime: article.publishedAt?.toISOString(), modifiedTime: article.updatedAt.toISOString() },
  };
}

export default async function ArticlePage({ params }: PageProps) {
  const article = await loadArticle((await params).slug);
  if (!article) notFound();

  const [connections, playlists] = await Promise.all([getArticleConnections(article.id), listPublicPlaylistsFor({ articleId: article.id })]);
  const path = slugHref("articles", article.slug);
  const hasContents = article.headings.length > 1;

  const contents = hasContents ? (
    <ol className="space-y-2 text-sm">
      {article.headings.map((heading) => (
        <li key={heading.anchor} className={heading.level === 3 ? "ms-3" : heading.level === 4 ? "ms-6" : undefined}>
          <a href={`#${heading.anchor}`} dir="auto" className="block text-start text-text-secondary underline-offset-4 outline-none hover:text-text-primary hover:underline focus-visible:text-text-primary focus-visible:underline">
            {heading.text}
          </a>
        </li>
      ))}
    </ol>
  ) : null;

  return (
    <>
      <ReadingProgress targetId="article-reading-area" />

      <article className="w-full px-4 py-8 md:px-8" data-testid="article-page">
        {/* One width for everything, so the title, text, and related content share an edge. */}
        <div className="mx-auto max-w-[68ch] lg:max-w-[calc(68ch+18.5rem)]">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-10">
          <div id="article-reading-area" className="min-w-0">
            <header className="space-y-4">
              <h1 dir="auto" className="text-start text-3xl leading-tight font-semibold text-balance md:text-4xl">
                {article.title}
              </h1>
              {article.excerpt ? (
                <p dir="auto" className="text-start text-lg text-text-secondary">
                  {article.excerpt}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
                {article.bylineName ? (
                  <span>
                    {strings.articles.by} <bdi>{article.bylineName}</bdi>
                  </span>
                ) : null}
                {article.publishedAt ? <time dateTime={article.publishedAt.toISOString()}>{formatDate(article.publishedAt)}</time> : null}
                {article.readingMinutes > 0 ? <span>{strings.articles.readingTime(article.readingMinutes)}</span> : null}
              </div>
              <ContentActions entityType="ARTICLE" entityId={article.id} path={path} title={article.title} testId="article-actions" />
              <ViewRecorder entityType="ARTICLE" entityId={article.id} />
              <JsonLd data={articleJsonLd(article, path, strings.app.name)} />
            </header>

            {article.coverImage ? (
              <figure className="mt-6">
                <img src={article.coverImage} alt="" decoding="async" className="w-full rounded-2xl" data-testid="article-cover" />
                {article.coverCaption ? (
                  <figcaption dir="auto" className="mt-2 text-start text-sm text-text-secondary">
                    {article.coverCaption}
                  </figcaption>
                ) : null}
              </figure>
            ) : null}



            {contents ? (
              <details className="group mt-8 mb-6 rounded-2xl border bg-surface p-4 lg:hidden" data-testid="contents-mobile">
                <summary className="flex min-h-6 cursor-pointer list-none items-center justify-between font-medium outline-none focus-visible:underline">
                  {strings.articles.contents}
                  <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
                </summary>
                <nav aria-label={strings.articles.contents} className="mt-3">
                  {contents}
                </nav>
              </details>
            ) : null}

            <div className="mt-8">
              <ArticleBody body={article.body} />
            </div>

            {article.sources.length ? (
              <section aria-labelledby="article-sources" className="mt-10 border-t pt-6" data-testid="article-sources">
                <h2 id="article-sources" className="mb-3 text-lg font-semibold">
                  {strings.articles.sources}
                </h2>
                <ol className="list-inside list-[arabic-indic] space-y-2 text-sm text-text-secondary">
                  {article.sources.map((source, index) => (
                    <li key={index}>
                      <bdi className="text-text-primary">{source.title}</bdi>
                      {source.author ? <bdi> — {source.author}</bdi> : null}
                      {source.note ? <bdi> — {source.note}</bdi> : null}
                      {source.url ? (
                        <>
                          {" "}
                          <a href={source.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-brand underline-offset-4 hover:underline">
                            {strings.articles.openSource}
                            <ExternalLink aria-hidden className="size-3" />
                          </a>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            <p className="mt-8 text-sm text-text-secondary" data-testid="article-updated">
              {strings.content.updatedOn} <time dateTime={article.updatedAt.toISOString()}>{formatDate(article.updatedAt)}</time>
            </p>
          </div>

          {contents ? (
            <aside className="hidden lg:block">
              <nav aria-label={strings.articles.contents} className="sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto" data-testid="contents-desktop">
                <p className="mb-3 text-sm font-medium">{strings.articles.contents}</p>
                {contents}
              </nav>
            </aside>
          ) : null}
        </div>

        <div className="mt-12 space-y-10">
          <ContentSection id="related-shorts" title={strings.articles.relatedShorts} isEmpty={connections.shorts.length === 0}>
            <ShortsStrip videos={connections.shorts} />
          </ContentSection>

          <ContentSection id="related-videos" title={strings.articles.relatedVideos} isEmpty={connections.longVideos.length === 0}>
            <div className={cardGridClass}>
              {connections.longVideos.map((video) => (
                <VideoTile key={video.id} video={video} />
              ))}
            </div>
          </ContentSection>

          <ContentSection id="related-playlists" title={strings.articles.relatedPlaylists} isEmpty={playlists.length === 0}>
            <div className={cardGridClass}>
              {playlists.map((playlist) => (
                <PlaylistCard key={playlist.id} playlist={playlist} />
              ))}
            </div>
          </ContentSection>

          {connections.relationGroups.map((group) => (
            <ContentSection key={group.relationType} id={`relation-${group.relationType.toLowerCase()}`} title={strings.articles.relationLabels[group.relationType]} isEmpty={false}>
              <div className={cardGridClass}>
                {group.articles.map((item) => (
                  <ArticleCard key={item.id} article={item} />
                ))}
                {group.topics.map((item) => (
                  <TopicCard key={item.id} topic={item} />
                ))}
                {group.resources.map((item) => (
                  <ResourceCard key={item.id} resource={item} />
                ))}
              </div>
            </ContentSection>
          ))}

          <ContentSection id="related-topics" title={strings.articles.relatedTopics} isEmpty={connections.topics.length === 0}>
            <div className={cardGridClass}>
              {connections.topics.map((topic) => (
                <TopicCard key={topic.id} topic={topic} />
              ))}
            </div>
          </ContentSection>

          <ContentSection id="related-libraries" title={strings.articles.relatedLibraries} isEmpty={connections.libraries.length === 0}>
            <ul className="flex flex-wrap gap-2">
              {connections.libraries.map((library) => (
                <li key={library.id}>
                  <Link href={slugHref("libraries", library.slug)} className="inline-flex min-h-11 items-center rounded-full border bg-surface px-4 text-sm outline-none hover:bg-surface-elevated focus-visible:ring-3 focus-visible:ring-ring/50">
                    {library.name}
                  </Link>
                </li>
              ))}
            </ul>
          </ContentSection>
        </div>
        </div>
      </article>
    </>
  );
}
