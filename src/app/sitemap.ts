import type { MetadataRoute } from "next";
import { listSitemapEntries, SITEMAP_SECTIONS, type SitemapSection } from "@/features/seo/sitemap.service";
import { absoluteUrl } from "@/lib/seo";

// Reads published content, so it must reflect the database and not the moment of the build.
export const dynamic = "force-dynamic";

export function generateSitemaps() {
  return SITEMAP_SECTIONS.map((id) => ({ id }));
}

export default async function sitemap({ id }: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const section = (await id) as SitemapSection;
  if (!SITEMAP_SECTIONS.includes(section)) return [];
  const entries = await listSitemapEntries(section);
  return entries.map((entry) => ({ url: absoluteUrl(entry.path), lastModified: entry.lastModified }));
}
