import { describe, expect, it } from "vitest";
import { isValidVideoId, parseYouTubeVideoId, youtubeWatchUrl } from "./ids";
import { classifyByDuration, normalizeVideo, parseIsoDuration, pickThumbnailUrl } from "./normalize";
import { pacificDay } from "./quota";

const ID = "dQw4w9WgXcQ";

describe("parseYouTubeVideoId", () => {
  it.each([
    [ID],
    [`  ${ID}  `],
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}&t=30s`],
    [`https://www.youtube.com/watch?list=PL123&v=${ID}`],
    [`http://m.youtube.com/watch?v=${ID}`],
    [`https://music.youtube.com/watch?v=${ID}`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/shorts/${ID}?feature=share`],
    [`https://www.youtube.com/embed/${ID}`],
    [`https://www.youtube-nocookie.com/embed/${ID}`],
    [`https://www.youtube.com/live/${ID}`],
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?si=abc`],
  ])("finds the ID in %s", (input) => {
    expect(parseYouTubeVideoId(input)).toBe(ID);
  });

  it.each([
    ["an empty string", ""],
    ["a short string", "abc"],
    ["a long string", "dQw4w9WgXcQQ"],
    ["bad characters", "dQw4w9WgXc!"],
    ["a lookalike host", `https://youtube.com.evil.example/watch?v=${ID}`],
    ["another site", `https://evil.example/watch?v=${ID}`],
    ["another site's path", `https://evil.example/shorts/${ID}`],
    ["a bad scheme", `javascript:alert('https://youtu.be/${ID}')`],
    ["an ftp URL", `ftp://youtu.be/${ID}`],
    ["a channel URL", "https://www.youtube.com/@somechannel"],
    ["a watch URL with no ID", "https://www.youtube.com/watch"],
    ["a malformed ID in a URL", "https://www.youtube.com/watch?v=short"],
  ])("rejects %s", (_name, input) => {
    expect(parseYouTubeVideoId(input)).toBeNull();
  });
});

describe("video ID helpers", () => {
  it("validates and builds links", () => {
    expect(isValidVideoId(ID)).toBe(true);
    expect(isValidVideoId("../../etc/pw")).toBe(false);
    expect(youtubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
});

describe("parseIsoDuration", () => {
  it.each([
    ["PT45S", 45],
    ["PT3M", 180],
    ["PT1H2M3S", 3723],
    ["P1DT1S", 86401],
    ["P0D", 0],
  ])("%s is %i seconds", (value, expected) => {
    expect(parseIsoDuration(value)).toBe(expected);
  });

  it("returns null rather than guessing", () => {
    expect(parseIsoDuration(undefined)).toBeNull();
    expect(parseIsoDuration("soon")).toBeNull();
  });
});

describe("classifyByDuration with a known shape", () => {
  it("never suggests a wide video as a Short, however short it is", () => {
    expect(classifyByDuration(40, 180, 1920 / 1080)).toBe("LONG_FORM_CANDIDATE");
  });
  it("suggests a short vertical or square one", () => {
    expect(classifyByDuration(40, 180, 608 / 1080)).toBe("SHORT_CANDIDATE");
    expect(classifyByDuration(40, 180, 1)).toBe("SHORT_CANDIDATE");
  });
  it("still goes by length for a long vertical one, or an unknown shape", () => {
    expect(classifyByDuration(600, 180, 608 / 1080)).toBe("LONG_FORM_CANDIDATE");
    expect(classifyByDuration(40, 180, null)).toBe("SHORT_CANDIDATE");
  });
  it("reads the shape YouTube reports, as text or as a number", () => {
    const resource = { id: "x", snippet: { title: "t" } };
    expect(normalizeVideo({ ...resource, player: { embedWidth: 608, embedHeight: 1080 } }).aspectRatio).toBeCloseTo(0.563, 2);
    expect(normalizeVideo(resource).aspectRatio).toBeNull();
  });
});

describe("classifyByDuration", () => {
  it("only suggests a kind, using the configured threshold", () => {
    expect(classifyByDuration(180, 180)).toBe("SHORT_CANDIDATE");
    expect(classifyByDuration(181, 180)).toBe("LONG_FORM_CANDIDATE");
    expect(classifyByDuration(100, 60)).toBe("LONG_FORM_CANDIDATE");
  });

  it("doesn't call a video with unknown length a Short, such as a live stream", () => {
    expect(classifyByDuration(null, 180)).toBe("LONG_FORM_CANDIDATE");
    expect(classifyByDuration(0, 180)).toBe("LONG_FORM_CANDIDATE");
  });
});

describe("normalizeVideo", () => {
  const resource = {
    id: ID,
    snippet: {
      title: "  عنوان كما هو  ",
      description: "وصف",
      channelId: "UC123",
      channelTitle: "قناة",
      publishedAt: "2026-01-02T03:04:05Z",
      tags: ["فقه"],
      thumbnails: { high: { url: "https://i.ytimg.com/vi/x/hq.jpg", width: 480, height: 360 } },
    },
    contentDetails: { duration: "PT1M" },
    status: { embeddable: true, privacyStatus: "public", uploadStatus: "processed" },
  };

  it("keeps YouTube's title exactly as given", () => {
    expect(normalizeVideo(resource).title).toBe("  عنوان كما هو  ");
  });

  it("maps the fields", () => {
    expect(normalizeVideo(resource)).toMatchObject({
      youtubeVideoId: ID,
      channelYoutubeId: "UC123",
      durationSeconds: 60,
      availability: "AVAILABLE",
      ytPublishedAt: new Date("2026-01-02T03:04:05Z"),
      thumbnails: [{ quality: "high", url: "https://i.ytimg.com/vi/x/hq.jpg", width: 480, height: 360 }],
    });
  });

  it("marks videos that can't be embedded or watched", () => {
    expect(normalizeVideo({ ...resource, status: { embeddable: false } }).availability).toBe("NOT_EMBEDDABLE");
    expect(normalizeVideo({ ...resource, status: { privacyStatus: "private" } }).availability).toBe("UNAVAILABLE");
    expect(normalizeVideo({ ...resource, status: { uploadStatus: "rejected" } }).availability).toBe("UNAVAILABLE");
  });

  it("never invents statistics: hidden counts stay null", () => {
    expect(normalizeVideo(resource).statistics).toBeNull();
    expect(normalizeVideo({ ...resource, statistics: { viewCount: "12" } }).statistics).toEqual({ viewCount: 12n, likeCount: null, commentCount: null });
  });

  it("survives a response with most fields missing", () => {
    expect(normalizeVideo({ id: ID, snippet: { title: "x" } })).toMatchObject({ description: null, channelTitle: null, durationSeconds: null, tags: [], thumbnails: [], ytPublishedAt: null });
  });
});

describe("pickThumbnailUrl", () => {
  it("prefers high quality and falls back to what exists", () => {
    expect(pickThumbnailUrl([{ quality: "default", url: "d" }, { quality: "high", url: "h" }])).toBe("h");
    expect(pickThumbnailUrl([{ quality: "odd", url: "o" }])).toBe("o");
    expect(pickThumbnailUrl([])).toBeNull();
  });
});

describe("pacificDay", () => {
  it("uses YouTube's reset time, not UTC", () => {
    expect(pacificDay(new Date("2026-03-10T06:59:00Z"))).toBe("2026-03-09");
    expect(pacificDay(new Date("2026-03-10T07:01:00Z"))).toBe("2026-03-10");
  });
});
