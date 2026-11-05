import { serializeJsonLd } from "@/lib/seo";

/**
 * The one use of raw output in the application, and not for article content: JSON has to reach
 * search engines unescaped. serializeJsonLd makes it safe, and browsers don't run this type.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
