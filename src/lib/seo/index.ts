/** Read directly, because the root layout's metadata is evaluated while building, before env validation. */
export function siteUrl(): URL {
  return new URL(process.env.APP_URL ?? "http://localhost:3000");
}

export function absoluteUrl(path: string): string {
  return new URL(path, siteUrl()).toString();
}

/** Metadata descriptions are short, and text from elsewhere can run to pages and line breaks. */
export function metaDescription(text: string | null | undefined): string | undefined {
  const flattened = text?.replace(/\s+/g, " ").trim();
  if (!flattened) return undefined;
  return flattened.length > 160 ? `${flattened.slice(0, 157)}...` : flattened;
}

type JsonLd = Record<string, unknown>;

export function articleJsonLd(article: { title: string; excerpt: string | null; coverImage: string | null; publishedAt: Date | null; updatedAt: Date; bylineName: string | null }, path: string, publisher: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title.slice(0, 110),
    description: metaDescription(article.excerpt),
    image: article.coverImage ? absoluteUrl(article.coverImage) : undefined,
    datePublished: article.publishedAt?.toISOString(),
    dateModified: article.updatedAt.toISOString(),
    author: article.bylineName ? { "@type": "Person", name: article.bylineName } : { "@type": "Organization", name: publisher },
    publisher: { "@type": "Organization", name: publisher },
    mainEntityOfPage: absoluteUrl(path),
    inLanguage: "ar",
  };
}

/**
 * Points at YouTube's own embed, because that's where the video lives. Search engines ignore
 * a video with no upload date, so without one this returns nothing rather than inventing it.
 */
export function videoJsonLd(video: { youtubeVideoId: string; title: string; description: string | null; thumbnailUrl: string | null; durationSeconds: number | null; uploadedAt: string | null }): JsonLd | null {
  if (!video.uploadedAt || !video.thumbnailUrl) return null;
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: video.title,
    description: metaDescription(video.description) ?? video.title,
    thumbnailUrl: video.thumbnailUrl,
    uploadDate: video.uploadedAt,
    duration: video.durationSeconds ? `PT${video.durationSeconds}S` : undefined,
    embedUrl: `https://www.youtube.com/embed/${video.youtubeVideoId}`,
  };
}

export function collectionJsonLd(page: { name: string; description: string | null | undefined }, path: string): JsonLd {
  return { "@context": "https://schema.org", "@type": "CollectionPage", name: page.name, description: metaDescription(page.description), url: absoluteUrl(path), inLanguage: "ar" };
}

/**
 * Text inside a script element ends at the first "</script", whatever JSON thinks. Escaping
 * every "<" means content from editors or YouTube can never close it.
 */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
