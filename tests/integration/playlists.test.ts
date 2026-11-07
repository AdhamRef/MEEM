import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPublicVideo } from "@/features/shorts/feed.service";
import { listPublicPlaylistsFor } from "@/features/playlists/playlists.service";
import {
  addPlaylistItem,
  createCuratedPlaylist,
  deletePlaylist,
  getPlaylistConnections,
  getPublishedPlaylistBySlug,
  importYouTubePlaylist,
  listPublicPlaylists,
  removePlaylistItem,
  reorderPlaylistItems,
  setPlaylistArchived,
  setPlaylistItemNote,
  setPlaylistPublished,
  syncPlaylistNow,
  updatePlaylist,
} from "@/features/playlists/playlists.service";
import { getPlaylistProgress, getVideoProgress, recordViewingProgress } from "@/features/playlists/progress.service";
import { addLink, listLinks, removeLink } from "@/features/relationships/links.service";
import { runMetadataRefresh } from "@/features/youtube/metadata-refresh.service";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { clearDatabase, createTestClient } from "./helpers";
import { createActor } from "./phase3-helpers";

process.env.APP_URL = "http://localhost:3000";
process.env.YOUTUBE_API_ENABLED = "true";
process.env.YOUTUBE_API_KEY = "test-api-key-value";

const PLAYLIST_ID = "PLtestplaylist0000000001";
const DAY = 86_400_000;

let prisma: PrismaClient;
let admin: Actor;
let editor: Actor;
let counter = 0;

async function codeOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : `UNEXPECTED: ${String(error)}`;
  }
}

async function video(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return prisma.video.create({
    data: {
      youtubeVideoId: `pl${String(counter).padStart(9, "0")}`,
      kind: "LONG_FORM",
      classification: "LONG_FORM_CANDIDATE",
      title: `مقطع ${counter}`,
      feedKey: counter,
      status: "PUBLISHED",
      availability: "AVAILABLE",
      durationSeconds: 600,
      metadataFetchedAt: new Date(),
      ...overrides,
    },
  });
}

async function curated(items: { id: string }[] = [], overrides: Record<string, unknown> = {}) {
  counter += 1;
  const playlist = await createCuratedPlaylist(editor, { title: `سلسلة ${counter}`, ...overrides });
  for (const item of items) await addPlaylistItem(editor, { playlistId: playlist.id, videoId: item.id });
  return playlist;
}

async function publishedCurated(items: { id: string }[], overrides: Record<string, unknown> = {}) {
  const playlist = await curated(items, overrides);
  return setPlaylistPublished(admin, playlist.id, true);
}

const order = async (playlistId: string) => (await prisma.playlistItem.findMany({ where: { playlistId }, orderBy: { position: "asc" } })).map((item) => item.videoId);

// ---------------------------------------------------------------------------
// A mock of YouTube, at the network layer.
// ---------------------------------------------------------------------------

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const apiError = (status: number, reason: string) => json({ error: { code: status, errors: [{ reason }] } }, status);

const fetchMock = vi.fn<typeof fetch>();
const requests = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)));
const requestsTo = (endpoint: string) => requests().filter((url) => url.pathname.endsWith(`/${endpoint}`));

interface YouTubeState {
  title: string;
  videoIds: string[];
  privateIds?: string[];
  missingVideos?: string[];
  playlistGone?: boolean;
}

function mockYouTube(state: YouTubeState) {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/playlists")) {
      if (state.playlistGone) return json({ items: [] });
      return json({
        items: [
          {
            id: url.searchParams.get("id"),
            snippet: { title: state.title, description: "وصف من YouTube", channelId: "UCchannel", channelTitle: "قناة YouTube", thumbnails: { high: { url: "https://i.ytimg.com/vi/x/hqdefault.jpg" } } },
            contentDetails: { itemCount: state.videoIds.length },
          },
        ],
      });
    }
    if (url.pathname.endsWith("/playlistItems")) {
      const start = Number(url.searchParams.get("pageToken") ?? 0);
      const page = state.videoIds.slice(start, start + 50);
      const next = start + 50 < state.videoIds.length ? String(start + 50) : undefined;
      return json({ ...(next ? { nextPageToken: next } : {}), items: page.map((id) => ({ contentDetails: { videoId: id }, status: { privacyStatus: state.privateIds?.includes(id) ? "private" : "public" } })) });
    }
    if (url.pathname.endsWith("/videos")) {
      const ids = (url.searchParams.get("id") ?? "").split(",").filter((id) => !state.missingVideos?.includes(id));
      return json({
        items: ids.map((id) => ({
          id,
          snippet: { title: `عنوان ${id}`, channelId: "UCchannel", channelTitle: "قناة YouTube", thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } } },
          contentDetails: { duration: "PT10M" },
          status: { embeddable: true, privacyStatus: "public", uploadStatus: "processed" },
        })),
      });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
}

