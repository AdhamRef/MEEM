import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getFeedPage, getPublicVideo } from "@/features/shorts/feed.service";
import { bulkPublishVideos } from "@/features/shorts/videos-admin.service";
import { runMetadataRefresh } from "@/features/youtube/metadata-refresh.service";
import { checkChannel } from "@/features/youtube/sources/channel-check.service";
import { addSource, checkChannelNow, getSourcesOverview, listFollowedChannels, listUnfollowedChannels, runScheduledSourceCheck, setChannelFollowed } from "@/features/youtube/sources/sources.service";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { clearDatabase, createTestClient } from "./helpers";
import { createActor } from "./phase3-helpers";

process.env.APP_URL = "http://localhost:3000";
process.env.YOUTUBE_API_ENABLED = "true";
process.env.YOUTUBE_API_KEY = "test-api-key-value";

const CHANNEL_ID = "UCabcdefghijklmnopqrstuv";
const UPLOADS = "UUabcdefghijklmnopqrstuv";
const DAY = 86_400_000;
const HOUR = 3_600_000;

let prisma: PrismaClient;
let admin: Actor;

async function codeOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : `UNEXPECTED: ${String(error)}`;
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const apiError = (status: number, reason: string) => json({ error: { code: status, errors: [{ reason }] } }, status);
const fetchMock = vi.fn<typeof fetch>();
const requests = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)));
const requestsTo = (endpoint: string) => requests().filter((url) => url.pathname.endsWith(`/${endpoint}`));

const ids = (count: number, prefix = "v") => Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(11 - prefix.length, "0")}`);

interface MockChannel {
  /** Newest first, as YouTube returns uploads. */
  videoIds: string[];
  longIds?: string[];
  quotaAfterPages?: number;
  videoCount?: number;
  /** The channel's own playlists, in the order YouTube lists them. */
  playlists?: { id: string; videoIds: string[]; itemCount?: number }[];
}

const state: { channel: MockChannel } = { channel: { videoIds: [] } };

function mockYouTube(channel: MockChannel) {
  state.channel = channel;
  fetchMock.mockClear();
  let pages = 0;
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input));
    const current = state.channel;
    if (url.pathname.endsWith("/channels")) {
      return json({
        items: [
          {
            id: CHANNEL_ID,
            snippet: { title: "قناة تجريبية", customUrl: "@test", thumbnails: { default: { url: "https://yt3.ggpht.com/a.jpg" } } },
            contentDetails: { relatedPlaylists: { uploads: UPLOADS } },
            statistics: { videoCount: String(current.videoCount ?? current.videoIds.length) },
          },
        ],
      });
    }
    if (url.pathname.endsWith("/playlists")) {
      const all = current.playlists ?? [];
      const resource = (playlist: { id: string; videoIds: string[]; itemCount?: number }) => ({
        id: playlist.id,
        snippet: { title: `قائمة ${playlist.id}`, channelId: CHANNEL_ID, channelTitle: "قناة تجريبية", thumbnails: { high: { url: `https://i.ytimg.com/vi/${playlist.videoIds[0] ?? "x"}/hqdefault.jpg` } } },
        contentDetails: { itemCount: playlist.itemCount ?? playlist.videoIds.length },
      });
      const id = url.searchParams.get("id");
      if (id) return json({ items: all.filter((playlist) => playlist.id === id).map(resource) });
      const start = Number(url.searchParams.get("pageToken") ?? 0);
      const next = start + 50 < all.length ? String(start + 50) : undefined;
      return json({ ...(next ? { nextPageToken: next } : {}), items: all.slice(start, start + 50).map(resource) });
    }
    if (url.pathname.endsWith("/playlistItems") && url.searchParams.get("playlistId") !== UPLOADS) {
      const playlist = current.playlists?.find((item) => item.id === url.searchParams.get("playlistId"));
      return json({ items: (playlist?.videoIds ?? []).map((id) => ({ contentDetails: { videoId: id }, status: { privacyStatus: "public" } })) });
    }
    if (url.pathname.endsWith("/playlistItems")) {
      pages += 1;
      if (current.quotaAfterPages !== undefined && pages > current.quotaAfterPages) return apiError(403, "quotaExceeded");
      const start = Number(url.searchParams.get("pageToken") ?? 0);
      const page = current.videoIds.slice(start, start + 50);
      const next = start + 50 < current.videoIds.length ? String(start + 50) : undefined;
      return json({ ...(next ? { nextPageToken: next } : {}), items: page.map((id) => ({ contentDetails: { videoId: id }, status: { privacyStatus: "public" } })) });
    }
    if (url.pathname.endsWith("/videos")) {
      const wanted = (url.searchParams.get("id") ?? "").split(",").filter(Boolean);
      return json({
        items: wanted.map((id) => ({
          id,
          snippet: { title: `عنوان ${id}`, channelId: CHANNEL_ID, channelTitle: "قناة تجريبية", publishedAt: "2026-01-01T00:00:00Z", thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } } },
          contentDetails: { duration: current.longIds?.includes(id) ? "PT20M" : "PT40S" },
          status: { embeddable: true, privacyStatus: "public", uploadStatus: "processed" },
        })),
      });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
}

