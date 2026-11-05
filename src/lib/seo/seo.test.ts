import { afterEach, describe, expect, it, vi } from "vitest";
import { absoluteUrl, articleJsonLd, metaDescription, serializeJsonLd, siteUrl, videoJsonLd } from "./index";

afterEach(() => vi.unstubAllEnvs());

describe("URLs", () => {
  it("uses the configured address and keeps Arabic slugs encoded", () => {
    vi.stubEnv("APP_URL", "https://example.org");
    expect(siteUrl().origin).toBe("https://example.org");
    expect(absoluteUrl(`/topics/${encodeURIComponent("الصلاة")}`)).toBe(`https://example.org/topics/${encodeURIComponent("الصلاة")}`);
  });
});

describe("metaDescription", () => {
  it("flattens line breaks and shortens long text", () => {
    expect(metaDescription("سطر\n\n  ثان")).toBe("سطر ثان");
    expect(metaDescription("ا".repeat(300))).toHaveLength(160);
  });

  it("gives nothing rather than an empty description", () => {
    expect(metaDescription("  ")).toBeUndefined();
    expect(metaDescription(null)).toBeUndefined();
  });
});

describe("serializeJsonLd", () => {
  it("can't be closed by content from an editor or YouTube", () => {
    const text = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(text).not.toContain("<");
    expect(JSON.parse(text)).toEqual({ name: "</script><script>alert(1)</script>" });
  });
});

describe("structured data", () => {
  const video = { youtubeVideoId: "abc123DEF45", title: "عنوان", description: null, thumbnailUrl: "https://i.ytimg.com/x.jpg", durationSeconds: 90, uploadedAt: "2026-01-01T00:00:00.000Z" };

  it("describes a video by YouTube's own embed address", () => {
    expect(videoJsonLd(video)).toMatchObject({ "@type": "VideoObject", embedUrl: "https://www.youtube.com/embed/abc123DEF45", duration: "PT90S", uploadDate: video.uploadedAt, description: "عنوان" });
  });

  it("omits a video when a required fact is unknown, instead of inventing it", () => {
    expect(videoJsonLd({ ...video, uploadedAt: null })).toBeNull();
    expect(videoJsonLd({ ...video, thumbnailUrl: null })).toBeNull();
  });

  it("credits an article's byline, or the platform when it has none", () => {
    const article = { title: "مقال", excerpt: null, coverImage: null, publishedAt: null, updatedAt: new Date(0), bylineName: "فلان" };
    expect(articleJsonLd(article, "/articles/a", "المنصة")).toMatchObject({ author: { "@type": "Person", name: "فلان" } });
    expect(articleJsonLd({ ...article, bylineName: null }, "/articles/a", "المنصة")).toMatchObject({ author: { "@type": "Organization", name: "المنصة" } });
  });
});