const ids = (count: number, prefix = "yt") => Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(9, "0")}`);

beforeAll(() => {
  prisma = createTestClient();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await clearDatabase(prisma);
  admin = await createActor(prisma, "ADMIN");
  editor = await createActor(prisma, "EDITOR");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("curated playlists", () => {
  it("can mix channels, and several without YouTube IDs don't collide", async () => {
    const first = await video({ channelTitle: "قناة أ" });
    const second = await video({ channelTitle: "قناة ب" });
    const a = await curated([first, second], { title: "مدخل إلى نقد الإلحاد" });
    const b = await curated([first], { title: "مدخل إلى نقد الإلحاد" });
    const c = await curated();

    expect(new Set([a.sourceKey, b.sourceKey, c.sourceKey]).size).toBe(3);
    expect(a.slug).toBe("مدخل-إلى-نقد-الإلحاد");
    expect(b.slug).toBe("مدخل-إلى-نقد-الإلحاد-2");
    expect(a.type).toBe("CURATED");
    expect(a.status).toBe("DRAFT");
    expect(a.youtubePlaylistId).toBeNull();
  });

  it("lets one video belong to several playlists, but only once in each", async () => {
    const clip = await video();
    const [a, b] = [await curated([clip]), await curated([clip])];
    expect(await order(a.id)).toEqual([clip.id]);
    expect(await order(b.id)).toEqual([clip.id]);

    expect(await codeOf(addPlaylistItem(editor, { playlistId: a.id, videoId: clip.id }))).toBe("CONFLICT");
    expect(await order(a.id)).toEqual([clip.id]);
  });

  it("keeps a new order, and its count, after reloading", async () => {
    const [a, b, c] = [await video(), await video(), await video()];
    const playlist = await curated([a, b, c]);
    expect(await order(playlist.id)).toEqual([a.id, b.id, c.id]);

    await reorderPlaylistItems(editor, { playlistId: playlist.id, videoIds: [c.id, a.id, b.id] });
    expect(await order(playlist.id)).toEqual([c.id, a.id, b.id]);

    const live = await setPlaylistPublished(admin, playlist.id, true);
    expect((await getPublishedPlaylistBySlug(live.slug))!.items.map((item) => item.videoId)).toEqual([c.id, a.id, b.id]);
    expect((await prisma.playlist.findUniqueOrThrow({ where: { id: playlist.id } })).itemCount).toBe(3);
  });

  it("adds new items at the end, even after a removal leaves a gap", async () => {
    const [a, b, c, d] = [await video(), await video(), await video(), await video()];
    const playlist = await curated([a, b, c]);
    await removePlaylistItem(editor, { playlistId: playlist.id, videoId: b.id });
    await addPlaylistItem(editor, { playlistId: playlist.id, videoId: d.id });
    expect(await order(playlist.id)).toEqual([a.id, c.id, d.id]);
    expect((await prisma.playlist.findUniqueOrThrow({ where: { id: playlist.id } })).itemCount).toBe(3);
  });

  it("refuses a stale reorder, changing nothing", async () => {
    const [a, b, c] = [await video(), await video(), await video()];
    const playlist = await curated([a, b]);
    await addPlaylistItem(editor, { playlistId: playlist.id, videoId: c.id });

    expect(await codeOf(reorderPlaylistItems(editor, { playlistId: playlist.id, videoIds: [b.id, a.id] }))).toBe("CONFLICT");
    expect(await codeOf(reorderPlaylistItems(editor, { playlistId: playlist.id, videoIds: [a.id, a.id, b.id] }))).toBe("CONFLICT");
    expect(await order(playlist.id)).toEqual([a.id, b.id, c.id]);
  });

  it("rejects a video that doesn't exist", async () => {
    const playlist = await curated();
    expect(await codeOf(addPlaylistItem(editor, { playlistId: playlist.id, videoId: "507f1f77bcf86cd799439011" }))).toBe("VALIDATION");
  });

  it("holds notes on items", async () => {
    const clip = await video();
    const playlist = await publishedCurated([clip]);
    await setPlaylistItemNote(editor, { playlistId: playlist.id, videoId: clip.id, note: "ابدأ من هنا" });
    expect((await getPublishedPlaylistBySlug(playlist.slug))!.items[0]!.note).toBe("ابدأ من هنا");

    await setPlaylistItemNote(editor, { playlistId: playlist.id, videoId: clip.id, note: "" });
    expect((await getPublishedPlaylistBySlug(playlist.slug))!.items[0]!.note).toBeNull();
    expect(await codeOf(setPlaylistItemNote(editor, { playlistId: playlist.id, videoId: "507f1f77bcf86cd799439011", note: "س" }))).toBe("NOT_FOUND");
  });

  it("shows only public videos, whatever was added", async () => {
    const live = await video();
    const draft = await video({ status: "DRAFT" });
    const gone = await video({ availability: "UNAVAILABLE" });
    const archived = await video({ isArchived: true });
    const withdrawn = await video({ availability: "UNKNOWN", title: "" });
    const playlist = await publishedCurated([draft, live, gone, archived, withdrawn]);

    expect((await getPublishedPlaylistBySlug(playlist.slug))!.items.map((item) => item.videoId)).toEqual([live.id]);
  });

  it("can't be published empty, or while archived", async () => {
    const empty = await curated();
    expect(await codeOf(setPlaylistPublished(admin, empty.id, true))).toBe("CONFLICT");

    const archived = await curated([await video()]);
    await setPlaylistArchived(admin, archived.id, true);
    expect(await codeOf(setPlaylistPublished(admin, archived.id, true))).toBe("CONFLICT");
  });

  it("is hidden from the public until published, and again when archived", async () => {
    const playlist = await curated([await video()]);
    expect(await getPublishedPlaylistBySlug(playlist.slug)).toBeNull();
    expect((await listPublicPlaylists()).items).toEqual([]);

    await setPlaylistPublished(admin, playlist.id, true);
    expect(await getPublishedPlaylistBySlug(playlist.slug)).not.toBeNull();
    expect((await listPublicPlaylists()).items.map((row) => row.id)).toEqual([playlist.id]);

    await setPlaylistArchived(admin, playlist.id, true);
    expect(await getPublishedPlaylistBySlug(playlist.slug)).toBeNull();
  });

  it("locks the address once published", async () => {
    const playlist = await publishedCurated([await video()], { slug: "fixed-series" });
    expect(await codeOf(updatePlaylist(editor, playlist.id, { title: "س", slug: "moved" }))).toBe("CONFLICT");
    expect((await updatePlaylist(editor, playlist.id, { title: "عنوان جديد" })).slug).toBe("fixed-series");
  });

  it("rejects an unsafe cover", async () => {
    expect(await codeOf(createCuratedPlaylist(editor, { title: "س", coverImage: "javascript:alert(1)" }))).toBe("VALIDATION");
  });
});

describe("permissions", () => {
  it("are enforced on the server for each role, and for guests", async () => {
    const clip = await video();
    const playlist = await curated([clip]);
    const contributor = await createActor(prisma, "CONTRIBUTOR");
    const reviewer = await createActor(prisma, "SCIENTIFIC_REVIEWER");
    const reader = await createActor(prisma, "USER");

    for (const actor of [contributor, reviewer, reader]) {
      expect(await codeOf(createCuratedPlaylist(actor, { title: "س" }))).toBe("FORBIDDEN");
      expect(await codeOf(updatePlaylist(actor, playlist.id, { title: "س" }))).toBe("FORBIDDEN");
      expect(await codeOf(addPlaylistItem(actor, { playlistId: playlist.id, videoId: clip.id }))).toBe("FORBIDDEN");
      expect(await codeOf(removePlaylistItem(actor, { playlistId: playlist.id, videoId: clip.id }))).toBe("FORBIDDEN");
      expect(await codeOf(reorderPlaylistItems(actor, { playlistId: playlist.id, videoIds: [clip.id] }))).toBe("FORBIDDEN");
      expect(await codeOf(setPlaylistItemNote(actor, { playlistId: playlist.id, videoId: clip.id, note: "س" }))).toBe("FORBIDDEN");
      expect(await codeOf(addLink(actor, { kind: "playlist.topic", ownerId: playlist.id, targetId: clip.id }))).toBe("FORBIDDEN");
    }
    expect(await codeOf(createCuratedPlaylist(null, { title: "س" }))).toBe("UNAUTHENTICATED");
    expect(await codeOf(importYouTubePlaylist(null, { url: PLAYLIST_ID }))).toBe("UNAUTHENTICATED");
  });

  it("separate publishing, deleting, and importing from editing", async () => {
    const playlist = await curated([await video()]);
    expect(await codeOf(setPlaylistPublished(editor, playlist.id, true))).toBe("FORBIDDEN");
    expect(await codeOf(setPlaylistArchived(editor, playlist.id, true))).toBe("FORBIDDEN");
    expect(await codeOf(deletePlaylist(editor, playlist.id))).toBe("FORBIDDEN");
    expect(await codeOf(importYouTubePlaylist(editor, { url: PLAYLIST_ID }))).toBe("FORBIDDEN");
    expect(await codeOf(syncPlaylistNow(editor, playlist.id))).toBe("FORBIDDEN");
    expect(fetchMock).not.toHaveBeenCalled();

    const granted = await createActor(prisma, "CONTRIBUTOR", ["playlists.manage"]);
    expect((await createCuratedPlaylist(granted, { title: "س" })).status).toBe("DRAFT");
  });

  it("audit every privileged step", async () => {
    const [a, b] = [await video(), await video()];
    const playlist = await curated([a, b]);
    await reorderPlaylistItems(editor, { playlistId: playlist.id, videoIds: [b.id, a.id] });
    await removePlaylistItem(editor, { playlistId: playlist.id, videoId: a.id });
    await setPlaylistItemNote(editor, { playlistId: playlist.id, videoId: b.id, note: "س" });
    await updatePlaylist(editor, playlist.id, { title: "جديد" });
    await setPlaylistPublished(admin, playlist.id, true);
    await setPlaylistArchived(admin, playlist.id, true);
    await deletePlaylist(admin, playlist.id);

    const actions = (await prisma.auditLog.findMany({ where: { entityId: playlist.id } })).map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining(["playlist.create", "playlist.item_add", "playlist.reorder", "playlist.item_remove", "playlist.item_note", "playlist.update", "playlist.publish", "playlist.archive", "playlist.delete"]),
    );
  });
});

describe("importing a YouTube playlist", () => {
  it("stores its details exactly as returned, and its videos in order, published (plan D10)", async () => {
    const videoIds = ids(3);
    mockYouTube({ title: "سلسلة YouTube", videoIds });

    const { id, report } = await importYouTubePlaylist(admin, { url: `https://www.youtube.com/playlist?list=${PLAYLIST_ID}` });

    const playlist = await prisma.playlist.findUniqueOrThrow({ where: { id } });
    expect(playlist).toMatchObject({ type: "YOUTUBE", youtubePlaylistId: PLAYLIST_ID, sourceKey: `yt:${PLAYLIST_ID}`, title: "سلسلة YouTube", description: "وصف من YouTube", channelTitle: "قناة YouTube", status: "DRAFT", syncStatus: "SYNCED", itemCount: 3 });
    expect(report).toMatchObject({ outcome: "SYNCED", itemCount: 3, importedVideos: 3, isTruncated: false });

    const items = await prisma.playlistItem.findMany({ where: { playlistId: id }, orderBy: { position: "asc" }, include: { video: true } });
    expect(items.map((item) => item.video.youtubeVideoId)).toEqual(videoIds);
    // Nothing reaches the feed by being in a playlist.
    expect(items.every((item) => item.video.status === "PUBLISHED" && item.video.reviewedAt === null)).toBe(true);
  });

  it("sends only the validated ID to YouTube", async () => {
    mockYouTube({ title: "س", videoIds: [] });
    await importYouTubePlaylist(admin, { url: `https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${PLAYLIST_ID}&evil=1` });

    expect(requestsTo("playlists")[0]!.searchParams.get("id")).toBe(PLAYLIST_ID);
    expect(requests().every((url) => !url.href.includes("evil"))).toBe(true);
  });

  it.each(["https://example.org/playlist?list=PLtestplaylist0000000001", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ", "not a link", "javascript:alert(1)"])("rejects %s without calling YouTube", async (url) => {
    expect(await codeOf(importYouTubePlaylist(admin, { url }))).toBe("VALIDATION");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses the same playlist twice, without spending quota", async () => {
    mockYouTube({ title: "س", videoIds: ids(1) });
    await importYouTubePlaylist(admin, { url: PLAYLIST_ID });
    fetchMock.mockClear();

    expect(await codeOf(importYouTubePlaylist(admin, { url: PLAYLIST_ID }))).toBe("CONFLICT");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.playlist.count()).toBe(1);
  });

  it("reports a playlist YouTube doesn't have, storing nothing", async () => {
    mockYouTube({ title: "س", videoIds: [], playlistGone: true });
    expect(await codeOf(importYouTubePlaylist(admin, { url: PLAYLIST_ID }))).toBe("NOT_FOUND");
    expect(await prisma.playlist.count()).toBe(0);
  });

  it("reports exhausted quota clearly, never retries it, and stops further calls", async () => {
    fetchMock.mockImplementation(async () => apiError(403, "quotaExceeded"));
    expect(await codeOf(importYouTubePlaylist(admin, { url: PLAYLIST_ID }))).toBe("EXTERNAL_UNAVAILABLE");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(await codeOf(importYouTubePlaylist(admin, { url: PLAYLIST_ID }))).toBe("EXTERNAL_UNAVAILABLE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips private items and videos YouTube no longer has", async () => {
    const videoIds = ids(4);
    mockYouTube({ title: "س", videoIds, privateIds: [videoIds[1]!], missingVideos: [videoIds[2]!] });
    const { id, report } = await importYouTubePlaylist(admin, { url: PLAYLIST_ID });

    expect(report.itemCount).toBe(2);
    const items = await prisma.playlistItem.findMany({ where: { playlistId: id }, orderBy: { position: "asc" }, include: { video: true } });
    expect(items.map((item) => item.video.youtubeVideoId)).toEqual([videoIds[0], videoIds[3]]);
    expect(items.map((item) => item.position)).toEqual([0, 1]);
  });

  it("reads long playlists in batches, and says when it stopped at the limit", async () => {
    mockYouTube({ title: "س", videoIds: ids(520) });
    const { report } = await importYouTubePlaylist(admin, { url: PLAYLIST_ID });

    expect(report.itemCount).toBe(500);
    expect(report.isTruncated).toBe(true);
    expect(requestsTo("playlistItems").length).toBe(10);
    expect(requestsTo("videos").every((url) => (url.searchParams.get("id") ?? "").split(",").length <= 50)).toBe(true);
    expect(requestsTo("playlistItems").every((url) => url.searchParams.get("maxResults") === "50")).toBe(true);
  }, 300_000);

  it("reuses videos already stored, without changing their status or fetching them", async () => {
    const existing = await video({ youtubeVideoId: "ytexisting0" });
    mockYouTube({ title: "س", videoIds: [existing.youtubeVideoId, "ytnewvideo0"] });
    const { report } = await importYouTubePlaylist(admin, { url: PLAYLIST_ID });

    expect(report.importedVideos).toBe(1);
    expect(await prisma.video.count()).toBe(2);
    expect((await prisma.video.findUniqueOrThrow({ where: { id: existing.id } })).status).toBe("PUBLISHED");
    expect(requestsTo("videos").flatMap((url) => (url.searchParams.get("id") ?? "").split(","))).toEqual(["ytnewvideo0"]);
  });
});

