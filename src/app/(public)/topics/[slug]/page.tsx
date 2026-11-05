/* eslint-disable @next/next/no-img-element -- Covers are resized on upload, and their host depends on the storage provider. */
import { LayoutGrid } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArticleCard, cardGridClass, ContentSection, LibraryCard, PlaylistCard, ResourceCard, SectionPager, ShortsStrip, slugHref, TopicCard, VideoTile } from "@/components/knowledge/content-cards";
import { ContentActions } from "@/components/knowledge/content-actions";
import { ViewRecorder } from "@/components/knowledge/view-recorder";
import { JsonLd } from "@/components/shared/json-ld";
import { StateMessage } from "@/components/shared/state-message";
import { collectionJsonLd } from "@/lib/seo";
import { strings } from "@/config/strings.ar";
import { listPublicPlaylistsFor } from "@/features/playlists/playlists.service";
import { getPublishedTopicBySlug, getTopicSections } from "@/features/topics/topics.service";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ shorts?: string; videos?: string; articles?: string; resources?: string }>;
}

const loadTopic = cache(getPublishedTopicBySlug);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const topic = await loadTopic((await params).slug);
  if (!topic) return {};
  const description = topic.introduction ?? topic.description?.slice(0, 160) ?? undefined;
  return { title: topic.title, description, alternates: { canonical: slugHref("topics", topic.slug) }, openGraph: { title: topic.title, description, images: topic.coverImage ? [topic.coverImage] : undefined } };
}

export default async function TopicPage({ params, searchParams }: PageProps) {
  const topic = await loadTopic((await params).slug);
  if (!topic) notFound();

  const cursors = await searchParams;
  const [sections, playlists] = await Promise.all([getTopicSections(topic.id, topic.parentId, cursors), listPublicPlaylistsFor({ topicId: topic.id })]);
  const path = slugHref("topics", topic.slug);

  const hasAnything =
    playlists.length + sections.shorts.items.length + sections.videos.items.length + sections.articles.items.length + sections.resources.items.length + sections.children.length + sections.related.length + sections.complementary.length + sections.libraries.length >
    0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8" data-testid="topic-page">
      <header className="max-w-3xl space-y-3">
        {sections.parent ? (
          <p className="text-sm text-text-secondary">
            {strings.topics.partOf}{" "}
            <Link href={slugHref("topics", sections.parent.slug)} className="text-brand underline-offset-4 hover:underline">
              {sections.parent.title}
            </Link>
          </p>
        ) : null}
        <h1 dir="auto" className="text-start text-3xl leading-tight font-semibold md:text-4xl">
          {topic.title}
        </h1>
        {topic.introduction ? (
          <p dir="auto" className="text-start text-lg text-text-secondary">
            {topic.introduction}
          </p>
        ) : null}
        <ContentActions entityType="TOPIC" entityId={topic.id} path={path} title={topic.title} testId="topic-actions" />
        <ViewRecorder entityType="TOPIC" entityId={topic.id} />
        <JsonLd data={collectionJsonLd({ name: topic.title, description: topic.introduction }, path)} />
      </header>

      {topic.coverImage ? <img src={topic.coverImage} alt="" decoding="async" className="mt-6 max-h-96 w-full rounded-2xl object-cover" /> : null}

      {topic.description ? (
        <p dir="auto" className="mt-6 max-w-[68ch] text-start leading-loose whitespace-pre-line">
          {topic.description}
        </p>
      ) : null}

      <div className="mt-10 space-y-10">
        <ContentSection id="shorts" title={strings.topics.shorts} isEmpty={sections.shorts.items.length === 0}>
          <ShortsStrip videos={sections.shorts.items} />
          <SectionPager param="shorts" nextCursor={sections.shorts.nextCursor} isPaged={Boolean(cursors.shorts)} pathname={path} />
        </ContentSection>

        <ContentSection id="articles" title={strings.topics.articles} isEmpty={sections.articles.items.length === 0}>
          <div className={cardGridClass}>
            {sections.articles.items.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
          <SectionPager param="articles" nextCursor={sections.articles.nextCursor} isPaged={Boolean(cursors.articles)} pathname={path} />
        </ContentSection>

        <ContentSection id="videos" title={strings.topics.videos} isEmpty={sections.videos.items.length === 0}>
          <div className={cardGridClass}>
            {sections.videos.items.map((video) => (
              <VideoTile key={video.id} video={video} />
            ))}
          </div>
          <SectionPager param="videos" nextCursor={sections.videos.nextCursor} isPaged={Boolean(cursors.videos)} pathname={path} />
        </ContentSection>

        <ContentSection id="playlists" title={strings.topics.playlists} isEmpty={playlists.length === 0}>
          <div className={cardGridClass}>
            {playlists.map((playlist) => (
              <PlaylistCard key={playlist.id} playlist={playlist} />
            ))}
          </div>
        </ContentSection>

        <ContentSection id="children" title={strings.topics.children} isEmpty={sections.children.length === 0}>
          <div className={cardGridClass}>
            {sections.children.map((child) => (
              <TopicCard key={child.id} topic={child} />
            ))}
          </div>
        </ContentSection>

        <ContentSection id="related" title={strings.topics.related} isEmpty={sections.related.length === 0}>
          <div className={cardGridClass}>
            {sections.related.map((item) => (
              <TopicCard key={item.id} topic={item} />
            ))}
          </div>
        </ContentSection>

        <ContentSection id="complementary" title={strings.topics.complementary} isEmpty={sections.complementary.length === 0}>
          <div className={cardGridClass}>
            {sections.complementary.map((item) => (
              <TopicCard key={item.id} topic={item} />
            ))}
          </div>
        </ContentSection>

        <ContentSection id="libraries" title={strings.topics.libraries} isEmpty={sections.libraries.length === 0}>
          <div className={cardGridClass}>
            {sections.libraries.map((library) => (
              <LibraryCard key={library.id} library={library} />
            ))}
          </div>
        </ContentSection>

        <ContentSection id="resources" title={strings.topics.resources} isEmpty={sections.resources.items.length === 0}>
          <div className={cardGridClass}>
            {sections.resources.items.map((resource) => (
              <ResourceCard key={resource.id} resource={resource} />
            ))}
          </div>
          <SectionPager param="resources" nextCursor={sections.resources.nextCursor} isPaged={Boolean(cursors.resources)} pathname={path} />
        </ContentSection>

        {hasAnything ? null : <StateMessage icon={LayoutGrid} title={strings.topics.nothingYet} />}
      </div>
    </div>
  );
}
