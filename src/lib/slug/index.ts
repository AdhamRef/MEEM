const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

/**
 * Builds a URL slug. Arabic letters stay as they are, because slugs are meant to read as
 * Arabic. Marks and elongation are removed so the same title always gives the same slug.
 */
export function slugify(text: string): string {
  return text
    .normalize("NFC")
    .replace(ARABIC_MARKS, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/** A slug in storage form. Rejects anything slugify would have changed. */
export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 120 && slugify(slug) === slug;
}

/**
 * Route params can arrive percent-encoded. Every page reading a slug goes through this, so
 * lookups and canonical URLs agree. Returns null when the value isn't a usable slug.
 */
export function decodeSlugParam(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const normalized = decoded.normalize("NFC");
  return isValidSlug(normalized) ? normalized : null;
}