describe("syncing a YouTube playlist", () => {
  async function imported(videoIds: string[]) {
    mockYouTube({ title: "الأصل", videoIds });
    const { id } = await importYouTubePlaylist(admin, { url: PLAYLIST_ID });
    return id;
  }

  it("follows YouTube's changes with no duplicates, and running twice changes nothing", async () => {
    const [a, b, c, d] = ids(4);
    const id = await imported([a!, b!, c!]);

    mockYouTube({ title: "عنوان جديد", videoIds: [c!, a!, d!] });
    await syncPlaylistNow(admin, id);
    await syncPlaylistNow(admin, id);

    const items = await prisma.playlistItem.findMany({ where: { playlistId: id }, orderBy: { position: "asc" }, include: { video: true } });
    expect(items.map((item) => item.video.youtubeVideoId)).toEqual([c, a, d]);
    expect(await prisma.video.count()).toBe(4);
    const stored = await prisma.playlist.findUniqueOrThrow({ where: { id } });
    expect(stored).toMatchObject({ title: "عنوان جديد", itemCount: 3 });
    expect(stored.slug).toBe("الأصل");
  });

  it("keeps people's viewing progress through a sync", async () => {
    const [a, b] = ids(2);
    const id = await imported([a!, b!]);
    await setPlaylistPublished(admin, id, true);
    const reader = await createActor(prisma, "USER");
    const stored = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: a! } });
    await recordViewingProgress(reader, { videoId: stored.id, playlistId: id, positionSeconds: 100, durationSeconds: 600 });

    mockYouTube({ title: "الأصل", videoIds: [b!, a!] });
    await syncPlaylistNow(admin, id);
    expect((await getPlaylistProgress(reader, id)).items.map((item) => item.positionSeconds)).toEqual([100]);
  });

  it("leaves the stored list alone when YouTube fails, and records it", async () => {
    const videoIds = ids(2);
    const id = await imported(videoIds);
    fetchMock.mockImplementation(async () => apiError(403, "quotaExceeded"));

    expect(await codeOf(syncPlaylistNow(admin, id))).toBe("EXTERNAL_UNAVAILABLE");
    expect(await prisma.playlistItem.count({ where: { playlistId: id } })).toBe(2);
    expect((await prisma.playlist.findUniqueOrThrow({ where: { id } })).syncStatus).toBe("FAILED");
  });

  it("removes a playlist deleted from YouTube from public pages, keeping the record and its links", async () => {
    const id = await imported(ids(2));
    await setPlaylistPublished(admin, id, true);
    const stored = await prisma.playlist.findUniqueOrThrow({ where: { id } });
    expect(await getPublishedPlaylistBySlug(stored.slug)).not.toBeNull();
    const topic = await prisma.topic.create({ data: { title: "م", slug: `topic-${++counter}`, status: "PUBLISHED" } });
    await addLink(editor, { kind: "playlist.topic", ownerId: id, targetId: topic.id });

    mockYouTube({ title: "", videoIds: [], playlistGone: true });
    expect((await syncPlaylistNow(admin, id)).outcome).toBe("REMOVED_FROM_YOUTUBE");

    expect(await getPublishedPlaylistBySlug(stored.slug)).toBeNull();
    expect((await listPublicPlaylists()).items).toEqual([]);
    expect(await listPublicPlaylistsFor({ topicId: topic.id })).toEqual([]);
    const after = await prisma.playlist.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({ title: "", description: null, syncStatus: "FAILED", itemCount: 0 });
    expect(await prisma.playlistTopic.count({ where: { playlistId: id } })).toBe(1);

    // A later sync that finds it again restores it.
    mockYouTube({ title: "عادت", videoIds: ids(1) });
    await syncPlaylistNow(admin, id);
    expect((await getPublishedPlaylistBySlug(stored.slug))?.playlist.title).toBe("عادت");
  });

  it("can't be run on a curated playlist, and a curated playlist's items can't be edited from YouTube's", async () => {
    const own = await curated();
    expect(await codeOf(syncPlaylistNow(admin, own.id))).toBe("CONFLICT");

    const videoIds = ids(2);
    const id = await imported(videoIds);
    const clip = await video();
    const items = await prisma.playlistItem.findMany({ where: { playlistId: id } });
    expect(await codeOf(addPlaylistItem(editor, { playlistId: id, videoId: clip.id }))).toBe("CONFLICT");
    expect(await codeOf(removePlaylistItem(editor, { playlistId: id, videoId: items[0]!.videoId }))).toBe("CONFLICT");
    expect(await codeOf(reorderPlaylistItems(editor, { playlistId: id, videoIds: items.map((item) => item.videoId).reverse() }))).toBe("CONFLICT");
  });

  it("never lets YouTube's title or description be changed here", async () => {
    const id = await imported(ids(1));
    expect(await codeOf(updatePlaylist(editor, id, { title: "عنوان مختلف" }))).toBe("VALIDATION");
    expect(await codeOf(updatePlaylist(editor, id, { description: "وصف مختلف" }))).toBe("VALIDATION");
    expect((await updatePlaylist(editor, id, { introduction: "مقدمة من الفريق" })).introduction).toBe("مقدمة من الفريق");
    expect((await prisma.playlist.findUniqueOrThrow({ where: { id } })).title).toBe("الأصل");
  });

  it("shows every available item of a published YouTube playlist, and its videos are published elsewhere too (plan D10)", async () => {
    const id = await imported(ids(2));
    const live = await setPlaylistPublished(admin, id, true);

    const page = await getPublishedPlaylistBySlug(live.slug);
    expect(page!.items).toHaveLength(2);
    expect(await getPublicVideo(page!.items[0]!.videoId)).not.toBeNull();
  });
});

