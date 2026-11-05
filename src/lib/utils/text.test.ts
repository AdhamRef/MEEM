import { describe, expect, it } from "vitest";
import { clientAddress } from "@/lib/rate-limit";
import { buildSearchText, normalizeArabicForSearch } from "@/lib/search/normalize";
import { decodeSlugParam, isValidSlug, slugify } from "@/lib/slug";

describe("slugify", () => {
  it.each([
    ["القرآن وعلومه", "القرآن-وعلومه"],
    ["  الدفاع   عن  الإسلام  ", "الدفاع-عن-الإسلام"],
    ["السِّيرة النَّبويَّة", "السيرة-النبوية"],
    ["الصـــلاة", "الصلاة"],
    ["Quran & Sciences!", "quran-sciences"],
    ["العقيدة: مدخل (١)", "العقيدة-مدخل-١"],
  ])("%s becomes %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("gives an empty result when nothing usable remains", () => {
    expect(slugify("!!! ---")).toBe("");
  });
});

describe("isValidSlug", () => {
  it("accepts slugs in storage form", () => {
    expect(isValidSlug("القرآن-وعلومه")).toBe(true);
    expect(isValidSlug("topic-1")).toBe(true);
  });

  it.each(["", "has space", "-leading", "trailing-", "UPPER", "a/b", "../etc", "<script>", "ا".repeat(121)])("rejects %s", (slug) => {
    expect(isValidSlug(slug)).toBe(false);
  });
});

describe("decodeSlugParam", () => {
  it("decodes percent-encoded Arabic", () => {
    expect(decodeSlugParam(encodeURIComponent("القرآن-وعلومه"))).toBe("القرآن-وعلومه");
  });

  it("accepts an already decoded value", () => {
    expect(decodeSlugParam("الفقه")).toBe("الفقه");
  });

  it("treats different Unicode forms of one word as the same slug", () => {
    expect(decodeSlugParam("الإسلام".normalize("NFD"))).toBe("الإسلام".normalize("NFC"));
  });

  it.each(["%E0%A4%A", "..%2F..%2Fetc", "a%20b", "%3Cscript%3E"])("returns null for %s", (raw) => {
    expect(decodeSlugParam(raw)).toBeNull();
  });
});

describe("normalizeArabicForSearch", () => {
  it.each([
    ["أحكام", "احكام"],
    ["إسلام", "اسلام"],
    ["آية", "ايه"],
    ["موسى", "موسي"],
    ["صلاة", "صلاه"],
    ["مُحَمَّد", "محمد"],
    ["الصـــلاة", "الصلاه"],
    ["Quran  101!", "quran 101"],
  ])("%s becomes %s", (input, expected) => {
    expect(normalizeArabicForSearch(input)).toBe(expected);
  });

  it("leaves letters with distinct meanings alone", () => {
    expect(normalizeArabicForSearch("ذهب")).not.toBe(normalizeArabicForSearch("دهب"));
    expect(normalizeArabicForSearch("سيف")).not.toBe(normalizeArabicForSearch("صيف"));
  });
});

describe("buildSearchText", () => {
  it("stores words with and without the definite article", () => {
    expect(buildSearchText(["الصلاة"]).split(" ")).toEqual(["الصلاه", "صلاه"]);
  });

  it("doesn't damage short words that merely start like the article", () => {
    expect(buildSearchText(["الم"]).split(" ")).toEqual(["الم"]);
  });

  it("removes repeats and skips empty parts", () => {
    expect(buildSearchText(["فقه", null, undefined, "فقه", ""])).toBe("فقه");
  });
});

describe("clientAddress", () => {
  it("prefers the address the proxy set", () => {
    expect(clientAddress(new Headers({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
  });

  it("takes the rightmost forwarded entry, because a client can write the ones before it", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "6.6.6.6, 2.2.2.2" }))).toBe("2.2.2.2");
  });

  it("has a fallback when there's no proxy", () => {
    expect(clientAddress(new Headers())).toBe("unknown");
  });
});
