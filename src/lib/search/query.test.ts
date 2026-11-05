import { describe, expect, it } from "vitest";
import { buildSearchText, normalizeArabicForSearch } from "./normalize";
import { mergeRanked, parseSearchTerms, titleMatchesQuery } from "./query";

/** Whether a query finds text, using the same token match MongoDB's text index performs. */
function finds(query: string, stored: string): boolean {
  const terms = parseSearchTerms(query);
  if (!terms) return false;
  const tokens = new Set(buildSearchText([stored]).split(" "));
  return terms.textQuery.split(" ").some((term) => tokens.has(term));
}

describe("Arabic spelling variants find the same content", () => {
  it.each([
    ["الصلاة", "صلاة الفجر"],
    ["صلاة", "أحكام الصلاة"],
    ["صلاه", "فضل الصلاة"],
    ["اسلام", "تاريخ الإسلام"],
    ["الإسلام", "اسلام"],
    ["احكام", "أحكام الصيام"],
    ["قران", "علوم القرآن"],
    ["موسى", "قصة موسي"],
    ["مُحَمَّد", "سيرة محمد"],
    ["الصـــلاة", "الصلاة"],
    ["رحمة", "الرحمه"],
    ["کتاب", "كتاب التوحيد"],
    ["ﷺ", "صلى الله عليه وسلم"],
    ["الدرس ٣", "الدرس 3"],
    ["الحج", "حج التمتع"],
    ["حج", "مناسك الحج"],
  ])("%s finds %s", (query, stored) => {
    expect(finds(query, stored)).toBe(true);
  });
});

describe("meaningful distinctions survive", () => {
  it.each([
    ["ذهب", "دهب"],
    ["سيف", "صيف"],
    ["قلب", "كلب"],
    ["حلم", "علم"],
    ["مسئول", "مسؤول"],
  ])("%s does not find %s", (query, stored) => {
    expect(finds(query, stored)).toBe(false);
  });

  it("does not turn الله into the common word له", () => {
    expect(finds("الله", "قال له")).toBe(false);
    expect(finds("له", "اسم الله")).toBe(false);
    expect(finds("اللهم", "لهم أجرهم")).toBe(false);
    expect(buildSearchText(["الله"])).toBe("الله");
  });

  it("does not strip conjunctions, so parents don't become religion", () => {
    expect(finds("دين", "بر الوالدين")).toBe(false);
    expect(finds("دين", "الدين")).toBe(true);
  });
});

describe("parseSearchTerms", () => {
  it("refuses queries with nothing to search for", () => {
    expect(parseSearchTerms("")).toBeNull();
    expect(parseSearchTerms("   ")).toBeNull();
    expect(parseSearchTerms("!!!")).toBeNull();
    expect(parseSearchTerms("ص")).toBeNull();
  });

  it("removes characters $text would treat as operators", () => {
    expect(parseSearchTerms('-الصلاة "الفجر"')?.textQuery).toBe("الصلاه صلاه الفجر فجر");
  });

  it("drops particles when other words remain", () => {
    expect(parseSearchTerms("الصلاة في الإسلام")?.words).toEqual(["الصلاه", "الاسلام"]);
  });

  it("keeps particles when nothing else remains", () => {
    expect(parseSearchTerms("في")?.words).toEqual(["في"]);
  });

  it("keeps the name علي, even though it's the same as على once normalised", () => {
    expect(parseSearchTerms("علي بن أبي طالب")?.words).toContain("علي");
  });

  it("doesn't repeat words", () => {
    expect(parseSearchTerms("صلاة صلاة")?.textQuery).toBe("صلاه");
  });
});

describe("titleMatchesQuery", () => {
  const title = normalizeArabicForSearch;

  it("matches when the query is the title, with or without the article", () => {
    expect(titleMatchesQuery(title("الزكاة"), ["زكاه"])).toBe(true);
    expect(titleMatchesQuery(title("زكاة"), ["الزكاه"])).toBe(true);
  });

  it("matches when the title is part of a longer query", () => {
    expect(titleMatchesQuery(title("الزكاة"), ["احكام", "الزكاه"])).toBe(true);
  });

  it("matches when the query is part of a longer title", () => {
    expect(titleMatchesQuery(title("أحكام الزكاة"), ["الزكاه"])).toBe(true);
  });

  it("doesn't match when they only share one word of several", () => {
    expect(titleMatchesQuery(title("أحكام الزكاة"), ["احكام", "الصيام"])).toBe(false);
  });

  it("doesn't match empty input", () => {
    expect(titleMatchesQuery("", ["زكاه"])).toBe(false);
    expect(titleMatchesQuery(title("الزكاة"), [])).toBe(false);
  });
});

describe("mergeRanked", () => {
  it("keeps direct matches first and repeats nothing", () => {
    expect(mergeRanked(["a", "b"], ["c", "a"])).toEqual(["a", "b", "c"]);
  });
});
