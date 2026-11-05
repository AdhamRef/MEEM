/* eslint-disable @next/next/no-img-element -- Covers are resized on upload, and their host depends on the storage provider. */
import { ExternalLink, Info } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { cardGridClass, ContentSection, LibraryCard, slugHref, TopicCard } from "@/components/knowledge/content-cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ViewRecorder } from "@/components/knowledge/view-recorder";
import { strings } from "@/config/strings.ar";
import { getPublishedResourceBySlug } from "@/features/resources/resources.service";

interface PageProps {
  params: Promise<{ slug: string }>;
}

const loadResource = cache(getPublishedResourceBySlug);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const data = await loadResource((await params).slug);
  if (!data) return {};
  return { title: data.resource.title, description: data.resource.description ?? undefined, alternates: { canonical: slugHref("resources", data.resource.slug) } };
}

/** A description and a link only. The source's content stays on its own site (§12.4). */
export default async function ResourcePage({ params }: PageProps) {
  const data = await loadResource((await params).slug);
  if (!data) notFound();
  const { resource, topics, libraries } = data;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 md:px-8" data-testid="resource-page">
      <ViewRecorder entityType="RESOURCE" entityId={resource.id} />
      <header className="space-y-3">
        <Badge variant="secondary" data-testid="external-badge">
          <ExternalLink aria-hidden />
          {strings.content.external}
        </Badge>
        <h1 dir="auto" className="text-start text-3xl leading-tight font-semibold">
          {resource.title}
        </h1>
        <p className="text-sm text-text-secondary">
          {strings.resources.from} <bdi>{resource.sourceName}</bdi>
        </p>
      </header>

      {resource.coverImage ? <img src={resource.coverImage} alt="" decoding="async" className="w-full rounded-2xl" /> : null}

      {resource.description ? (
        <p dir="auto" className="text-start leading-loose whitespace-pre-line">
          {resource.description}
        </p>
      ) : null}

      <p className="flex items-start gap-2 rounded-xl border bg-surface p-3 text-sm text-text-secondary">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        {strings.resources.notice}
      </p>

      <Button asChild data-testid="resource-open">
        <a href={resource.url} target="_blank" rel="noopener noreferrer nofollow">
          {strings.resources.open}
          <ExternalLink aria-hidden data-icon="inline-end" />
        </a>
      </Button>

      <div className="space-y-8 pt-4">
        <ContentSection id="resource-topics" title={strings.resources.topics} isEmpty={topics.length === 0}>
          <div className={cardGridClass}>
            {topics.map((topic) => (
              <TopicCard key={topic.id} topic={topic} />
            ))}
          </div>
        </ContentSection>
        <ContentSection id="resource-libraries" title={strings.resources.libraries} isEmpty={libraries.length === 0}>
          <div className={cardGridClass}>
            {libraries.map((library) => (
              <LibraryCard key={library.id} library={library} />
            ))}
          </div>
        </ContentSection>
      </div>
    </div>
  );
}