describe("the 30-day refresh", () => {
  it("syncs playlists that are due, and leaves fresh ones alone", async () => {
    mockYouTube({ title: "الأصل", videoIds: ids(1) });
    const { id } = await importYouTubePlaylist(admin, { url: PLAYLIST_ID });
    fetchMock.mockClear();

    const fresh = await runMetadataRefresh();
    expect(fresh.playlistsSynced).toBe(0);
    expect(requestsTo("playlists")).toHaveLength(0);

    await prisma.playlist.update({ where: { id }, data: { metadataFetchedAt: new Date(Date.now() - 26 * DAY) } });
    mockYouTube({ title: "محدّث", videoIds: ids(1) });
    const due = await runMetadataRefresh();
    expect(due.playlistsSynced).toBe(1);

    const stored = await prisma.playlist.findUniqueOrThrow({ where: { id } });
    expect(stored.title).toBe("محدّث");
    expect(stored.metadataFetchedAt!.getTime()).toBeGreaterThan(Date.now() - DAY);
  });

  it("notices a playlist deleted from YouTube", async () => {
    mockYouTube({ title: "الأصل", videoIds: ids(1) });
    const { id } = await importYouTubePlaylist(admin, { url: PLAYLIST_ID });
    await prisma.playlist.update({ where: { id }, data: { metadataFetchedAt: new Date(Date.now() - 26 * DAY) } });

    mockYouTube({ title: "", videoIds: [], playlistGone: true });
    expect((await runMetadataRefresh()).playlistsRemoved).toBe(1);
    expect((await prisma.playlist.findUniqueOrThrow({ where: { id } })).title).toBe("");
  });

  it("withdraws data past 30 days even when YouTube can't be reached", async () => {
    mockYouTube({ title: "الأصل", videoIds: ids(1) });
    const { id } = await importYouTubePlaylist(admin, { url: PLAYLIST_ID });
    const live = await setPlaylistPublished(admin, id, true);
    await prisma.playlist.update({ where: { id }, data: { metadataFetchedAt: new Date(Date.now() - 31 * DAY) } });
    await prisma.video.updateMany({ data: { metadataFetchedAt: new Date() } });

    fetchMock.mockImplementation(async () => apiError(403, "quotaExceeded"));
    const report = await runMetadataRefresh();

    expect(report.stoppedBy).toBe("QUOTA_EXCEEDED");
    expect(report.playlistsWithdrawn).toBe(1);
    const stored = await prisma.playlist.findUniqueOrThrow({ where: { id } });
    expect(stored).toMatchObject({ title: "", description: null, channelTitle: null, thumbnails: [], itemCount: 0 });
    expect(await prisma.playlistItem.count({ where: { playlistId: id } })).toBe(0);
    expect(await getPublishedPlaylistBySlug(live.slug)).toBeNull();
    expect(await codeOf(setPlaylistPublished(admin, id, true))).toBe("CONFLICT");
  });

  it("never touches curated playlists", async () => {
    const playlist = await curated([await video()]);
    await prisma.playlist.update({ where: { id: playlist.id }, data: { metadataFetchedAt: new Date(Date.now() - 40 * DAY) } });
    await prisma.video.updateMany({ data: { metadataFetchedAt: new Date() } });
    const report = await runMetadataRefresh();
    expect(report.playlistsSynced + report.playlistsWithdrawn).toBe(0);
    expect((await prisma.playlist.findUniqueOrThrow({ where: { id: playlist.id } })).title).toBe(playlist.title);
  });
});

