import { publicContentFilter } from "@/features/content/common";
import { publicPlaylistFilter } from "@/features/playlists/playlist-filters";
import { publicVideoFilter } from "@/features/shorts/video-cards";
import { prisma } from "@/lib/prisma";

/** The most one sitemap file may list. Past that, the newest entries are kept. */
const MAX_ENTRIES = 50_000;

export const SITEMAP_SECTIONS = ["pages", "articles", "topics", "libraries", "playlists", "resources", "videos"] as const;
export type SitemapSection = (typeof SITEMAP_SECTIONS)[number];

export interface SitemapEntry {
  path: string;
  lastModified?: Date;
}

const STATIC_PAGES = ["/", "/explore", "/topics", "/libraries", "/playlists", "/privacy", "/terms"];
const slugPath = (base: string, slug: string) => `/${base}/${encodeURIComponent(slug)}`;
const common = { orderBy: { updatedAt: "desc" as const }, take: MAX_ENTRIES };

/** Public content only, reusing the filters every public page uses, and only the fields needed. */
export async function listSitemapEntries(section: SitemapSection): Promise<SitemapEntry[]> {
  const bySlug = (base: string, rows: { slug: string; updatedAt: Date }[]) => rows.map((row) => ({ path: slugPath(base, row.slug), lastModified: row.updatedAt }));
  const select = { slug: true, updatedAt: true };

  switch (section) {
    case "pages":
      return STATIC_PAGES.map((path) => ({ path }));
    case "articles":
      return bySlug("articles", await prisma.article.findMany({ ...common, where: publicContentFilter, select }));
    case "topics":
      return bySlug("topics", await prisma.topic.findMany({ ...common, where: publicContentFilter, select }));
    case "libraries":
      return bySlug("libraries", await prisma.library.findMany({ ...common, where: publicContentFilter, select }));
    case "playlists":
      return bySlug("playlists", await prisma.playlist.findMany({ ...common, where: publicPlaylistFilter, select }));
    case "resources":
      return bySlug("resources", await prisma.externalResource.findMany({ ...common, where: publicContentFilter, select }));
    case "videos": {
      const rows = await prisma.video.findMany({ ...common, where: publicVideoFilter, select: { id: true, kind: true, updatedAt: true } });
      return rows.map((row) => ({ path: `/${row.kind === "SHORT" ? "shorts" : "videos"}/${row.id}`, lastModified: row.updatedAt }));
    }
  }
}
