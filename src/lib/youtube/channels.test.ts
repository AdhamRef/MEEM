import { describe, expect, it } from "vitest";
import { parseChannelInput } from "./channels";

const ID = "UCabcdefghijklmnopqrstuv";

describe("parseChannelInput", () => {
  it.each([
    [ID, { kind: "id", value: ID }],
    [`https://www.youtube.com/channel/${ID}`, { kind: "id", value: ID }],
    [`https://www.youtube.com/channel/${ID}/videos`, { kind: "id", value: ID }],
    ["@channel_name", { kind: "handle", value: "@channel_name" }],
    ["channel_name", { kind: "handle", value: "@channel_name" }],
    ["https://www.youtube.com/@channel.name", { kind: "handle", value: "@channel.name" }],
    ["https://m.youtube.com/@channel/shorts", { kind: "handle", value: "@channel" }],
    ["youtube.com/@channel", { kind: "handle", value: "@channel" }],
    ["https://www.youtube.com/@%D9%82%D9%86%D8%A7%D8%A9", { kind: "handle", value: "@قناة" }],
    ["@قناة_عربية", { kind: "handle", value: "@قناة_عربية" }],
    ["https://www.youtube.com/user/oldname", { kind: "username", value: "oldname" }],
    ["  @channel  ", { kind: "handle", value: "@channel" }],
    ["https://www.youtube.com/c/SomeName", { kind: "legacy" }],
  ])("reads %s", (input, expected) => {
    expect(parseChannelInput(input)).toEqual(expected);
  });

  it.each([
    ["a lookalike host", "https://youtube.com.evil.example/@channel"],
    ["another site", "https://example.org/@channel"],
    ["a script address", "javascript:alert(1)"],
    ["a video address", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["a playlist address", "https://www.youtube.com/playlist?list=PLabc"],
    ["a bad channel ID", "https://www.youtube.com/channel/notvalid"],
    ["a short handle", "@ab"],
    ["spaces", "some channel name"],
    ["injected text", "@channel&key=stolen"],
    ["nothing", ""],
  ])("rejects %s", (_name, input) => {
    expect(parseChannelInput(input)).toBeNull();
  });
});
