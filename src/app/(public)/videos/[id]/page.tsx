import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArticleCard } from "@/components/knowledge/content-cards";
import { JsonLd } from "@/components/shared/json-ld";
import { VideoWatch } from "@/components/video/video-watch";
import { strings } from "@/config/strings.ar";
import { listPublishedArticlesForVideo } from "@/features/articles/articles.service";
import { getPublicVideo } from "@/features/shorts/feed.service";
import { metaDescription, videoJsonLd } from "@/lib/seo";

interface PageProps {
  params: Promise<{ id: string }>;
}

const loadVideo = cache(getPublicVideo);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const video = await loadVideo((await params).id);
  if (!video) return {};
  const description = metaDescription(video.description);
  return {
    title: video.title,
    description,
    alternates: { canonical: `/videos/${video.id}` },
    openGraph: { type: "video.other", title: video.title, description, images: video.thumbnailUrl ? [video.thumbnailUrl] : undefined },
  };
}

export default async function VideoPage({ params }: PageProps) {
  const video = await loadVideo((await params).id);
  if (!video) notFound();

  const articles = await listPublishedArticlesForVideo(video.id);

  return (
    <>
    <JsonLd data={videoJsonLd(video)} />
    <VideoWatch
      video={video}
      related={
        articles.length ? (
          <section aria-labelledby="video-articles" className="pt-3" data-testid="video-articles">
            <h2 id="video-articles" className="mb-3 text-base font-semibold">
              {strings.articles.relatedArticlesOnVideo}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {articles.map((article) => (
                <ArticleCard key={article.id} article={article} />
              ))}
            </div>
          </section>
        ) : null
      }
    />
    </>
  );
}
