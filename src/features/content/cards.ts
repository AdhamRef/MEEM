import type { Prisma } from "@prisma/client";

/** Only what public cards show, so editorial fields and staff data never travel with them. */
export const articleCardSelect = {
  id: true,
  title: true,
  slug: true,
  excerpt: true,
  coverImage: true,
  readingMinutes: true,
  publishedAt: true,
} satisfies Prisma.ArticleSelect;
export type ArticleCardData = Prisma.ArticleGetPayload<{ select: typeof articleCardSelect }>;

export const topicCardSelect = { id: true, title: true, slug: true, introduction: true, coverImage: true, isFeatured: true } satisfies Prisma.TopicSelect;
export type TopicCardData = Prisma.TopicGetPayload<{ select: typeof topicCardSelect }>;

export const libraryCardSelect = { id: true, name: true, slug: true, description: true, coverImage: true, isFeatured: true } satisfies Prisma.LibrarySelect;
export type LibraryCardData = Prisma.LibraryGetPayload<{ select: typeof libraryCardSelect }>;

export const resourceCardSelect = { id: true, title: true, slug: true, description: true, sourceName: true, url: true, coverImage: true } satisfies Prisma.ExternalResourceSelect;
export type ResourceCardData = Prisma.ExternalResourceGetPayload<{ select: typeof resourceCardSelect }>;
