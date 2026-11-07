import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getVideoComments } from "@/features/youtube/comments.service";
import { backfillVideoStatistics, getYouTubeStatus, runMetadataRefresh, runMetadataRefreshAs } from "@/features/youtube/metadata-refresh.service";
import { YOUTUBE_SETTINGS_KEY } from "@/features/youtube/settings.service";
import { importVideos, importVideosByInput } from "@/features/youtube/video-import.service";
import { AppError } from "@/lib/errors";
import { YouTubeApiError, youtubeRequest } from "@/lib/youtube/client";
import { pacificDay } from "@/lib/youtube/quota";
import { z } from "zod";
import { clearDatabase, createTestClient } from "./helpers";
import { createActor } from "./phase3-helpers";

// Read once on first use, so this has to be set before anything asks for configuration.
process.env.APP_URL = "http://localhost:3000";
process.env.YOUTUBE_API_ENABLED = "true";
process.env.YOUTUBE_API_KEY = "test-api-key-value";

let prisma: PrismaClient;

const DAY = 86_400_000;
const ID_1 = "aaaaaaaaaa1";
const ID_2 = "aaaaaaaaaa2";
const ID_3 = "aaaaaaaaaa3";

const videoResource = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  snippet: {
    title: `عنوان ${id}`,
    description: "وصف",
    channelId: "UCchannel",
    channelTitle: "قناة",
    publishedAt: "2026-01-01T00:00:00Z",
    tags: ["فقه"],
    thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480, height: 360 } },
  },
  contentDetails: { duration: "PT45S" },
  status: { embeddable: true, privacyStatus: "public", uploadStatus: "processed" },
  ...overrides,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const apiError = (status: number, reason: string) => json({ error: { code: status, errors: [{ reason }] } }, status);

const fetchMock = vi.fn<typeof fetch>();
const requestedUrls = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)));

function respondWithVideos(available: string[], overrides: Record<string, Record<string, unknown>> = {}) {
  fetchMock.mockImplementation(async (url) => {
    const ids = (new URL(String(url)).searchParams.get("id") ?? "").split(",");
    return json({ items: ids.filter((id) => available.includes(id)).map((id) => videoResource(id, overrides[id])) });
  });
}

async function errorCodeOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : `UNEXPECTED: ${String(error)}`;
  }
}

beforeAll(() => {
  prisma = createTestClient();
});

