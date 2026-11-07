import { describe, expect, it } from "vitest";
import { chapterAt, extractChapters, parseTimestamp, splitDescription } from "./description";

describe("parseTimestamp", () => {
  it.each([
    ["0:00", 0],
    ["2:03", 123],
    ["12:30", 750],
    ["1:02:03", 3723],
  ])("reads %s", (text, seconds) => {
    expect(parseTimestamp(text)).toBe(seconds);
  });

  it.each(["1:60", "1:2", "abc", "1:00:60", "1:61:00"])("rejects %s", (text) => {
    expect(parseTimestamp(text)).toBeNull();
  });
});

describe("splitDescription", () => {
  it("keeps the exact text when joined back together", () => {
    const text = "مقدمة 0:00\nالدرس https://example.com/a?b=1. وفي 12:30 خلاصة";
    expect(
      splitDescription(text)
        .map((segment) => segment.text)
        .join(""),
    ).toBe(text);
  });

  it("finds timestamps and safe links", () => {
    expect(splitDescription("انظر 1:05 و https://example.com/x")).toEqual([
      { type: "text", text: "انظر " },
      { type: "time", text: "1:05", seconds: 65 },
      { type: "text", text: " و " },
      { type: "link", text: "https://example.com/x", href: "https://example.com/x" },
    ]);
  });

  it("leaves trailing punctuation outside a link", () => {
    expect(splitDescription("(https://example.com/x).")).toContainEqual({ type: "link", text: "https://example.com/x", href: "https://example.com/x" });
  });

  it("doesn't treat a ratio inside a longer number, or a time past the end, as a timestamp", () => {
    expect(splitDescription("12:30:45:10").every((segment) => segment.type === "text")).toBe(true);
    expect(splitDescription("في 10:00", 300)).toEqual([{ type: "text", text: "في 10:00" }]);
  });

  it("never links anything but http and https", () => {
    expect(splitDescription("javascript:alert(1)").every((segment) => segment.type === "text")).toBe(true);
  });
});

describe("extractChapters", () => {
  const description = "عن الدرس\n0:00 المقدمة\n1:30 - الباب الأول\n(10:05) الباب الثاني\n1:02:00 الخاتمة";

  it("reads chapters the way YouTube does", () => {
    expect(extractChapters(description)).toEqual([
      { seconds: 0, title: "المقدمة" },
      { seconds: 90, title: "الباب الأول" },
      { seconds: 605, title: "الباب الثاني" },
      { seconds: 3720, title: "الخاتمة" },
    ]);
  });

  it("needs three, starting at zero, in order", () => {
    expect(extractChapters("0:00 أ\n1:00 ب")).toEqual([]);
    expect(extractChapters("0:10 أ\n1:00 ب\n2:00 ج")).toEqual([]);
    expect(extractChapters("0:00 أ\n2:00 ب\n1:00 ج")).toEqual([]);
    expect(extractChapters(null)).toEqual([]);
  });

  it("drops chapters past the video's end", () => {
    expect(extractChapters(description, 700).map((chapter) => chapter.seconds)).toEqual([0, 90, 605]);
  });

  it("finds the chapter at a position", () => {
    const chapters = extractChapters(description);
    expect(chapterAt(chapters, 0)).toBe(0);
    expect(chapterAt(chapters, 100)).toBe(1);
    expect(chapterAt(chapters, 5000)).toBe(3);
  });
});