const soon = () => new Date(Date.now() + 30_000);

/** Adds the channel and runs checks until its first fetch is complete. */
async function followAndFetch(channel: MockChannel) {
  mockYouTube(channel);
  const added = await addSource(admin, { input: "@test" });
  if (added.kind !== "channel") throw new Error("Expected a channel");
  for (let step = 0; step < 50; step += 1) {
    const result = await checkChannel(added.id, { deadline: soon(), enforceQuotaCeiling: false });
    if (result.isBackfillComplete) return added.id;
  }
  throw new Error("The first fetch never finished");
}

beforeAll(() => {
  prisma = createTestClient();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await clearDatabase(prisma);
  admin = await createActor(prisma, "ADMIN");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.CRON_SECRET;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("adding a channel", () => {
  it.each(["@test", "https://www.youtube.com/@test", `https://www.youtube.com/channel/${CHANNEL_ID}`, CHANNEL_ID])("follows %s, without fetching any video yet", async (input) => {
    mockYouTube({ videoIds: ids(3), videoCount: 3 });
    const added = await addSource(admin, { input });
    expect(added).toMatchObject({ kind: "channel", title: "قناة تجريبية", wasFollowed: false });
    expect(await prisma.youTubeChannel.findFirstOrThrow()).toMatchObject({ isFollowed: true, isBackfillComplete: false, youtubeVideoCount: 3, uploadsPlaylistId: UPLOADS });
    expect(requestsTo("playlistItems")).toHaveLength(0);
    expect(requestsTo("search")).toHaveLength(0);
  });

  it("explains an old /c/ address and rejects anything that isn't YouTube", async () => {
    expect(await codeOf(addSource(admin, { input: "https://www.youtube.com/c/Old" }))).toBe("VALIDATION");
    expect(await codeOf(addSource(admin, { input: "https://example.com/@test" }))).toBe("VALIDATION");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a channel YouTube doesn't know", async () => {
    fetchMock.mockImplementation(async () => json({ items: [] }));
    expect(await codeOf(addSource(admin, { input: "@nobody" }))).toBe("NOT_FOUND");
  });

  it("needs both the import and the publish permissions, checked on the server", async () => {
    mockYouTube({ videoIds: [] });
    expect(await codeOf(addSource(null, { input: "@test" }))).toBe("UNAUTHENTICATED");
    expect(await codeOf(addSource(await createActor(prisma, "EDITOR"), { input: "@test" }))).toBe("FORBIDDEN");
    expect(await codeOf(addSource(await createActor(prisma, "CONTRIBUTOR", ["youtube.import"]), { input: "@test" }))).toBe("FORBIDDEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is audited", async () => {
    mockYouTube({ videoIds: [] });
    await addSource(admin, { input: "@test" });
    expect(await prisma.auditLog.count({ where: { action: "source.follow_channel", actorId: admin.id } })).toBe(1);
  });
});

describe("the first fetch", () => {
  it("publishes every upload at once, as Shorts or long videos, ready for the feed", async () => {
    const channelId = await followAndFetch({ videoIds: ids(120), longIds: ["v0000000001"] });

    expect(await prisma.video.count({ where: { channelId, status: "PUBLISHED" } })).toBe(120);
    expect(await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: "v0000000001" } })).toMatchObject({ kind: "LONG_FORM", availability: "AVAILABLE" });
    expect(await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: "v0000000000" } })).toMatchObject({ kind: "SHORT", reviewedAt: null });
    expect((await getFeedPage(null, {})).items.length).toBeGreaterThan(0);
    expect(await prisma.youTubeChannel.findUniqueOrThrow({ where: { id: channelId } })).toMatchObject({ isBackfillComplete: true, backfillPageToken: null, lastCheckError: null });
  });

  it("uses the uploads list with one batched metadata request per page, and never search", async () => {
    await followAndFetch({ videoIds: ids(120) });
    expect(requestsTo("playlistItems")).toHaveLength(3);
    expect(requestsTo("videos")).toHaveLength(3);
    expect(requestsTo("search")).toHaveLength(0);
  });

  it("saves its place after each page, so a check stopped by its deadline continues where it was", async () => {
    mockYouTube({ videoIds: ids(150) });
    const added = await addSource(admin, { input: "@test" });
    if (added.kind !== "channel") throw new Error("Expected a channel");

    // A deadline already past still reads one page, so every check makes progress.
    const first = await checkChannel(added.id, { deadline: new Date(0), enforceQuotaCeiling: false });
    expect(first).toMatchObject({ added: 50, isBackfillComplete: false, stoppedBy: null });
    expect((await prisma.youTubeChannel.findUniqueOrThrow({ where: { id: added.id } })).backfillPageToken).toBe("50");

    fetchMock.mockClear();
    const second = await checkChannel(added.id, { deadline: soon(), enforceQuotaCeiling: false });
    expect(second).toMatchObject({ added: 100, isBackfillComplete: true });
    // The top page first, to catch new uploads, which is all known, then the rest from where it left off.
    expect(requestsTo("playlistItems").map((url) => url.searchParams.get("pageToken"))).toEqual([null, "50", "100"]);
    expect(await prisma.video.count()).toBe(150);
  });

  it("stops when the quota runs out, never retries, and picks up from the same page later", async () => {
    mockYouTube({ videoIds: ids(150), quotaAfterPages: 1 });
    const added = await addSource(admin, { input: "@test" });
    if (added.kind !== "channel") throw new Error("Expected a channel");

    const stopped = await checkChannel(added.id, { deadline: soon(), enforceQuotaCeiling: false });
    expect(stopped).toMatchObject({ added: 50, stoppedBy: "QUOTA_EXCEEDED", isBackfillComplete: false });
    expect(requestsTo("playlistItems")).toHaveLength(2);
    expect((await prisma.youTubeChannel.findUniqueOrThrow({ where: { id: added.id } })).lastCheckError).toBeTruthy();

    mockYouTube({ videoIds: ids(150) });
    await prisma.apiQuotaUsage.deleteMany();
    const resumed = await checkChannel(added.id, { deadline: soon(), enforceQuotaCeiling: false });
    expect(resumed).toMatchObject({ added: 100, isBackfillComplete: true, stoppedBy: null });
    expect((await prisma.youTubeChannel.findUniqueOrThrow({ where: { id: added.id } })).lastCheckError).toBeNull();
  });

  it("never lets two checks walk one channel at once", async () => {
    mockYouTube({ videoIds: ids(10) });
    const added = await addSource(admin, { input: "@test" });
    if (added.kind !== "channel") throw new Error("Expected a channel");
    await prisma.youTubeChannel.update({ where: { id: added.id }, data: { checkLockedUntil: new Date(Date.now() + 60_000) } });
    expect(await checkChannel(added.id, { deadline: soon(), enforceQuotaCeiling: false })).toMatchObject({ added: 0, stoppedBy: "BUSY" });
    expect(requestsTo("playlistItems")).toHaveLength(0);

    // A lease left by a check that died expires by itself.
    await prisma.youTubeChannel.update({ where: { id: added.id }, data: { checkLockedUntil: new Date(Date.now() - 1000) } });
    expect(await checkChannel(added.id, { deadline: soon(), enforceQuotaCeiling: false })).toMatchObject({ added: 10, stoppedBy: null });
  });

  it("gives videos the topics of their channel", async () => {
    const channelId = await followAndFetch({ videoIds: ids(1) });
    const topic = await prisma.topic.create({ data: { title: "موضوع", slug: "t", status: "PUBLISHED" } });
    await prisma.channelTopic.create({ data: { channelId, topicId: topic.id } });
    const video = await prisma.video.findFirstOrThrow();
    expect((await getPublicVideo(video.id))?.topics).toEqual([{ id: topic.id, title: "موضوع", slug: "t" }]);
  });
});

