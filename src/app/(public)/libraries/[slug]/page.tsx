/* eslint-disable @next/next/no-img-element -- Covers are resized on upload, and their host depends on the storage provider. */
import { Library } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArticleCard, cardGridClass, ContentSection, LibraryCard, PlaylistCard, ResourceCard, SectionPager, slugHref, TopicCard, VideoTile } from "@/components/knowledge/content-cards";
import { ViewRecorder } from "@/components/knowledge/view-recorder";
import { JsonLd } from "@/components/shared/json-ld";
import { collectionJsonLd } from "@/lib/seo";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { getLibrarySections, getPublicLibraryParent, getPublishedLibraryBySlug } from "@/features/libraries/libraries.service";
import { listPublicPlaylistsFor } from "@/features/playlists/playlists.service";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ articles?: string; videos?: string }>;
}

const loadLibrary = cache(getPublishedLibraryBySlug);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const library = await loadLibrary((await params).slug);
  if (!library) return {};
  const description = library.description ?? undefined;
  return { title: library.name, description, alternates: { canonical: slugHref("libraries", library.slug) }, openGraph: { title: library.name, description, images: library.coverImage ? [library.coverImage] : undefined } };
}

export default async function LibraryPage({ params, searchParams }: PageProps) {
  const library = await loadLibrary((await params).slug);
  if (!library) notFound();

  const cursors = await searchParams;
  const [sections, parent, playlists] = await Promise.all([getLibrarySections(library.id, cursors), getPublicLibraryParent(library.parentId), listPublicPlaylistsFor({ libraryId: library.id })]);
  const path = slugHref("libraries", library.slug);
  const hasFeatured = sections.featuredArticles.length + sections.featuredVideos.length > 0;

  const hasAnything =
    hasFeatured || playlists.length + sections.articles.items.length + sections.videos.items.length + sections.children.length + sections.related.length + sections.topics.length + sections.resources.length > 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8" data-testid="library-page">
      <header className="max-w-3xl space-y-3">
        {parent ? (
          <p className="text-sm text-text-secondary">
            {strings.libraries.partOf}{" "}
            <Link href={slugHref("libraries", parent.slug)} className="text-brand underline-offset-4 hover:underline">
              {parent.name}
            </Link>
          </p>
        ) : null}
        <h1 dir="auto" className="text-start text-3xl leading-tight font-semibold md:text-4xl">
          {library.name}
        </h1>
        {library.description ? (
          <p dir="auto" className="text-start text-lg text-text-secondary">
            {library.description}
          </p>
        ) : null}
        <ViewRecorder entityType="LIBRARY" entityId={library.id} />
        <JsonLd data={collectionJsonLd({ name: library.name, description: library.description }, slugHref("libraries", library.slug))} />
      </header>

      {library.coverImage ? <img src={library.coverImage} alt="" decoding="async" className="mt-6 max-h-96 w-full rounded-2xl object-cover" /> : null}

      {library.introduction ? (
        <p dir="auto" className="mt-6 max-w-[68ch] text-start leading-loose whitespace-pre-line" data-testid="library-introduction">
          {library.introduction}
        </p>
      ) : null}

      <div className="mt-10 space-y-10">
        <ContentSection id="featured" title={strings.libraries.featured} isEmpty={!hasFeatured}>
          <div className={cardGridClass}>
            {sections.featuredArticles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
            {sections.featuredVideos.map((video) => (
              <VideoTile key={video.id} video={video} />
            ))}
          </div>
        </ContentSection>

        <ContentSection id="articles" title={strings.libraries.articles} isEmpty={sections.articles.items.length === 0}>
          <div className={cardGridClass}>
            {sections.articles.items.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
          <SectionPager param="articles" nextCursor={sections.articles.nextCursor} isPaged={Boolean(cursors.articles)} pathname={path} />
        </ContentSection>

        <ContentSection id="videos" title={strings.libraries.videos} isEmpty={sections.videos.items.length === 0}>
          <div className={cardGridClass}>
            {sections.videos.items.map((video) => (
              <VideoTile key={video.id} video={video} />
            ))}
          </div>
          <SectionPager param="videos" nextCursor={sections.videos.nextCursor} isPaged={Boolean(cursors.videos)} pathname={path} />
        </ContentSection>

        <ContentSection id="playlists" title={strings.libraries.playlists} isEmpty={playlists.length === 0}>
          <div className={cardGridClass}>
            {playlists.map((playlist) => (
              <PlaylistCard key={playlist.id} playlist={playlist} />
            ))}
          </div>
        </ContentSection>

        <ContentSection id="topics" title={strings.libraries.topics} isEmpty={sections.topics.length === 0}>
          <div className={cardGridClass}>
            {sections.topics.map((topic) => (
              <TopicCard key={topic.id} topic={topic} />
            ))}
          </div>
        </ContentSection>

        <ContentSection id="children" title={strings.libraries.children} isEmpty={sections.children.length === 0}>
          <div className={cardGridClass}>
            {sections.children.map((child) => (
              <LibraryCard key={child.id} library={child} />
            ))}
          </div>
        </ContentSection>

        <ContentSection id="related" title={strings.libraries.related} isEmpty={sections.related.length === 0}>
          <div className={cardGridClass}>
            {sections.related.map((item) => (
              <LibraryCard key={item.id} library={item} />
            ))}
          </div>
        </ContentSection>

        <ContentSection id="resources" title={strings.libraries.resources} isEmpty={sections.resources.length === 0}>
          <div className={cardGridClass}>
            {sections.resources.map((resource) => (
              <ResourceCard key={resource.id} resource={resource} />
            ))}
          </div>
        </ContentSection>

        {hasAnything ? null : <StateMessage icon={Library} title={strings.libraries.nothingYet} />}
      </div>
    </div>
  );
}