beforeEach(async () => {
  await clearDatabase(prisma);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the API client", () => {
  const schema = z.object({ ok: z.boolean() });
  const call = () => youtubeRequest({ endpoint: "videos", params: { part: "id" }, schema, quotaUnits: 1 });

  it("returns validated data and records quota for the Pacific-time day", async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    expect(await call()).toEqual({ ok: true });

    const usage = await prisma.apiQuotaUsage.findUniqueOrThrow({ where: { day: pacificDay() } });
    expect(usage.units).toBe(1);
    expect(usage.byEndpoint).toEqual({ videos: 1 });
    expect(usage.exhausted).toBe(false);
  });

  it("counts simultaneous requests exactly", async () => {
    fetchMock.mockImplementation(async () => json({ ok: true }));
    await Promise.all(Array.from({ length: 10 }, call));
    expect((await prisma.apiQuotaUsage.findUniqueOrThrow({ where: { day: pacificDay() } })).units).toBe(10);
  });

  it("never retries quotaExceeded, and stops calling until the reset", async () => {
    fetchMock.mockResolvedValue(apiError(403, "quotaExceeded"));

    await expect(call()).rejects.toMatchObject({ reason: "QUOTA_EXCEEDED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await prisma.apiQuotaUsage.findUniqueOrThrow({ where: { day: pacificDay() } })).exhausted).toBe(true);

    await expect(call()).rejects.toMatchObject({ reason: "QUOTA_EXCEEDED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries temporary failures, then succeeds", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(apiError(403, "rateLimitExceeded")).mockResolvedValueOnce(json({ ok: true }));
    expect(await call()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries network failures, then gives up with a clear reason", async () => {
    fetchMock.mockRejectedValue(new TypeError("network down"));
    await expect(call()).rejects.toMatchObject({ reason: "TRANSIENT" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    [403, "keyInvalid", "CONFIGURATION_REJECTED"],
    [403, "accessNotConfigured", "CONFIGURATION_REJECTED"],
    [403, "commentsDisabled", "COMMENTS_DISABLED"],
    [404, "videoNotFound", "NOT_FOUND"],
    [400, "badRequest", "BAD_REQUEST"],
  ])("doesn't retry %i %s", async (status, reason, expected) => {
    fetchMock.mockResolvedValue(apiError(status, reason));
    await expect(call()).rejects.toMatchObject({ reason: expected });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a response of an unexpected shape", async () => {
    fetchMock.mockResolvedValue(json({ surprise: true }));
    await expect(call()).rejects.toMatchObject({ reason: "INVALID_RESPONSE" });
  });

  it("never lets the key reach an error or a log", async () => {
    const written: string[] = [];
    for (const method of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => void written.push(args.map(String).join(" ")));
    }
    fetchMock.mockRejectedValue(new TypeError("failed to fetch https://www.googleapis.com/youtube/v3/videos?key=test-api-key-value"));

    const error = await call().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(YouTubeApiError);
    expect(String(error)).not.toContain("test-api-key-value");
    expect(written.join("\n")).not.toContain("test-api-key-value");
  });
});

describe("importing videos", () => {
  it("stores metadata as a draft, and auto-publishes nothing", async () => {
    respondWithVideos([ID_1]);
    const report = await importVideosByInput([`https://www.youtube.com/shorts/${ID_1}`]);
    expect(report.imported).toEqual([ID_1]);

    const video = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: ID_1 } });
    expect(video).toMatchObject({
      status: "DRAFT",
      publishedAt: null,
      reviewedAt: null,
      kind: "SHORT",
      classification: "SHORT_CANDIDATE",
      title: `عنوان ${ID_1}`,
      durationSeconds: 45,
      availability: "AVAILABLE",
    });
    expect(video.metadataFetchedAt).toBeInstanceOf(Date);
    expect(video.feedKey).toBeGreaterThanOrEqual(0);
    expect(await prisma.youTubeChannel.count()).toBe(1);
  });

  it("creates no duplicates and spends no quota on what's already stored", async () => {
    respondWithVideos([ID_1]);
    await importVideosByInput([ID_1]);
    fetchMock.mockClear();

    const report = await importVideosByInput([ID_1, `https://youtu.be/${ID_1}`]);

    expect(report).toEqual({ imported: [], duplicates: [ID_1], notFound: [], invalid: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.video.count()).toBe(1);
  });

  it("reports what couldn't be imported, and makes no request for invalid input", async () => {
    respondWithVideos([ID_1]);
    const report = await importVideosByInput([ID_1, ID_2, "https://evil.example/watch?v=aaaaaaaaaa3"]);
    expect(report).toMatchObject({ imported: [ID_1], notFound: [ID_2], invalid: ["https://evil.example/watch?v=aaaaaaaaaa3"] });
  });

  it("sends at most 50 IDs per request, and asks for statistics only when enabled", async () => {
    await prisma.applicationSetting.create({ data: { key: YOUTUBE_SETTINGS_KEY, value: { statisticsEnabled: false, refreshAfterDays: 25, maxShortSeconds: 180, refreshBatchesPerRun: 20 } } });
    const ids = Array.from({ length: 120 }, (_, index) => `b${String(index).padStart(10, "0")}`);
    respondWithVideos(ids);
    await importVideosByInput(ids);

    const urls = requestedUrls();
    expect(urls).toHaveLength(3);
    expect(urls.every((url) => (url.searchParams.get("id") ?? "").split(",").length <= 50)).toBe(true);
    expect(urls[0]!.searchParams.get("part")).not.toContain("statistics");
    expect((await prisma.apiQuotaUsage.findUniqueOrThrow({ where: { day: pacificDay() } })).units).toBe(3);
  }, 180_000);

  it("stores statistics by default, from the same request", async () => {
    respondWithVideos([ID_1], { [ID_1]: { statistics: { viewCount: "500", likeCount: "20", commentCount: "3" } } });
    await importVideosByInput([ID_1]);
    expect((await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: ID_1 } })).stats).toMatchObject({ viewCount: 500n, likeCount: 20n, commentCount: 3n });
  });

  it("stores none when they're turned off, even if YouTube sends them", async () => {
    await prisma.applicationSetting.create({ data: { key: YOUTUBE_SETTINGS_KEY, value: { statisticsEnabled: false, refreshAfterDays: 25, maxShortSeconds: 180, refreshBatchesPerRun: 20 } } });
    respondWithVideos([ID_1], { [ID_1]: { statistics: { viewCount: "500" } } });
    await importVideosByInput([ID_1]);
    expect((await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: ID_1 } })).stats).toBeNull();
  });

  it("fills in statistics for videos stored without them, once each, and counts the quota", async () => {
    await prisma.video.create({ data: { youtubeVideoId: ID_1, kind: "SHORT", classification: "SHORT_CANDIDATE", status: "PUBLISHED", availability: "AVAILABLE", title: "قديم", feedKey: 1, metadataFetchedAt: new Date() } });
    respondWithVideos([ID_1], { [ID_1]: { statistics: { likeCount: "77", commentCount: "5" } } });

    expect(await backfillVideoStatistics(5)).toMatchObject({ updated: 1, remaining: 0 });
    expect((await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: ID_1 } })).stats).toMatchObject({ likeCount: 77n, commentCount: 5n });

    // Nothing is left to ask about, so running it again spends nothing.
    fetchMock.mockClear();
    expect(await backfillVideoStatistics(5)).toMatchObject({ updated: 0, remaining: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores real statistics once enabled", async () => {
    await prisma.applicationSetting.create({
      data: { key: YOUTUBE_SETTINGS_KEY, value: { statisticsEnabled: true, refreshAfterDays: 25, maxShortSeconds: 180, refreshBatchesPerRun: 20 } },
    });
    respondWithVideos([ID_1], { [ID_1]: { statistics: { viewCount: "500" } } });
    await importVideosByInput([ID_1]);

    const video = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: ID_1 } });
    expect(video.stats?.viewCount).toBe(500n);
    expect(video.stats?.likeCount).toBeNull();
    expect(requestedUrls()[0]!.searchParams.get("part")).toContain("statistics");
  });

  it("needs permission, and records who did it", async () => {
    expect(await errorCodeOf(importVideos(null, [ID_1]))).toBe("UNAUTHENTICATED");
    expect(await errorCodeOf(importVideos(await createActor(prisma, "EDITOR"), [ID_1]))).toBe("FORBIDDEN");
    expect(fetchMock).not.toHaveBeenCalled();

    respondWithVideos([ID_1]);
    const admin = await createActor(prisma, "ADMIN");
    await importVideos(admin, [ID_1]);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "youtube.import_videos" } })).actorId).toBe(admin.id);
  });

  it("rejects malformed input", async () => {
    const admin = await createActor(prisma, "ADMIN");
    expect(await errorCodeOf(importVideos(admin, "not-a-list"))).toBe("VALIDATION");
    expect(await errorCodeOf(importVideos(admin, [{ $ne: 1 }]))).toBe("VALIDATION");
    expect(await errorCodeOf(importVideos(admin, Array(501).fill(ID_1)))).toBe("VALIDATION");
  });
});

