import { ListVideo } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArticleCard, cardGridClass, ContentSection, PlaylistCard, slugHref, TopicCard } from "@/components/knowledge/content-cards";
import { PlaylistExperience } from "@/components/playlists/playlist-experience";
import { ContentActions } from "@/components/knowledge/content-actions";
import { ViewRecorder } from "@/components/knowledge/view-recorder";
import { JsonLd } from "@/components/shared/json-ld";
import { StateMessage } from "@/components/shared/state-message";
import { collectionJsonLd } from "@/lib/seo";
import { strings } from "@/config/strings.ar";
import { getPlaylistConnections, getPublishedPlaylistBySlug } from "@/features/playlists/playlists.service";
import { pickThumbnailUrl } from "@/lib/youtube/normalize";

interface PageProps {
  params: Promise<{ slug: string }>;
}

const loadPlaylist = cache(getPublishedPlaylistBySlug);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const data = await loadPlaylist((await params).slug);
  if (!data) return {};
  const { playlist } = data;
  const description = playlist.description?.slice(0, 160) ?? undefined;
  const image = playlist.coverImage ?? pickThumbnailUrl(playlist.thumbnails);
  return { title: playlist.title, description, alternates: { canonical: slugHref("playlists", playlist.slug) }, openGraph: { title: playlist.title, description, images: image ? [image] : undefined } };
}

export default async function PlaylistPage({ params }: PageProps) {
  const data = await loadPlaylist((await params).slug);
  if (!data) notFound();
  const { playlist, items } = data;

  const connections = await getPlaylistConnections(playlist.id);
  const path = slugHref("playlists", playlist.slug);
  const isYouTube = playlist.type === "YOUTUBE";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8" data-testid="playlist-page">
      <header className="mb-6 max-w-3xl space-y-3">
        <h1 dir="auto" className="text-start text-3xl leading-tight font-semibold">
          {playlist.title}
        </h1>
        {/* A YouTube playlist's channel is credited as its source. A curated one mixes channels, credited per item. */}
        <p className="text-sm text-text-secondary" data-testid="playlist-source">
          {isYouTube ? (
            <>
              {playlist.channelTitle ? (
                <>
                  <bdi className="font-medium text-text-primary">{playlist.channelTitle}</bdi> ·{" "}
                </>
              ) : null}
              {strings.playlists.youtubeSource}
            </>
          ) : (
            strings.playlists.curatedSource
          )}
        </p>
        {playlist.introduction ? (
          <p dir="auto" className="text-start text-lg leading-relaxed whitespace-pre-line" data-testid="playlist-introduction">
            {playlist.introduction}
          </p>
        ) : null}
        {playlist.description ? (
          <p dir="auto" className="line-clamp-6 text-start text-sm whitespace-pre-line text-text-secondary">
            {playlist.description}
          </p>
        ) : null}
        <ContentActions entityType="PLAYLIST" entityId={playlist.id} path={path} title={playlist.title} testId="playlist-actions" />
        <ViewRecorder entityType="PLAYLIST" entityId={playlist.id} />
        <JsonLd data={collectionJsonLd({ name: playlist.title, description: playlist.description }, path)} />
      </header>

      {items.length ? (
        <PlaylistExperience playlistId={playlist.id} youtubePlaylistId={isYouTube ? playlist.youtubePlaylistId : null} path={path} items={items} />
      ) : (
        <StateMessage icon={ListVideo} title={strings.playlists.nothingYet} />
      )}

      <div className="mt-12 space-y-10">
        <ContentSection id="playlist-articles" title={strings.playlists.relatedArticles} isEmpty={connections.articles.length === 0}>
          <div className={cardGridClass}>
            {connections.articles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        </ContentSection>

        <ContentSection id="playlist-topics" title={strings.playlists.relatedTopics} isEmpty={connections.topics.length === 0}>
          <div className={cardGridClass}>
            {connections.topics.map((topic) => (
              <TopicCard key={topic.id} topic={topic} />
            ))}
          </div>
        </ContentSection>

        <ContentSection id="playlist-related" title={strings.playlists.relatedPlaylists} isEmpty={connections.related.length === 0}>
          <div className={cardGridClass}>
            {connections.related.map((related) => (
              <PlaylistCard key={related.id} playlist={related} />
            ))}
          </div>
        </ContentSection>

        <ContentSection id="playlist-libraries" title={strings.playlists.libraries} isEmpty={connections.libraries.length === 0}>
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
  );
}
