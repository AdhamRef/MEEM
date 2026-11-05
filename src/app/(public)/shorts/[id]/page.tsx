import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { ShortsFeed } from "@/components/feed/shorts-feed";
import { JsonLd } from "@/components/shared/json-ld";
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
    alternates: { canonical: `/shorts/${video.id}` },
    openGraph: { type: "video.other", title: video.title, description, images: video.thumbnailUrl ? [video.thumbnailUrl] : undefined },
  };
}

/** A shareable Short, opening the feed at this video. */
export default async function ShortPage({ params }: PageProps) {
  const { id } = await params;
  const video = await loadVideo(id);
  if (!video) notFound();
  if (video.kind !== "SHORT") redirect(`/videos/${video.id}`);

  return (
    <>
      <JsonLd data={videoJsonLd(video)} />
      <h1 className="sr-only" dir="auto">
        {video.title}
      </h1>
      <ShortsFeed initialVideo={video} />
    </>
  );
}
