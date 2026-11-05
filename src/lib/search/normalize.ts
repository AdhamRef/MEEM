const MARKS_AND_ELONGATION = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

/**
 * For search fields only. Displayed text never changes. These variants are commonly typed
 * interchangeably, while other distinctions between letters are left alone (§17).
 * NFKC also turns ligatures such as ﷺ and ﷲ into the words people type.
 */
export function normalizeArabicForSearch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(MARKS_AND_ELONGATION, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىی]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ک/g, "ك")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - PERSIAN_ZERO))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** "له" and "لهم" are common words that have nothing to do with these. */
const KEEP_THE_ARTICLE = new Set(["الله", "اللهم"]);

/** The word, and also the word without its definite article when that is a real form of it. */
export function wordForms(word: string): string[] {
  if (word.startsWith("ال") && word.length > 3 && !KEEP_THE_ARTICLE.has(word)) return [word, word.slice(2)];
  return [word];
}

/**
 * MongoDB doesn't stem Arabic, so "الصلاة" wouldn't match "صلاة". Storing both forms of
 * each word covers the definite article. Other prefixes are a known limit of this approach:
 * stripping و or ب would turn "والدين" (parents) into "دين" (religion).
 */
export function buildSearchText(parts: (string | null | undefined)[]): string {
  const words = normalizeArabicForSearch(parts.filter(Boolean).join(" ")).split(" ").filter(Boolean);
  const tokens = new Set<string>();
  for (const word of words) {
    for (const form of wordForms(word)) tokens.add(form);
  }
  return [...tokens].join(" ");
}