describe("checking for new uploads", () => {
  it("reads from the top until it reaches something stored, and adds only what's new", async () => {
    await followAndFetch({ videoIds: ids(60) });
    mockYouTube({ videoIds: [...ids(3, "n"), ...ids(60)] });

    const channel = await prisma.youTubeChannel.findFirstOrThrow();
    const result = await checkChannel(channel.id, { deadline: soon(), enforceQuotaCeiling: false });
    expect(result).toMatchObject({ added: 3, isBackfillComplete: true });
    expect(requestsTo("playlistItems")).toHaveLength(1);
    // Only the three new IDs are fetched.
    expect(requestsTo("videos")[0]!.searchParams.get("id")!.split(",")).toEqual(ids(3, "n"));
    expect(await prisma.video.count({ where: { status: "PUBLISHED" } })).toBe(63);
  });

  it("costs one request and adds nothing when nothing is new", async () => {
    await followAndFetch({ videoIds: ids(60) });
    fetchMock.mockClear();
    const channel = await prisma.youTubeChannel.findFirstOrThrow();
    expect(await checkChannel(channel.id, { deadline: soon(), enforceQuotaCeiling: false })).toMatchObject({ added: 0, stoppedBy: null });
    expect(requestsTo("playlistItems")).toHaveLength(1);
    expect(requestsTo("videos")).toHaveLength(0);
  });

  it("keeps a hidden video hidden, and never brings it back", async () => {
    await followAndFetch({ videoIds: ids(5) });
    const hidden = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: "v0000000002" } });
    await bulkPublishVideos(admin, { ids: [hidden.id], isPublished: false });

    mockYouTube({ videoIds: [...ids(1, "n"), ...ids(5)] });
    const channel = await prisma.youTubeChannel.findFirstOrThrow();
    await checkChannel(channel.id, { deadline: soon(), enforceQuotaCeiling: false });
    expect((await prisma.video.findUniqueOrThrow({ where: { id: hidden.id } })).status).toBe("DRAFT");
    expect(await prisma.video.count({ where: { status: "PUBLISHED" } })).toBe(5);
  });

  it("does nothing for a channel that isn't followed", async () => {
    const channelId = await followAndFetch({ videoIds: ids(2) });
    await setChannelFollowed(admin, channelId, false);
    fetchMock.mockClear();
    expect(await checkChannel(channelId, { deadline: soon(), enforceQuotaCeiling: false })).toMatchObject({ stoppedBy: "NOT_FOLLOWED" });
    expect(fetchMock).not.toHaveBeenCalled();
    // Its videos stay as they were.
    expect(await prisma.video.count({ where: { status: "PUBLISHED" } })).toBe(2);
  });

  it("checks now from the admin, audited, with permissions enforced", async () => {
    const channelId = await followAndFetch({ videoIds: ids(2) });
    mockYouTube({ videoIds: [...ids(1, "n"), ...ids(2)] });
    expect(await checkChannelNow(admin, channelId)).toMatchObject({ added: 1, message: null });
    expect(await prisma.auditLog.count({ where: { action: "source.check_channel" } })).toBe(1);
    expect(await codeOf(checkChannelNow(await createActor(prisma, "EDITOR"), channelId))).toBe("FORBIDDEN");
    expect(await codeOf(checkChannelNow(admin, "not-an-id"))).toBe("VALIDATION");
  });
});

