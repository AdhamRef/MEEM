import type { MetadataRoute } from "next";
import { SITEMAP_SECTIONS } from "@/features/seo/sitemap.service";
import { absoluteUrl } from "@/lib/seo";

export const dynamic = "force-dynamic";

/** Public content is open. Private and administrative pages also say noindex themselves. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/auth/", "/account", "/saved", "/history", "/interests", "/search", "/spike", "/design-system"] },
    sitemap: SITEMAP_SECTIONS.map((section) => absoluteUrl(`/sitemap/${section}.xml`)),
  };
}
