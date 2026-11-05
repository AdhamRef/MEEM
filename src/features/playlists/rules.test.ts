import { describe, expect, it } from "vitest";
import { parseYouTubePlaylistId } from "@/lib/youtube/ids";
import { formatDuration, isWatchComplete, moveItem, resumePosition, validateReorder } from "./rules";

describe("validateReorder", () => {
  it("accepts the same items in a new order", () => {
    expect(validateReorder(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });
  it.each([
    ["a missing item", ["a", "b"]],
    ["an unknown item", ["a", "b", "x"]],
    ["a repeated item", ["a", "b", "b"]],
    ["an extra item", ["a", "b", "c", "d"]],
    ["nothing", []],
  ])("rejects %s, so a stale screen can't lose anything", (_name, ordered) => {
    expect(validateReorder(["a", "b", "c"], ordered)).toBeNull();
  });
});

describe("moveItem", () => {
  it("moves up and down without changing the original", () => {
    const items = ["a", "b", "c", "d"];
    expect(moveItem(items, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(items, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(items).toEqual(["a", "b", "c", "d"]);
  });
  it.each([
    [1, 1],
    [-1, 0],
    [0, 4],
  ])("leaves the list alone for a move from %i to %i", (from, to) => {
    expect(moveItem(["a", "b", "c"], from, to)).toEqual(["a", "b", "c"]);
  });
});

describe("watch rules", () => {
  it("counts the end of a video, or nearly all of it, as complete", () => {
    expect(isWatchComplete(10, 600, true)).toBe(true);
    expect(isWatchComplete(570, 600, false)).toBe(true);
    expect(isWatchComplete(569, 600, false)).toBe(false);
  });
  it("can't call something complete with no known length", () => {
    expect(isWatchComplete(1000, null, false)).toBe(false);
    expect(isWatchComplete(1000, 0, false)).toBe(false);
  });
  it("offers to resume only part-way through", () => {
    expect(resumePosition({ positionSeconds: 120, isCompleted: false })).toBe(120);
    expect(resumePosition({ positionSeconds: 4, isCompleted: false })).toBeNull();
    expect(resumePosition({ positionSeconds: 120, isCompleted: true })).toBeNull();
    expect(resumePosition(null)).toBeNull();
    expect(resumePosition(undefined)).toBeNull();
  });
});

describe("formatDuration", () => {
  it.each([
    [45, "0:45"],
    [65, "1:05"],
    [3661, "1:01:01"],
  ])("formats %i seconds", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
  it("shows nothing for an unknown length, rather than a false zero", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
  });
});

describe("parseYouTubePlaylistId", () => {
  const id = "PLabcdefghijklmnop_-123456";

  it.each([
    [id],
    [`https://www.youtube.com/playlist?list=${id}`],
    [`https://youtube.com/playlist?list=${id}&si=abc`],
    [`https://m.youtube.com/playlist?list=${id}`],
    [`https://music.youtube.com/playlist?list=${id}`],
    [`https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${id}&index=2`],
    [`  ${id}  `],
    ["UUabcdefghijklmnopqrstuvw"],
  ])("accepts %s", (input) => {
    expect(parseYouTubePlaylistId(input)).not.toBeNull();
  });

  it.each([
    ["a lookalike host", `https://youtube.com.evil.example/playlist?list=${id}`],
    ["another site", `https://example.org/playlist?list=${id}`],
    ["a generated mix", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ"],
    ["Watch Later", "https://www.youtube.com/playlist?list=WL"],
    ["Liked videos", "https://www.youtube.com/playlist?list=LL"],
    ["a video with no list", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["a script address", `javascript:alert('${id}')`],
    ["an injected value", `https://www.youtube.com/playlist?list=${id}%26key%3Dstolen`],
    ["text", "not a playlist"],
    ["nothing", ""],
  ])("rejects %s", (_name, input) => {
    expect(parseYouTubePlaylistId(input)).toBeNull();
  });
});
