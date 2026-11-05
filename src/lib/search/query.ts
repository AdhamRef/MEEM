import { normalizeArabicForSearch, wordForms } from "./normalize";

const MIN_QUERY_LENGTH = 2;

/**
 * With no stop words in the index, "في" alone would match nearly everything. These are dropped
 * from a query that has other words. "علي" stays, because normalising makes "على" the same as
 * the name, and losing the name would be worse than a few extra results.
 */
const PARTICLES = new Set(["في", "من", "عن", "الي", "ما", "ماذا", "هل", "و", "او", "ثم", "ان", "هو", "هي", "هذا", "هذه", "ذلك", "مع", "كيف", "لماذا", "لا", "قد", "التي", "الذي"]);

export interface SearchTerms {
  /** The words to look for, without their alternative forms. */
  words: string[];
  /** What MongoDB receives. Normalising has removed the characters $text treats as operators. */
  textQuery: string;
}

/** Null when there's nothing worth searching for. */
export function parseSearchTerms(rawQuery: string): SearchTerms | null {
  const normalized = normalizeArabicForSearch(rawQuery);
  if (normalized.length < MIN_QUERY_LENGTH) return null;

  const allWords = normalized.split(" ");
  const meaningful = allWords.filter((word) => !PARTICLES.has(word));
  const words = [...new Set(meaningful.length ? meaningful : allWords)];
  return { words, textQuery: [...new Set(words.flatMap(wordForms))].join(" ") };
}

const coreWord = (word: string) => wordForms(word).at(-1) as string;

/**
 * Whether a topic or category is what the person typed, rather than one that happens to
 * mention a word in its description. Only then does its content count as a result (§17).
 */
export function titleMatchesQuery(normalizedTitle: string, words: string[]): boolean {
  const titleWords = normalizedTitle.split(" ").filter(Boolean).map(coreWord);
  if (titleWords.length === 0 || words.length === 0) return false;
  const queryWords = words.map(coreWord);
  return queryWords.every((word) => titleWords.includes(word)) || titleWords.every((word) => queryWords.includes(word));
}

/** Direct matches come first, in relevance order, followed by what's connected to a match. */
export function mergeRanked(direct: string[], linked: string[]): string[] {
  return [...new Set([...direct, ...linked])];
}