describe("the hourly job", () => {
  it("checks followed channels that are due, and adds what's new", async () => {
    const channelId = await followAndFetch({ videoIds: ids(5) });
    await prisma.youTubeChannel.update({ where: { id: channelId }, data: { lastCheckedAt: new Date(Date.now() - 2 * HOUR) } });
    mockYouTube({ videoIds: [...ids(2, "n"), ...ids(5)] });

    const report = await runScheduledSourceCheck();
    expect(report).toMatchObject({ skipped: null, channelsChecked: 1, videosAdded: 2, stoppedBy: null });
    expect(await prisma.auditLog.count({ where: { action: "sources.scheduled_check", actorEmail: "system:cron" } })).toBe(1);
  });

  it("skips channels checked within the hour, and unfollowed ones", async () => {
    const channelId = await followAndFetch({ videoIds: ids(5) });
    fetchMock.mockClear();
    expect((await runScheduledSourceCheck()).channelsChecked).toBe(0);
    expect(requestsTo("playlistItems")).toHaveLength(0);

    await prisma.youTubeChannel.update({ where: { id: channelId }, data: { lastCheckedAt: new Date(Date.now() - 2 * HOUR), isFollowed: false } });
    expect((await runScheduledSourceCheck()).channelsChecked).toBe(0);
  });

  it("carries on a first fetch, even one checked a minute ago", async () => {
    mockYouTube({ videoIds: ids(80) });
    const added = await addSource(admin, { input: "@test" });
    if (added.kind !== "channel") throw new Error("Expected a channel");
    await checkChannel(added.id, { deadline: new Date(0), enforceQuotaCeiling: false });

    const report = await runScheduledSourceCheck();
    expect(report.videosAdded).toBe(30);
    expect((await prisma.youTubeChannel.findUniqueOrThrow({ where: { id: added.id } })).isBackfillComplete).toBe(true);
  });

  it("stops at the daily quota ceiling, leaving the rest for later", async () => {
    const channelId = await followAndFetch({ videoIds: ids(5) });
    await prisma.youTubeChannel.update({ where: { id: channelId }, data: { lastCheckedAt: new Date(Date.now() - 2 * HOUR) } });
    await prisma.applicationSetting.create({ data: { key: "youtube.settings", value: { statisticsEnabled: true, refreshAfterDays: 25, maxShortSeconds: 180, refreshBatchesPerRun: 20, autoCheckEnabled: true, autoCheckQuotaCeiling: 0 } } });
    fetchMock.mockClear();

    const report = await runScheduledSourceCheck();
    expect(report.stoppedBy).toBe("QUOTA_CEILING");
    expect(requestsTo("playlistItems")).toHaveLength(0);
    // Still due, since nothing was read.
    expect((await prisma.youTubeChannel.findUniqueOrThrow({ where: { id: channelId } })).lastCheckedAt!.getTime()).toBeLessThan(Date.now() - HOUR);
  });

  it("does nothing when switched off in the settings", async () => {
    await prisma.applicationSetting.create({ data: { key: "youtube.settings", value: { statisticsEnabled: true, refreshAfterDays: 25, maxShortSeconds: 180, refreshBatchesPerRun: 20, autoCheckEnabled: false, autoCheckQuotaCeiling: 8000 } } });
    expect((await runScheduledSourceCheck()).skipped).toBe("DISABLED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads settings saved before the hourly check existed, using its defaults", async () => {
    await prisma.applicationSetting.create({ data: { key: "youtube.settings", value: { statisticsEnabled: true, refreshAfterDays: 25, maxShortSeconds: 180, refreshBatchesPerRun: 20 } } });
    expect((await runScheduledSourceCheck()).skipped).toBeNull();
  });
});

describe("adding videos and playlists", () => {
  it("publishes pasted videos at once, under their channel, without following it", async () => {
    mockYouTube({ videoIds: [] });
    const result = await addSource(admin, { input: "https://youtu.be/aaaaaaaaaaa\nhttps://www.youtube.com/shorts/bbbbbbbbbbb" });
    expect(result).toEqual({ kind: "videos", imported: 2, duplicates: 0, notFound: 0 });
    expect(await prisma.video.count({ where: { status: "PUBLISHED" } })).toBe(2);
    expect(await prisma.youTubeChannel.findFirstOrThrow()).toMatchObject({ isFollowed: null });
    expect((await listUnfollowedChannels(admin)).map((channel) => channel.publishedCount)).toEqual([2]);

    const again = await addSource(admin, { input: "https://youtu.be/aaaaaaaaaaa" });
    expect(again).toEqual({ kind: "videos", imported: 0, duplicates: 1, notFound: 0 });
  });
});

describe("what the page shows", () => {
  it("lists followed channels with published and hidden counts, and an overview from stored data", async () => {
    await followAndFetch({ videoIds: ids(4), videoCount: 4 });
    const video = await prisma.video.findFirstOrThrow();
    await bulkPublishVideos(admin, { ids: [video.id], isPublished: false });
    fetchMock.mockClear();

    const page = await listFollowedChannels(admin, {});
    expect(page.items[0]).toMatchObject({ title: "قناة تجريبية", publishedCount: 3, hiddenCount: 1, isBackfillComplete: true });
    expect((await listFollowedChannels(admin, { query: "لا يوجد" })).items).toEqual([]);

    const overview = await getSourcesOverview(admin);
    expect(overview).toMatchObject({ followedChannels: 1, fetchingChannels: 0, isScheduleConfigured: false, autoCheckEnabled: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await codeOf(getSourcesOverview(await createActor(prisma, "EDITOR")))).toBe("FORBIDDEN");
  });

  it("moves an unfollowed channel to its own list, and following it again resumes checks", async () => {
    const channelId = await followAndFetch({ videoIds: ids(2) });
    await setChannelFollowed(admin, channelId, false);
    expect((await listFollowedChannels(admin, {})).items).toEqual([]);
    expect((await listUnfollowedChannels(admin)).map((channel) => channel.id)).toEqual([channelId]);

    await setChannelFollowed(admin, channelId, true);
    expect((await listFollowedChannels(admin, {})).items.map((channel) => channel.id)).toEqual([channelId]);
    expect(await prisma.auditLog.count({ where: { action: { in: ["source.follow_channel", "source.unfollow_channel"] } } })).toBe(3);
  });
});

describe("the channel data's 30-day limit", () => {
  it("refreshes channels that are due, and notices one that's gone", async () => {
    mockYouTube({ videoIds: [] });
    await addSource(admin, { input: "@test" });
    const channel = await prisma.youTubeChannel.findFirstOrThrow();
    await prisma.youTubeChannel.update({ where: { id: channel.id }, data: { title: "قديم", metadataFetchedAt: new Date(Date.now() - 26 * DAY) } });

    expect((await runMetadataRefresh()).channelsUpdated).toBe(1);
    expect((await prisma.youTubeChannel.findUniqueOrThrow({ where: { id: channel.id } })).title).toBe("قناة تجريبية");

    await prisma.youTubeChannel.update({ where: { id: channel.id }, data: { metadataFetchedAt: new Date(Date.now() - 26 * DAY) } });
    fetchMock.mockImplementation(async () => json({ items: [] }));
    expect((await runMetadataRefresh()).channelsRemoved).toBe(1);
    expect(await prisma.youTubeChannel.findUniqueOrThrow({ where: { id: channel.id } })).toMatchObject({ title: "", isActive: false, uploadsPlaylistId: null, youtubeVideoCount: null });
  });

  it("withdraws channel data past 30 days, even with YouTube unreachable", async () => {
    mockYouTube({ videoIds: [] });
    await addSource(admin, { input: "@test" });
    await prisma.youTubeChannel.updateMany({ data: { metadataFetchedAt: new Date(Date.now() - 31 * DAY) } });

    fetchMock.mockImplementation(async () => apiError(403, "quotaExceeded"));
    expect((await runMetadataRefresh()).channelsWithdrawn).toBe(1);
    expect(await prisma.youTubeChannel.findFirstOrThrow()).toMatchObject({ title: "", description: null, handle: null, uploadsPlaylistId: null, youtubeVideoCount: null });
  });
});

describe("a channel's playlists", () => {
  const PL1 = "PLaaaaaaaaaaaaaaaaaaaaaa";
  const PL2 = "PLbbbbbbbbbbbbbbbbbbbbbb";
  const PL3 = "PLcccccccccccccccccccccc";
  const channelListRequests = () => requestsTo("playlists").filter((url) => url.searchParams.has("channelId"));

  it("adds them after the uploads, published in YouTube's order, skipping empty ones, with no duplicates", async () => {
    const videos = ids(5);
    const channelId = await followAndFetch({ videoIds: videos, playlists: [{ id: PL1, videoIds: [videos[3]!, videos[1]!] }, { id: PL2, videoIds: [], itemCount: 0 }] });

    const playlists = await prisma.playlist.findMany({ include: { items: { orderBy: { position: "asc" }, include: { video: { select: { youtubeVideoId: true } } } } } });
    expect(playlists).toHaveLength(1);
    expect(playlists[0]).toMatchObject({ youtubePlaylistId: PL1, type: "YOUTUBE", status: "PUBLISHED", sourceChannelId: channelId, itemCount: 2 });
    expect(playlists[0]!.items.map((item) => item.video.youtubeVideoId)).toEqual([videos[3], videos[1]]);
    expect(await prisma.youTubeChannel.findUniqueOrThrow({ where: { id: channelId } })).toMatchObject({ isPlaylistsComplete: true, playlistsPageToken: null });
    // Its videos were already stored by the uploads walk, so the playlist cost no extra metadata.
    expect(await prisma.video.count()).toBe(5);

    await prisma.youTubeChannel.update({ where: { id: channelId }, data: { playlistsCheckedAt: new Date(Date.now() - 2 * DAY) } });
    await checkChannel(channelId, { deadline: soon(), enforceQuotaCeiling: false });
    expect(await prisma.playlist.count()).toBe(1);
  });

  it("reads the channel's list again daily, not hourly, and adds what's new", async () => {
    const videos = ids(3);
    const channelId = await followAndFetch({ videoIds: videos, playlists: [{ id: PL1, videoIds: [videos[0]!] }] });

    await prisma.youTubeChannel.update({ where: { id: channelId }, data: { lastCheckedAt: new Date(Date.now() - 2 * HOUR) } });
    mockYouTube({ videoIds: videos, playlists: [{ id: PL1, videoIds: [videos[0]!] }, { id: PL3, videoIds: [videos[2]!] }] });
    await runScheduledSourceCheck();
    expect(channelListRequests()).toHaveLength(0);
    expect(await prisma.playlist.count()).toBe(1);

    await prisma.youTubeChannel.update({ where: { id: channelId }, data: { lastCheckedAt: new Date(Date.now() - 2 * HOUR), playlistsCheckedAt: new Date(Date.now() - 25 * HOUR) } });
    const report = await runScheduledSourceCheck();
    expect(channelListRequests()).toHaveLength(1);
    expect(report.playlistsAdded).toBe(1);
    expect(await prisma.playlist.findFirstOrThrow({ where: { youtubePlaylistId: PL3 } })).toMatchObject({ status: "PUBLISHED", sourceChannelId: channelId });
  });

  it("checks a playlist added on its own hourly for 1 unit, reading its items only when its count changed", async () => {
    const videos = ids(3);
    await followAndFetch({ videoIds: videos, playlists: [{ id: PL1, videoIds: [videos[0]!] }] });
    mockYouTube({ videoIds: videos, playlists: [{ id: PL1, videoIds: [videos[0]!] }, { id: PL3, videoIds: [videos[1]!] }] });
    await addSource(admin, { input: `https://www.youtube.com/playlist?list=${PL3}` });

    const makeDue = async () => {
      await prisma.playlist.updateMany({ data: { metadataFetchedAt: new Date(Date.now() - 2 * HOUR) } });
      await prisma.youTubeChannel.updateMany({ data: { lastCheckedAt: new Date() } });
      fetchMock.mockClear();
    };

    // Unchanged: one details request, no item pages. The channel's playlist isn't checked hourly.
    await makeDue();
    expect((await runScheduledSourceCheck()).playlistsSynced).toBe(1);
    expect(requestsTo("playlists").map((url) => url.searchParams.get("id"))).toEqual([PL3]);
    expect(requestsTo("playlistItems")).toHaveLength(0);

    // A new item changes the count, so the pages are read and the item is added.
    mockYouTube({ videoIds: videos, playlists: [{ id: PL1, videoIds: [videos[0]!] }, { id: PL3, videoIds: [videos[1]!, videos[2]!] }] });
    await makeDue();
    await runScheduledSourceCheck();
    expect(requestsTo("playlistItems").map((url) => url.searchParams.get("playlistId"))).toEqual([PL3]);
    expect((await prisma.playlist.findFirstOrThrow({ where: { youtubePlaylistId: PL3 } })).itemCount).toBe(2);
  });

  it("re-syncs a channel playlist from the daily list read only when its count changed", async () => {
    const videos = ids(3);
    const channelId = await followAndFetch({ videoIds: videos, playlists: [{ id: PL1, videoIds: [videos[0]!] }] });
    const daily = async () => {
      await prisma.youTubeChannel.update({ where: { id: channelId }, data: { playlistsCheckedAt: new Date(Date.now() - 25 * HOUR) } });
      fetchMock.mockClear();
      await checkChannel(channelId, { deadline: soon(), enforceQuotaCeiling: false });
    };

    mockYouTube({ videoIds: videos, playlists: [{ id: PL1, videoIds: [videos[0]!] }] });
    await daily();
    expect(requestsTo("playlistItems").filter((url) => url.searchParams.get("playlistId") === PL1)).toHaveLength(0);

    mockYouTube({ videoIds: videos, playlists: [{ id: PL1, videoIds: [videos[0]!, videos[2]!] }] });
    await daily();
    expect(requestsTo("playlistItems").filter((url) => url.searchParams.get("playlistId") === PL1)).toHaveLength(1);
    expect((await prisma.playlist.findFirstOrThrow({ where: { youtubePlaylistId: PL1 } })).itemCount).toBe(2);
  });

  it("keeps the playlists of channels added with the old importer, without following them or walking their uploads", async () => {
    const videos = ids(2);
    mockYouTube({ videoIds: videos, playlists: [{ id: PL1, videoIds: videos }] });
    const channel = await prisma.youTubeChannel.create({ data: { youtubeChannelId: CHANNEL_ID, title: "قناة قديمة", uploadsPlaylistId: UPLOADS, metadataFetchedAt: new Date() } });
    await prisma.importJob.create({ data: { type: "IMPORT", status: "COMPLETED", channelId: channel.id } });

    const report = await runScheduledSourceCheck();
    expect(report.playlistsAdded).toBe(1);
    expect(requestsTo("playlistItems").filter((url) => url.searchParams.get("playlistId") === UPLOADS)).toHaveLength(0);
    expect(await prisma.playlist.findFirstOrThrow()).toMatchObject({ youtubePlaylistId: PL1, status: "PUBLISHED", sourceChannelId: channel.id, itemCount: 2 });
    expect(await prisma.youTubeChannel.findUniqueOrThrow({ where: { id: channel.id } })).toMatchObject({ isFollowed: null, isPlaylistsComplete: true });

    // Done for the day: the next hourly run doesn't read the list again.
    fetchMock.mockClear();
    await runScheduledSourceCheck();
    expect(channelListRequests()).toHaveLength(0);
  });

  it("leaves a channel playlist someone unpublished as it is", async () => {
    const videos = ids(2);
    const channelId = await followAndFetch({ videoIds: videos, playlists: [{ id: PL1, videoIds: [videos[0]!] }] });
    const playlist = await prisma.playlist.findFirstOrThrow();
    await prisma.playlist.update({ where: { id: playlist.id }, data: { status: "DRAFT", metadataFetchedAt: new Date(Date.now() - 2 * DAY) } });
    await prisma.youTubeChannel.update({ where: { id: channelId }, data: { lastCheckedAt: new Date() } });
    await runScheduledSourceCheck();
    expect((await prisma.playlist.findUniqueOrThrow({ where: { id: playlist.id } })).status).toBe("DRAFT");
  });
});

describe("saving quota on channels already stored", () => {
  it("skips walking a followed channel whose videos are all stored already, for 1 unit", async () => {
    const videos = ids(120);
    // As the old importer left it: every video stored, the channel saved but never followed.
    await followAndFetch({ videoIds: videos });
    const channel = await prisma.youTubeChannel.findFirstOrThrow();
    await prisma.youTubeChannel.update({ where: { id: channel.id }, data: { isFollowed: false, isBackfillComplete: false, backfillPageToken: null, youtubeVideoCount: null } });

    mockYouTube({ videoIds: videos });
    await setChannelFollowed(admin, channel.id, true);
    const result = await checkChannel(channel.id, { deadline: soon(), enforceQuotaCeiling: false });
    expect(result).toMatchObject({ added: 0, isBackfillComplete: true });
    expect(requestsTo("channels")).toHaveLength(1);
    // Only the top page, to catch new uploads, rather than all three.
    expect(requestsTo("playlistItems").filter((url) => url.searchParams.get("playlistId") === UPLOADS)).toHaveLength(1);
  });

  it("still walks a channel when some of its videos are missing", async () => {
    const videos = ids(120);
    await followAndFetch({ videoIds: videos.slice(0, 60) });
    const channel = await prisma.youTubeChannel.findFirstOrThrow();
    await prisma.youTubeChannel.update({ where: { id: channel.id }, data: { isBackfillComplete: false, backfillPageToken: null, youtubeVideoCount: 120 } });
    mockYouTube({ videoIds: videos });
    for (let step = 0; step < 10; step += 1) {
      if ((await checkChannel(channel.id, { deadline: soon(), enforceQuotaCeiling: false })).isBackfillComplete) break;
    }
    expect(await prisma.video.count()).toBe(120);
  });
});