describe("viewing progress", () => {
  it("records and returns only the person's own", async () => {
    const clip = await video();
    const playlist = await publishedCurated([clip]);
    const [reader, other] = [await createActor(prisma, "USER"), await createActor(prisma, "USER")];

    await recordViewingProgress(reader, { videoId: clip.id, playlistId: playlist.id, positionSeconds: 120, durationSeconds: 600 });

    const progress = await getPlaylistProgress(reader, playlist.id);
    expect(progress.lastVideoId).toBe(clip.id);
    expect(progress.items).toEqual([{ videoId: clip.id, positionSeconds: 120, durationSeconds: 600, isCompleted: false }]);
    expect((await getPlaylistProgress(other, playlist.id)).items).toEqual([]);
  });

  it("is for signed-in people, and can't be sent for someone else", async () => {
    const clip = await video();
    const playlist = await publishedCurated([clip]);
    const reader = await createActor(prisma, "USER");

    expect(await codeOf(recordViewingProgress(null, { videoId: clip.id, positionSeconds: 1 }))).toBe("UNAUTHENTICATED");
    expect(await codeOf(getPlaylistProgress(null, playlist.id))).toBe("UNAUTHENTICATED");
    expect(await codeOf(recordViewingProgress(reader, { videoId: clip.id, positionSeconds: 1, userId: admin.id }))).toBe("VALIDATION");
  });

  it("marks completion at the end, keeps it when rewatching, and clamps nonsense", async () => {
    const clip = await video();
    const playlist = await publishedCurated([clip]);
    const reader = await createActor(prisma, "USER");
    const send = (input: Record<string, unknown>) => recordViewingProgress(reader, { videoId: clip.id, playlistId: playlist.id, durationSeconds: 600, ...input });
    const read = async () => (await getPlaylistProgress(reader, playlist.id)).items[0]!;

    await send({ positionSeconds: 590 });
    expect((await read()).isCompleted).toBe(true);

    await send({ positionSeconds: 5 });
    expect(await read()).toMatchObject({ positionSeconds: 5, isCompleted: true });

    await send({ positionSeconds: 99_999 });
    expect((await read()).positionSeconds).toBe(600);

    expect(await codeOf(send({ positionSeconds: -1 }))).toBe("VALIDATION");
    expect(await codeOf(send({ positionSeconds: Number.NaN }))).toBe("VALIDATION");
  });

  it("refuses videos and playlists the public can't see", async () => {
    const reader = await createActor(prisma, "USER");
    const clip = await video();
    const other = await video();
    const live = await publishedCurated([clip]);
    const draft = await curated([clip]);
    const hidden = await video({ status: "DRAFT" });

    expect(await codeOf(recordViewingProgress(reader, { videoId: other.id, playlistId: live.id, positionSeconds: 10 }))).toBe("NOT_FOUND");
    expect(await codeOf(recordViewingProgress(reader, { videoId: clip.id, playlistId: draft.id, positionSeconds: 10 }))).toBe("NOT_FOUND");
    expect(await codeOf(recordViewingProgress(reader, { videoId: hidden.id, positionSeconds: 10 }))).toBe("NOT_FOUND");
  });

  it("keeps a video's progress separate per playlist, and outside any playlist", async () => {
    const clip = await video();
    const [a, b] = [await publishedCurated([clip]), await publishedCurated([clip])];
    const reader = await createActor(prisma, "USER");

    await recordViewingProgress(reader, { videoId: clip.id, playlistId: a.id, positionSeconds: 10, durationSeconds: 600 });
    await recordViewingProgress(reader, { videoId: clip.id, playlistId: b.id, positionSeconds: 20, durationSeconds: 600 });
    await recordViewingProgress(reader, { videoId: clip.id, positionSeconds: 30, durationSeconds: 600 });

    expect((await getPlaylistProgress(reader, a.id)).items[0]!.positionSeconds).toBe(10);
    expect((await getPlaylistProgress(reader, b.id)).items[0]!.positionSeconds).toBe(20);
    expect((await getVideoProgress(reader, clip.id))?.positionSeconds).toBe(30);
    expect(await prisma.viewingProgress.count()).toBe(3);
  });
});