describe("the metadata refresh job", () => {
  const NOW = new Date("2026-08-01T00:00:00Z");
  const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

  async function storedVideo(youtubeVideoId: string, fetchedDaysAgo: number) {
    return prisma.video.create({
      data: {
        youtubeVideoId,
        kind: "SHORT",
        classification: "SHORT_CANDIDATE",
        status: "PUBLISHED",
        title: "قديم",
        description: "وصف قديم",
        channelTitle: "قناة قديمة",
        thumbnails: [{ quality: "high", url: "https://i.ytimg.com/old.jpg" }],
        tags: ["قديم"],
        availability: "AVAILABLE",
        feedKey: 1,
        metadataFetchedAt: daysAgo(fetchedDaysAgo),
      },
    });
  }

  it("refreshes old data and leaves recent data alone", async () => {
    await storedVideo(ID_1, 26);
    await storedVideo(ID_2, 2);
    respondWithVideos([ID_1, ID_2]);

    const report = await runMetadataRefresh(NOW);

    expect(report).toMatchObject({ checked: 1, updated: 1, removedFromYouTube: 0, stoppedBy: null, remaining: 0 });
    expect(requestedUrls()[0]!.searchParams.get("id")).toBe(ID_1);
    const refreshed = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: ID_1 } });
    expect(refreshed.title).toBe(`عنوان ${ID_1}`);
    expect(refreshed.metadataFetchedAt).toEqual(NOW);
    expect((await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: ID_2 } })).title).toBe("قديم");
  });

  it("keeps editorial choices while refreshing", async () => {
    const library = await prisma.library.create({ data: { name: "فقه", slug: "f" } });
    const video = await storedVideo(ID_1, 26);
    await prisma.video.update({ where: { id: video.id }, data: { libraryIds: [library.id], kind: "LONG_FORM" } });
    respondWithVideos([ID_1]);

    await runMetadataRefresh(NOW);

    expect(await prisma.video.findUniqueOrThrow({ where: { id: video.id } })).toMatchObject({ libraryIds: [library.id], kind: "LONG_FORM", status: "PUBLISHED" });
  });

  it("notices deleted videos: it removes YouTube's data and keeps the record", async () => {
    const video = await storedVideo(ID_1, 26);
    respondWithVideos([]);

    const report = await runMetadataRefresh(NOW);

    expect(report.removedFromYouTube).toBe(1);
    const updated = await prisma.video.findUniqueOrThrow({ where: { id: video.id } });
    expect(updated).toMatchObject({ availability: "UNAVAILABLE", title: "", description: null, channelTitle: null, thumbnails: [], tags: [], status: "PUBLISHED" });
  });

  it("marks a video that became non-embeddable", async () => {
    await storedVideo(ID_1, 26);
    respondWithVideos([ID_1], { [ID_1]: { status: { embeddable: false } } });
    await runMetadataRefresh(NOW);
    expect((await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: ID_1 } })).availability).toBe("NOT_EMBEDDABLE");
  });

  it("removes stored statistics when they're switched off", async () => {
    await prisma.applicationSetting.create({ data: { key: YOUTUBE_SETTINGS_KEY, value: { statisticsEnabled: false, refreshAfterDays: 25, maxShortSeconds: 180, refreshBatchesPerRun: 20 } } });
    const video = await storedVideo(ID_1, 26);
    await prisma.video.update({ where: { id: video.id }, data: { stats: { viewCount: 9n, fetchedAt: daysAgo(26) } } });
    respondWithVideos([ID_1], { [ID_1]: { statistics: { viewCount: "10" } } });
    await runMetadataRefresh(NOW);
    expect((await prisma.video.findUniqueOrThrow({ where: { id: video.id } })).stats).toBeNull();
  });

  it("stops at once on quota exhaustion, and withdraws anything past 30 days", async () => {
    await storedVideo(ID_1, 26);
    await storedVideo(ID_2, 31);
    fetchMock.mockResolvedValue(apiError(403, "quotaExceeded"));

    const report = await runMetadataRefresh(NOW);

    expect(report).toMatchObject({ stoppedBy: "QUOTA_EXCEEDED", checked: 0, withdrawn: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const expired = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: ID_2 } });
    expect(expired).toMatchObject({ availability: "UNKNOWN", title: "", description: null, thumbnails: [], status: "PUBLISHED" });
    expect((await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: ID_1 } })).title).toBe("قديم");
  });

  it("restores a withdrawn video once a refresh succeeds", async () => {
    await storedVideo(ID_1, 31);
    fetchMock.mockResolvedValueOnce(json({}, 400));
    await runMetadataRefresh(NOW);
    expect((await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: ID_1 } })).availability).toBe("UNKNOWN");

    respondWithVideos([ID_1]);
    await runMetadataRefresh(NOW);
    expect(await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: ID_1 } })).toMatchObject({ availability: "AVAILABLE", title: `عنوان ${ID_1}` });
  });

  it("stays within its batch budget and leaves the rest for the next run", async () => {
    await prisma.applicationSetting.create({
      data: { key: YOUTUBE_SETTINGS_KEY, value: { statisticsEnabled: false, refreshAfterDays: 25, maxShortSeconds: 180, refreshBatchesPerRun: 1 } },
    });
    const ids = Array.from({ length: 60 }, (_, index) => `c${String(index).padStart(10, "0")}`);
    for (const id of ids) await storedVideo(id, 26);
    respondWithVideos(ids);

    const report = await runMetadataRefresh(NOW);

    expect(report).toMatchObject({ checked: 50, remaining: 10 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires permission and is audited, and reports its status to staff only", async () => {
    expect(await errorCodeOf(runMetadataRefreshAs(null))).toBe("UNAUTHENTICATED");
    const editor = await createActor(prisma, "EDITOR");
    expect(await errorCodeOf(runMetadataRefreshAs(editor))).toBe("FORBIDDEN");
    expect(await errorCodeOf(getYouTubeStatus(editor))).toBe("FORBIDDEN");

    const admin = await createActor(prisma, "ADMIN");
    await runMetadataRefreshAs(admin);
    expect(await prisma.auditLog.count({ where: { action: "youtube.refresh_metadata", actorId: admin.id } })).toBe(1);
    expect(await getYouTubeStatus(admin)).toMatchObject({ isConfigured: true, quotaExhausted: false });
  });
});

