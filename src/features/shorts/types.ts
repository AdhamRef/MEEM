/** What a client receives about a video. Stored YouTube data and resolved links only. */
export interface VideoCard {
  id: string;
  youtubeVideoId: string;
  kind: "SHORT" | "LONG_FORM";
  /** Exactly as YouTube returned it. */
  title: string;
  description: string | null;
  channelId: string | null;
  channelTitle: string | null;
  channelImageUrl: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  /** Width divided by height. Null until YouTube's reported size has been stored. */
  aspectRatio: number | null;
  /** When YouTube says it was published. Used for structured data. */
  uploadedAt: string | null;
  category: { id: string; title: string; slug: string } | null;
  topics: string[];
  cta: VideoCardCta | null;
  /** Only when statistics are enabled and YouTube returned one. Never filled in. */
  viewCount: number | null;
}

export interface VideoCardCta {
  type: "FULL_VIDEO" | "EXTERNAL_RESOURCE" | "INTERNAL_ARTICLE" | "TOPIC" | "CURATED_PLAYLIST" | "YOUTUBE_PLAYLIST";
  label: string | null;
  href: string;
  isExternal: boolean;
}

export interface FeedPage {
  items: VideoCard[];
  nextCursor: string | null;
}
