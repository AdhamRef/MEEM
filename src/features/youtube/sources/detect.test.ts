import { describe, expect, it } from "vitest";
import { detectSourceInput, MAX_VIDEOS_PER_PASTE } from "./detect";

const VIDEO = "dQw4w9WgXcQ";
const PLAYLIST = "PLabcdefghijklmnopqrstuvwxyz012345";
const CHANNEL = "UCabcdefghijklmnopqrstuv";

describe("detectSourceInput", () => {
  it.each([
    ["@channel", { kind: "channel", reference: { kind: "handle", value: "@channel" } }],
    ["https://www.youtube.com/@channel", { kind: "channel", reference: { kind: "handle", value: "@channel" } }],
    ["youtube.com/@channel/videos", { kind: "channel", reference: { kind: "handle", value: "@channel" } }],
    [`https://www.youtube.com/channel/${CHANNEL}`, { kind: "channel", reference: { kind: "id", value: CHANNEL } }],
    [CHANNEL, { kind: "channel", reference: { kind: "id", value: CHANNEL } }],
  ])("reads %s as a channel", (input, expected) => {
    expect(detectSourceInput(input)).toEqual(expected);
  });

  it("asks for a handle when given an old /c/ address", () => {
    expect(detectSourceInput("https://www.youtube.com/c/OldName")).toEqual({ kind: "legacyChannel" });
  });

  it.each([`https://www.youtube.com/playlist?list=${PLAYLIST}`, PLAYLIST])("reads %s as a playlist", (input) => {
    expect(detectSourceInput(input)).toEqual({ kind: "playlist", youtubePlaylistId: PLAYLIST });
  });

  it.each([`https://www.youtube.com/watch?v=${VIDEO}`, `https://youtu.be/${VIDEO}`, `https://www.youtube.com/shorts/${VIDEO}`, VIDEO])("reads %s as a video", (input) => {
    expect(detectSourceInput(input)).toEqual({ kind: "videos", youtubeVideoIds: [VIDEO] });
  });

  it("treats a watch link inside a playlist as the video, not the whole list", () => {
    expect(detectSourceInput(`https://www.youtube.com/watch?v=${VIDEO}&list=${PLAYLIST}`)).toEqual({ kind: "videos", youtubeVideoIds: [VIDEO] });
  });

  it("accepts several video links at once, one per line, without repeats", () => {
    const other = "abcdefghijk";
    expect(detectSourceInput(`https://youtu.be/${VIDEO}\nhttps://youtu.be/${other}\n${VIDEO}`)).toEqual({ kind: "videos", youtubeVideoIds: [VIDEO, other] });
  });

  it("refuses a mix of a channel and videos, and anything not from YouTube", () => {
    expect(detectSourceInput(`@channel\nhttps://youtu.be/${VIDEO}`)).toEqual({ kind: "invalid" });
    expect(detectSourceInput(`https://evil.example/watch?v=${VIDEO}`)).toEqual({ kind: "invalid" });
    expect(detectSourceInput("   ")).toEqual({ kind: "invalid" });
  });

  it("limits how many videos one paste can hold", () => {
    const many = Array.from({ length: MAX_VIDEOS_PER_PASTE + 1 }, (_, index) => `https://youtu.be/v${String(index).padStart(10, "0")}`).join("\n");
    expect(detectSourceInput(many)).toEqual({ kind: "invalid" });
  });
});