describe("the knowledge network", () => {
  it("links from the playlist's side, and shows only what's public", async () => {
    const topic = await prisma.topic.create({ data: { title: "موضوع", slug: `t-${++counter}`, status: "PUBLISHED" } });
    const draftTopic = await prisma.topic.create({ data: { title: "مسودة", slug: `t-${++counter}` } });
    const library = await prisma.library.create({ data: { name: "مكتبة", slug: `l-${++counter}`, status: "PUBLISHED" } });
    const article = await prisma.article.create({ data: { title: "مقال", slug: `a-${++counter}`, body: {}, status: "PUBLISHED" } });
    const playlist = await publishedCurated([await video()]);

    await addLink(editor, { kind: "playlist.topic", ownerId: playlist.id, targetId: topic.id });
    await addLink(editor, { kind: "playlist.topic", ownerId: playlist.id, targetId: draftTopic.id });
    await addLink(editor, { kind: "playlist.library", ownerId: playlist.id, targetId: library.id });
    await addLink(editor, { kind: "playlist.article", ownerId: playlist.id, targetId: article.id });

    const connections = await getPlaylistConnections(playlist.id);
    expect(connections.topics.map((row) => row.id)).toEqual([topic.id]);
    expect(connections.libraries.map((row) => row.id)).toEqual([library.id]);
    expect(connections.articles.map((row) => row.id)).toEqual([article.id]);

    expect((await listLinks(editor, { kind: "playlist.topic", ownerId: playlist.id })).items).toHaveLength(2);
    await removeLink(editor, { kind: "playlist.topic", ownerId: playlist.id, targetId: draftTopic.id });
    expect((await listLinks(editor, { kind: "playlist.topic", ownerId: playlist.id })).items).toHaveLength(1);

    expect((await listPublicPlaylistsFor({ topicId: topic.id })).map((row) => row.id)).toEqual([playlist.id]);
    expect((await listPublicPlaylistsFor({ libraryId: library.id })).map((row) => row.id)).toEqual([playlist.id]);
    expect((await listPublicPlaylistsFor({ articleId: article.id })).map((row) => row.id)).toEqual([playlist.id]);
  });

  it("calls playlists related when they share a topic, public ones only", async () => {
    const topic = await prisma.topic.create({ data: { title: "موضوع", slug: `t-${++counter}`, status: "PUBLISHED" } });
    const clip = await video();
    const [main, sibling, stranger] = [await publishedCurated([clip]), await publishedCurated([clip]), await publishedCurated([clip])];
    const hidden = await curated([clip]);
    for (const playlist of [main, sibling, hidden]) await addLink(editor, { kind: "playlist.topic", ownerId: playlist.id, targetId: topic.id });

    const related = (await getPlaylistConnections(main.id)).related.map((row) => row.id);
    expect(related).toEqual([sibling.id]);
    expect(related).not.toContain(stranger.id);
  });

  it("leaves nothing behind when deleted, and keeps its videos", async () => {
    const clip = await video();
    const playlist = await publishedCurated([clip]);
    const topic = await prisma.topic.create({ data: { title: "م", slug: `t-${++counter}`, status: "PUBLISHED" } });
    const article = await prisma.article.create({ data: { title: "م", slug: `a-${++counter}`, body: {}, status: "PUBLISHED" } });
    const reader = await createActor(prisma, "USER");
    await addLink(editor, { kind: "playlist.topic", ownerId: playlist.id, targetId: topic.id });
    await addLink(editor, { kind: "playlist.article", ownerId: playlist.id, targetId: article.id });
    await recordViewingProgress(reader, { videoId: clip.id, playlistId: playlist.id, positionSeconds: 10, durationSeconds: 600 });
    await prisma.video.update({ where: { id: clip.id }, data: { cta: { type: "CURATED_PLAYLIST", targetId: playlist.id } } });
    await prisma.favorite.create({ data: { userId: reader.id, entityType: "PLAYLIST", entityId: playlist.id } });

    await deletePlaylist(admin, playlist.id);

    expect(await prisma.playlist.count({ where: { id: playlist.id } })).toBe(0);
    expect(await prisma.playlistItem.count({ where: { playlistId: playlist.id } })).toBe(0);
    expect(await prisma.playlistTopic.count({ where: { playlistId: playlist.id } })).toBe(0);
    expect(await prisma.articlePlaylist.count({ where: { playlistId: playlist.id } })).toBe(0);
    expect(await prisma.viewingProgress.count({ where: { scopeKey: `playlist:${playlist.id}` } })).toBe(0);
    expect(await prisma.favorite.count({ where: { entityId: playlist.id } })).toBe(0);
    const kept = await prisma.video.findUniqueOrThrow({ where: { id: clip.id } });
    expect(kept.cta).toBeNull();
  });

  it("gives a video's CTA a working destination, which disappears when the playlist is hidden", async () => {
    const playlist = await publishedCurated([await video()]);
    const clip = await video({ cta: { type: "CURATED_PLAYLIST", targetId: playlist.id } });
    expect((await getPublicVideo(clip.id))?.cta).toEqual({ type: "CURATED_PLAYLIST", label: null, href: `/playlists/${encodeURIComponent(playlist.slug)}`, isExternal: false });

    await setPlaylistPublished(admin, playlist.id, false);
    expect((await getPublicVideo(clip.id))?.cta).toBeNull();
  });
});