describe("read-only comments", () => {
  async function publishedVideo(overrides: Record<string, unknown> = {}) {
    return prisma.video.create({
      data: { youtubeVideoId: ID_3, kind: "SHORT", classification: "SHORT_CANDIDATE", status: "PUBLISHED", availability: "AVAILABLE", title: "t", feedKey: 1, ...overrides },
    });
  }

  const thread = (id: string, text: string) => ({
    id,
    snippet: { topLevelComment: { snippet: { authorDisplayName: "كاتب", authorChannelUrl: "https://www.youtube.com/@a", textOriginal: text, publishedAt: "2026-01-01T00:00:00Z" } } },
  });

  it("returns comments with paging, and stores nothing", async () => {
    const video = await publishedVideo();
    fetchMock.mockResolvedValue(json({ nextPageToken: "NEXT", items: [thread("c1", "نص")] }));

    const result = await getVideoComments(video.id);

    expect(result).toEqual({
      state: "available",
      nextPageToken: "NEXT",
      comments: [{ id: "c1", author: "كاتب", authorUrl: "https://www.youtube.com/@a", text: "نص", publishedAt: "2026-01-01T00:00:00Z" }],
    });

    await getVideoComments(video.id, "NEXT");
    expect(requestedUrls()[1]!.searchParams.get("pageToken")).toBe("NEXT");
  });

  it("doesn't trust a link in a comment's author field", async () => {
    const video = await publishedVideo();
    const malicious = thread("c1", "x");
    malicious.snippet.topLevelComment.snippet.authorChannelUrl = "javascript:alert(1)";
    fetchMock.mockResolvedValue(json({ items: [malicious] }));

    const result = await getVideoComments(video.id);
    expect(result.state === "available" && result.comments[0]!.authorUrl).toBeNull();
  });

  it("handles commentsDisabled, and remembers it so later visits spend no quota", async () => {
    const video = await publishedVideo();
    fetchMock.mockResolvedValue(apiError(403, "commentsDisabled"));

    expect(await getVideoComments(video.id)).toEqual({ state: "disabled" });
    expect((await prisma.video.findUniqueOrThrow({ where: { id: video.id } })).commentsDisabled).toBe(true);

    fetchMock.mockClear();
    expect(await getVideoComments(video.id)).toEqual({ state: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports unavailable on quota or API errors, without failing the page", async () => {
    const video = await publishedVideo();
    fetchMock.mockResolvedValue(apiError(403, "quotaExceeded"));
    expect(await getVideoComments(video.id)).toEqual({ state: "unavailable" });
  });

  it("serves only public videos and validates input", async () => {
    const draft = await publishedVideo({ status: "DRAFT" });
    expect(await errorCodeOf(getVideoComments(draft.id))).toBe("NOT_FOUND");
    expect(await errorCodeOf(getVideoComments("nope"))).toBe("VALIDATION");
    expect(await errorCodeOf(getVideoComments(draft.id, "bad token!"))).toBe("VALIDATION");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
