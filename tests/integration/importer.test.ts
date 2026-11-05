import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getFeedPage, getPublicVideo } from "@/features/shorts/feed.service";
import { listChannels, setChannelActive } from "@/features/youtube/channels.service";
import {
  assignSelectedCandidates,
  cancelImportJob,
  deleteImportJob,
  getImporterOverview,
  getJobSummary,
  listImportJobs,
  pauseImportJob,
  resumeImportJob,
  getImportJob,
  listCandidates,
  runDiscoveryStep,
  runImportStep,
  setCandidatesSelected,
  startChannelImport,
  startChannelSync,
} from "@/features/youtube/import/import.service";
import { runMetadataRefresh } from "@/features/youtube/metadata-refresh.service";
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
  videoIds: string[];
  /** Video IDs that are long-form. The rest are 40 seconds. */
  longIds?: string[];
  notEmbeddable?: string[];
  missing?: string[];
  quotaAfterPages?: number;
}

function mockChannel(state: MockChannel) {
  let pages = 0;
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/channels")) {
      return json({ items: [{ id: CHANNEL_ID, snippet: { title: "قناة تجريبية", customUrl: "@test", thumbnails: { default: { url: "https://yt3.ggpht.com/a.jpg" } } }, contentDetails: { relatedPlaylists: { uploads: UPLOADS } } }] });
    }
    if (url.pathname.endsWith("/playlistItems")) {
      pages += 1;
      if (state.quotaAfterPages !== undefined && pages > state.quotaAfterPages) return apiError(403, "quotaExceeded");
      const start = Number(url.searchParams.get("pageToken") ?? 0);
      const page = state.videoIds.slice(start, start + 50);
      const next = start + 50 < state.videoIds.length ? String(start + 50) : undefined;
      return json({ ...(next ? { nextPageToken: next } : {}), items: page.map((id) => ({ contentDetails: { videoId: id }, status: { privacyStatus: "public" } })) });
    }
    if (url.pathname.endsWith("/videos")) {
      const wanted = (url.searchParams.get("id") ?? "").split(",").filter((id) => id && !state.missing?.includes(id));
      return json({
        items: wanted.map((id) => ({
          id,
          snippet: { title: `عنوان ${id}`, channelId: CHANNEL_ID, channelTitle: "قناة تجريبية", publishedAt: "2026-01-01T00:00:00Z", thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } } },
          contentDetails: { duration: state.longIds?.includes(id) ? "PT20M" : "PT40S" },
          status: { embeddable: !state.notEmbeddable?.includes(id), privacyStatus: "public", uploadStatus: "processed" },
        })),
      });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
}

async function discover(jobId: string, actor: Actor = admin) {
  for (let step = 0; step < 200; step += 1) {
    const progress = await runDiscoveryStep(actor, jobId);
    if (progress.status !== "DISCOVERING") return progress;
  }
  throw new Error("Discovery never finished");
}

async function importAll(jobId: string, actor: Actor = admin) {
  for (let step = 0; step < 200; step += 1) {
    const progress = await runImportStep(actor, jobId);
    if (progress.status === "COMPLETED" || progress.status === "CANCELLED") return progress;
  }
  throw new Error("Import never finished");
}

async function prepared(state: MockChannel) {
  mockChannel(state);
  const { jobId } = await startChannelImport(admin, { input: "@test" });
  await discover(jobId);
  return jobId;
}

const allCandidates = async (jobId: string) => (await listCandidates(admin, { jobId })).items;

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
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("starting an import", () => {
  it.each(["@test", "test", `https://www.youtube.com/@test`, `https://www.youtube.com/channel/${CHANNEL_ID}`, CHANNEL_ID, "https://youtube.com/user/testuser"])("resolves %s to a channel and its uploads list", async (input) => {
    mockChannel({ videoIds: [] });
    const { jobId } = await startChannelImport(admin, { input });

    const channel = await prisma.youTubeChannel.findFirstOrThrow();
    expect(channel).toMatchObject({ youtubeChannelId: CHANNEL_ID, uploadsPlaylistId: UPLOADS, title: "قناة تجريبية", handle: "@test" });
    expect((await getImportJob(admin, jobId)).status).toBe("DISCOVERING");
  });

  it.each(["https://example.org/@test", "https://youtube.com.evil.example/@test", "javascript:alert(1)", "@a", "not a channel at all !!"])("rejects %s without calling YouTube", async (input) => {
    expect(await codeOf(startChannelImport(admin, { input }))).toBe("VALIDATION");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains legacy /c/ addresses, which the API can't resolve, and never uses search", async () => {
    expect(await codeOf(startChannelImport(admin, { input: "https://www.youtube.com/c/SomeName" }))).toBe("VALIDATION");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unknown channel", async () => {
    fetchMock.mockImplementation(async () => json({ items: [] }));
    expect(await codeOf(startChannelImport(admin, { input: "@nobody" }))).toBe("NOT_FOUND");
    expect(await prisma.importJob.count()).toBe(0);
  });

  it("requires the import permission, on the server, for every step", async () => {
    const jobId = await prepared({ videoIds: ids(1) });
    fetchMock.mockClear();
    const editor = await createActor(prisma, "EDITOR");
    const contributor = await createActor(prisma, "CONTRIBUTOR");

    for (const actor of [editor, contributor, null]) {
      const expected = actor ? "FORBIDDEN" : "UNAUTHENTICATED";
      expect(await codeOf(startChannelImport(actor, { input: "@test" }))).toBe(expected);
      expect(await codeOf(runDiscoveryStep(actor, jobId))).toBe(expected);
      expect(await codeOf(runImportStep(actor, jobId))).toBe(expected);
      expect(await codeOf(listCandidates(actor, { jobId }))).toBe(expected);
      expect(await codeOf(setCandidatesSelected(actor, { jobId, isSelected: true, filter: {} }))).toBe(expected);
      expect(await codeOf(assignSelectedCandidates(actor, { jobId }))).toBe(expected);
      expect(await codeOf(cancelImportJob(actor, jobId))).toBe(expected);
      expect(await codeOf(startChannelSync(actor, "507f1f77bcf86cd799439011"))).toBe(expected);
    }
    expect(fetchMock).not.toHaveBeenCalled();

    const granted = await createActor(prisma, "EDITOR", ["youtube.import"]);
    expect((await listCandidates(granted, { jobId })).items).toHaveLength(1);
  });
});

describe("discovery", () => {
  it("uses the uploads list and batches, with one metadata request per page, and never search", async () => {
    const jobId = await prepared({ videoIds: ids(120) });

    expect(requestsTo("search")).toHaveLength(0);
    expect(requestsTo("playlistItems")).toHaveLength(3);
    expect(requestsTo("playlistItems").every((url) => url.searchParams.get("playlistId") === UPLOADS && url.searchParams.get("maxResults") === "50")).toBe(true);
    expect(requestsTo("videos")).toHaveLength(3);
    expect(requestsTo("videos").every((url) => (url.searchParams.get("id") ?? "").split(",").length <= 50)).toBe(true);
    expect((await getImportJob(admin, jobId)).discoveredCount).toBe(120);
    expect(await prisma.importCandidate.count({ where: { jobId } })).toBe(120);
  }, 180_000);

  it("creates candidates only, and marks them for review without claiming what they are", async () => {
    const [short, long] = ids(2);
    const jobId = await prepared({ videoIds: [short!, long!], longIds: [long!] });

    const candidates = await allCandidates(jobId);
    expect(candidates.find((row) => row.youtubeVideoId === short)!.classification).toBe("SHORT_CANDIDATE");
    expect(candidates.find((row) => row.youtubeVideoId === long)!.classification).toBe("LONG_FORM_CANDIDATE");
    expect(await prisma.video.count()).toBe(0);
  });

  it("gives previews an expiry inside YouTube's 30-day limit", async () => {
    const jobId = await prepared({ videoIds: ids(1) });
    const candidate = await prisma.importCandidate.findFirstOrThrow({ where: { jobId } });
    expect(candidate.expiresAt.getTime() - Date.now()).toBeLessThan(30 * DAY);
    expect(candidate.expiresAt.getTime() - Date.now()).toBeGreaterThan(28 * DAY);
  });

  it("repeating a step can't create duplicates", async () => {
    mockChannel({ videoIds: ids(3) });
    const { jobId } = await startChannelImport(admin, { input: "@test" });
    await Promise.all([runDiscoveryStep(admin, jobId), runDiscoveryStep(admin, jobId).catch(() => null)]);
    await prisma.importJob.update({ where: { id: jobId }, data: { status: "DISCOVERING", nextPageToken: null } });
    await runDiscoveryStep(admin, jobId);
    expect(await prisma.importCandidate.count({ where: { jobId } })).toBe(3);
  });

  it("pauses clearly when quota runs out, never retries, and resumes from the same page", async () => {
    const videoIds = ids(120);
    mockChannel({ videoIds, quotaAfterPages: 1 });
    const { jobId } = await startChannelImport(admin, { input: "@test" });

    const first = await runDiscoveryStep(admin, jobId);
    expect(first.status).toBe("DISCOVERING");
    const paused = await runDiscoveryStep(admin, jobId);
    expect(paused.status).toBe("PAUSED");
    expect(paused.message).toBeTruthy();
    expect((await getImportJob(admin, jobId)).errors).toHaveLength(1);

    const calls = requestsTo("playlistItems").length;
    // YouTube's quota resets, and the same job carries on with what it already has.
    await prisma.apiQuotaUsage.deleteMany();
    mockChannel({ videoIds });
    await resumeImportJob(admin, jobId);
    const done = await discover(jobId);
    expect(done.status).toBe("READY_FOR_REVIEW");
    expect(done.discoveredCount).toBe(120);
    expect(requestsTo("playlistItems").length).toBeGreaterThan(calls);
    expect(await prisma.importCandidate.count({ where: { jobId } })).toBe(120);
  }, 180_000);

  it("skips a video YouTube no longer returns", async () => {
    const [a, b] = ids(2);
    const jobId = await prepared({ videoIds: [a!, b!], missing: [b!] });
    expect((await allCandidates(jobId)).map((row) => row.youtubeVideoId)).toEqual([a]);
  });
});

describe("the preview", () => {
  it("has all six filters, matching across every page", async () => {
    const videoIds = ids(4);
    const [a, b, c, d] = videoIds;
    await prisma.video.create({ data: { youtubeVideoId: a!, kind: "SHORT", classification: "SHORT_CANDIDATE", title: "موجود", feedKey: 1 } });
    const jobId = await prepared({ videoIds, longIds: [c!, d!] });
    await setCandidatesSelected(admin, { jobId, isSelected: true, filter: { classification: "LONG_FORM_CANDIDATE" } });

    const list = async (filter: Record<string, unknown>) => (await listCandidates(admin, { jobId, filter })).items.map((row) => row.youtubeVideoId).sort();
    expect(await list({ classification: "SHORT_CANDIDATE" })).toEqual([a, b].sort());
    expect(await list({ classification: "LONG_FORM_CANDIDATE" })).toEqual([c, d].sort());
    expect(await list({ imported: true })).toEqual([a]);
    expect(await list({ imported: false })).toEqual([b, c, d].sort());
    expect(await list({ selected: true })).toEqual([c, d].sort());
    expect(await list({ selected: false })).toEqual([a, b].sort());
  });

  it("shows everything needed to decide", async () => {
    const jobId = await prepared({ videoIds: ids(1) });
    const [row] = await allCandidates(jobId);
    expect(row).toMatchObject({ title: `عنوان ${ids(1)[0]}`, channelTitle: "قناة تجريبية", durationSeconds: 40, alreadyImported: false, isSelected: false });
    expect(row!.thumbnails.length).toBeGreaterThan(0);
    expect(row!.ytPublishedAt).toBeInstanceOf(Date);
  });

  it("pages without repeats", async () => {
    const jobId = await prepared({ videoIds: ids(70) });
    const first = await listCandidates(admin, { jobId });
    expect(first.items).toHaveLength(50);
    expect(first.matching).toBe(70);
    const second = await listCandidates(admin, { jobId, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(20);
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(70);
  }, 120_000);

  it("won't select what's already imported or can't be embedded", async () => {
    const [existing, blocked, fine] = ids(3);
    await prisma.video.create({ data: { youtubeVideoId: existing!, kind: "SHORT", classification: "SHORT_CANDIDATE", title: "موجود", feedKey: 1 } });
    const jobId = await prepared({ videoIds: [existing!, blocked!, fine!], notEmbeddable: [blocked!] });

    const { changed } = await setCandidatesSelected(admin, { jobId, isSelected: true, filter: {} });
    expect(changed).toBe(1);
    expect((await listCandidates(admin, { jobId, filter: { selected: true } })).items.map((row) => row.youtubeVideoId)).toEqual([fine]);
  });

  it("rejects assignments to things that don't exist, or to YouTube's playlists", async () => {
    const jobId = await prepared({ videoIds: ids(1) });
    const missing = "507f1f77bcf86cd799439011";
    expect(await codeOf(assignSelectedCandidates(admin, { jobId, categoryId: missing }))).toBe("VALIDATION");
    expect(await codeOf(assignSelectedCandidates(admin, { jobId, topicIds: [missing] }))).toBe("VALIDATION");
    const youtubePlaylist = await prisma.playlist.create({ data: { type: "YOUTUBE", title: "س", slug: "s", sourceKey: "yt:s" } });
    expect(await codeOf(assignSelectedCandidates(admin, { jobId, playlistIds: [youtubePlaylist.id] }))).toBe("VALIDATION");
  });
});

describe("importing", () => {
  it("imports only what's selected, as drafts, with assignments, and reports the outcome", async () => {
    const videoIds = ids(3);
    const [a, b, c] = videoIds;
    const category = await prisma.category.create({ data: { title: "الفقه", slug: "fiqh" } });
    const topic = await prisma.topic.create({ data: { title: "موضوع", slug: "t", status: "PUBLISHED" } });
    const library = await prisma.library.create({ data: { name: "مكتبة", slug: "l", status: "PUBLISHED" } });
    const playlist = await prisma.playlist.create({ data: { type: "CURATED", title: "سلسلة", slug: "p", sourceKey: "cur:p" } });
    const jobId = await prepared({ videoIds, longIds: [c!] });

    const rows = await allCandidates(jobId);
    const idOf = (youtubeId: string) => rows.find((row) => row.youtubeVideoId === youtubeId)!.id;
    await setCandidatesSelected(admin, { jobId, isSelected: true, candidateIds: [idOf(a!), idOf(c!)] });
    await assignSelectedCandidates(admin, { jobId, categoryId: category.id, topicIds: [topic.id], libraryIds: [library.id], playlistIds: [playlist.id] });
    fetchMock.mockClear();

    const done = await importAll(jobId);
    expect(done).toMatchObject({ status: "COMPLETED", importedCount: 2, duplicateCount: 0, failedCount: 0, skippedCount: 1 });
    // The metadata was already fetched for the preview, so importing spends no quota.
    expect(fetchMock).not.toHaveBeenCalled();

    expect(await prisma.video.count({ where: { youtubeVideoId: b! } })).toBe(0);
    const video = await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: a! } });
    expect(video).toMatchObject({ status: "DRAFT", kind: "SHORT", classification: "SHORT_CANDIDATE", categoryId: category.id, availability: "AVAILABLE", topicIds: [topic.id], libraryIds: [library.id], reviewedAt: null });
    expect(await prisma.videoTopic.count({ where: { videoId: video.id, topicId: topic.id } })).toBe(1);
    expect(await prisma.videoLibrary.count({ where: { videoId: video.id, libraryId: library.id } })).toBe(1);
    expect(await prisma.playlistItem.count({ where: { playlistId: playlist.id } })).toBe(2);
    expect((await prisma.playlist.findUniqueOrThrow({ where: { id: playlist.id } })).itemCount).toBe(2);
    expect((await prisma.video.findUniqueOrThrow({ where: { youtubeVideoId: c! } })).kind).toBe("LONG_FORM");
  });

  it("never publishes automatically, so imports reach neither the feed nor public pages", async () => {
    const category = await prisma.category.create({ data: { title: "الفقه", slug: "fiqh" } });
    const jobId = await prepared({ videoIds: ids(2) });
    await setCandidatesSelected(admin, { jobId, isSelected: true, filter: {} });
    await assignSelectedCandidates(admin, { jobId, kind: "SHORT", categoryId: category.id });
    await importAll(jobId);

    expect(await prisma.video.count({ where: { status: "PUBLISHED" } })).toBe(0);
    const video = await prisma.video.findFirstOrThrow();
    expect(await getPublicVideo(video.id)).toBeNull();
    expect((await getFeedPage(null, {})).items).toEqual([]);
  });

  it("records a person's choice of kind as the review, and otherwise leaves it for review", async () => {
    const jobId = await prepared({ videoIds: ids(1) });
    await setCandidatesSelected(admin, { jobId, isSelected: true, filter: {} });
    await assignSelectedCandidates(admin, { jobId, kind: "LONG_FORM" });
    await importAll(jobId);

    const video = await prisma.video.findFirstOrThrow();
    expect(video.kind).toBe("LONG_FORM");
    expect(video.classification).toBe("SHORT_CANDIDATE");
    expect(video.reviewedAt).not.toBeNull();
  });

  it("keeps YouTube's fetch time, so the 30-day clock stays honest", async () => {
    const jobId = await prepared({ videoIds: ids(1) });
    await setCandidatesSelected(admin, { jobId, isSelected: true, filter: {} });
    await prisma.importCandidate.updateMany({ data: { createdAt: new Date(Date.now() - 10 * DAY) } });
    await importAll(jobId);

    const video = await prisma.video.findFirstOrThrow();
    expect(Date.now() - video.metadataFetchedAt!.getTime()).toBeGreaterThan(9 * DAY);
  });

  it("counts a video imported meanwhile as a duplicate, and makes no second record", async () => {
    const [a] = ids(1);
    const jobId = await prepared({ videoIds: [a!] });
    await setCandidatesSelected(admin, { jobId, isSelected: true, filter: {} });
    await prisma.video.create({ data: { youtubeVideoId: a!, kind: "SHORT", classification: "SHORT_CANDIDATE", title: "سبق استيراده", feedKey: 1 } });

    const done = await importAll(jobId);
    expect(done).toMatchObject({ importedCount: 0, duplicateCount: 1 });
    expect(await prisma.video.count()).toBe(1);
    expect((await prisma.video.findFirstOrThrow()).title).toBe("سبق استيراده");
  });

  it("works in batches, and carries on after the browser closes", async () => {
    const jobId = await prepared({ videoIds: ids(30) });
    await setCandidatesSelected(admin, { jobId, isSelected: true, filter: {} });

    const first = await runImportStep(admin, jobId);
    expect(first).toMatchObject({ status: "IMPORTING", importedCount: 25 });

    // A fresh request, as after closing and reopening the page.
    const done = await importAll(jobId);
    expect(done).toMatchObject({ status: "COMPLETED", importedCount: 30 });
    expect(await prisma.video.count()).toBe(30);
  }, 120_000);

  it("can be cancelled, keeping what's done, and importing nothing more", async () => {
    const jobId = await prepared({ videoIds: ids(30) });
    await setCandidatesSelected(admin, { jobId, isSelected: true, filter: {} });
    await prisma.importJob.update({ where: { id: jobId }, data: { status: "IMPORTING" } });
    await runImportStep(admin, jobId);

    await cancelImportJob(admin, jobId);
    const after = await runImportStep(admin, jobId);
    expect(after.status).toBe("CANCELLED");
    expect(await prisma.video.count()).toBe(25);
    expect(await codeOf(cancelImportJob(admin, jobId))).toBe("CONFLICT");
  }, 120_000);

  it("a second import of the same channel finds them already imported, and adds nothing", async () => {
    const videoIds = ids(2);
    const first = await prepared({ videoIds });
    await setCandidatesSelected(admin, { jobId: first, isSelected: true, filter: {} });
    await importAll(first);

    const second = await prepared({ videoIds });
    const rows = await allCandidates(second);
    expect(rows.every((row) => row.alreadyImported)).toBe(true);
    const { changed } = await setCandidatesSelected(admin, { jobId: second, isSelected: true, filter: {} });
    expect(changed).toBe(0);
    expect(await prisma.video.count()).toBe(2);
    expect(await prisma.youTubeChannel.count()).toBe(1);
  });

  it("audits starting, cancelling, and the final result", async () => {
    const jobId = await prepared({ videoIds: ids(1) });
    await setCandidatesSelected(admin, { jobId, isSelected: true, filter: {} });
    await importAll(jobId);
    const actions = (await prisma.auditLog.findMany({ where: { entityId: jobId } })).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["import.start", "import.complete"]));
  });
});

describe("syncing a channel", () => {
  async function importedChannel(videoIds: string[]) {
    const jobId = await prepared({ videoIds });
    await setCandidatesSelected(admin, { jobId, isSelected: true, filter: {} });
    await importAll(jobId);
    return prisma.youTubeChannel.findFirstOrThrow();
  }

  it("discovers only what's new, for review, with no duplicates", async () => {
    const old = ids(3);
    const channel = await importedChannel(old);
    const fresh = ids(2, "n");

    mockChannel({ videoIds: [...fresh, ...old] });
    const { jobId } = await startChannelSync(admin, channel.id);
    const progress = await discover(jobId);

    expect(progress.status).toBe("READY_FOR_REVIEW");
    expect((await allCandidates(jobId)).map((row) => row.youtubeVideoId).sort()).toEqual([...fresh].sort());
    // Found for review, and not imported until someone chooses them.
    expect(await prisma.video.count()).toBe(3);
    expect((await prisma.youTubeChannel.findUniqueOrThrow({ where: { id: channel.id } })).lastSyncedAt).not.toBeNull();
  });

  it("stops at the first page with nothing new, and spends no quota on what's known", async () => {
    const old = ids(120);
    const channel = await importedChannel(old);
    fetchMock.mockClear();

    mockChannel({ videoIds: old });
    const { jobId } = await startChannelSync(admin, channel.id);
    const progress = await discover(jobId);

    expect(progress.discoveredCount).toBe(0);
    expect(requestsTo("playlistItems")).toHaveLength(1);
    expect(requestsTo("videos")).toHaveLength(0);
  }, 300_000);

  it("reports a channel that doesn't exist here", async () => {
    expect(await codeOf(startChannelSync(admin, "507f1f77bcf86cd799439011"))).toBe("NOT_FOUND");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("what the screens report", () => {
  it("summarises what a job fetched, from stored data, spending no quota", async () => {
    const jobId = await prepared({ videoIds: ids(4), longIds: ids(4).slice(3) });
    fetchMock.mockClear();

    const summary = await getJobSummary(admin, jobId);
    expect(summary).toMatchObject({ total: 4, shorts: 3, longs: 1, alreadyImported: 0, selected: 0 });
    expect(summary.totalSeconds).toBeGreaterThan(0);
    expect(summary.oldest).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives each job in the list its own counts and channel details", async () => {
    const jobId = await prepared({ videoIds: ids(3) });
    const { items } = await listImportJobs(admin);
    const row = items.find((job) => job.id === jobId);
    expect(row).toMatchObject({ shortCount: 3, longCount: 0 });
    expect(row?.channel.youtubeChannelId).toBe(CHANNEL_ID);
  });

  it("totals the importer's numbers, and shortens long descriptions for the cards", async () => {
    const jobId = await prepared({ videoIds: ids(2) });
    await prisma.importCandidate.updateMany({ where: { jobId }, data: { description: "و".repeat(5000) } });

    expect(await getImporterOverview(admin)).toMatchObject({ channels: 1, discovered: 2, imported: 0, needsReview: 1, unfinished: 0 });
    const { items } = await listCandidates(admin, { jobId });
    expect(items[0]?.description?.length).toBeLessThanOrEqual(220);
  });

  it("is only for people who can import", async () => {
    const jobId = await prepared({ videoIds: ids(1) });
    const contributor = await createActor(prisma, "CONTRIBUTOR");
    expect(await codeOf(getJobSummary(contributor, jobId))).toBe("FORBIDDEN");
    expect(await codeOf(getImporterOverview(contributor))).toBe("FORBIDDEN");
  });
});

describe("pausing and resuming", () => {
  beforeEach(() => {
    mockChannel({ videoIds: ids(120) });
  });

  it("pauses without losing its place, and continues from the same page", async () => {
    const { jobId } = await startChannelImport(admin, { input: "@test" });
    await runDiscoveryStep(admin, jobId);
    const before = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(before.nextPageToken).not.toBeNull();

    await pauseImportJob(admin, jobId);
    const paused = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(paused.status).toBe("PAUSED");
    expect(paused.nextPageToken).toBe(before.nextPageToken);

    expect((await resumeImportJob(admin, jobId)).status).toBe("DISCOVERING");
    await discover(jobId);
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } })).discoveredCount).toBe(120);
  });

  it("isn't undone by a step that set off before the pause", async () => {
    const { jobId } = await startChannelImport(admin, { input: "@test" });
    await pauseImportJob(admin, jobId);
    fetchMock.mockClear();

    expect((await runDiscoveryStep(admin, jobId)).status).toBe("PAUSED");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("PAUSED");
  });

  it("isn't undone by a step already waiting for YouTube", async () => {
    const { jobId } = await startChannelImport(admin, { input: "@test" });
    const realFetch = globalThis.fetch;
    let hasPaused = false;
    vi.stubGlobal("fetch", (async (...args: Parameters<typeof fetch>) => {
      if (!hasPaused) {
        hasPaused = true;
        await pauseImportJob(admin, jobId);
      }
      return realFetch(...args);
    }) as typeof fetch);
    expect((await runDiscoveryStep(admin, jobId)).status).toBe("PAUSED");
    vi.stubGlobal("fetch", realFetch);
  });

  it("revives a cancelled job, keeping what it fetched and fetching nothing twice", async () => {
    const { jobId } = await startChannelImport(admin, { input: "@test" });
    await runDiscoveryStep(admin, jobId);
    await cancelImportJob(admin, jobId);
    // A job cancelled before this was possible lost its page, so it walks the list again.
    await prisma.importJob.update({ where: { id: jobId }, data: { nextPageToken: null } });

    expect((await resumeImportJob(admin, jobId)).status).toBe("DISCOVERING");
    const resumed = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(resumed.cancelRequestedAt).toBeNull();
    expect(resumed.completedAt).toBeNull();

    await discover(jobId);
    const done = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(done.status).toBe("READY_FOR_REVIEW");
    expect(done.discoveredCount).toBe(120);
    expect(await prisma.importCandidate.count({ where: { jobId } })).toBe(120);
  });

  it("sends an importing job back to review, with what's left still selected", async () => {
    const jobId = await prepared({ videoIds: ids(3) });
    await setCandidatesSelected(admin, { jobId, filter: {}, isSelected: true });
    await prisma.importJob.update({ where: { id: jobId }, data: { status: "IMPORTING" } });

    await pauseImportJob(admin, jobId);
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("READY_FOR_REVIEW");
    expect(await prisma.importCandidate.count({ where: { jobId, isSelected: true, result: "PENDING" } })).toBe(3);
  });

  it("refuses what doesn't make sense, enforces permissions, and audits", async () => {
    const jobId = await prepared({ videoIds: ids(1) });
    expect(await codeOf(pauseImportJob(admin, jobId))).toBe("CONFLICT");
    expect(await codeOf(resumeImportJob(admin, jobId))).toBe("CONFLICT");

    const contributor = await createActor(prisma, "CONTRIBUTOR");
    await prisma.importJob.update({ where: { id: jobId }, data: { status: "DISCOVERING" } });
    expect(await codeOf(pauseImportJob(contributor, jobId))).toBe("FORBIDDEN");
    expect(await codeOf(pauseImportJob(null, jobId))).toBe("UNAUTHENTICATED");
    await pauseImportJob(admin, jobId);
    expect(await codeOf(resumeImportJob(contributor, jobId))).toBe("FORBIDDEN");
    await resumeImportJob(admin, jobId);

    const actions = (await prisma.auditLog.findMany({ where: { entityId: jobId, action: { in: ["import.pause", "import.resume"] } } })).map((log) => log.action);
    expect(actions.sort()).toEqual(["import.pause", "import.resume"]);
  });
});

describe("stopping and deleting", () => {
  beforeEach(() => {
    mockChannel({ videoIds: ids(5) });
  });

  it("stops a job at once, even with no page working on it", async () => {
    const { jobId } = await startChannelImport(admin, { input: "@test" });
    await cancelImportJob(admin, jobId);
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("CANCELLED");
  });

  it("doesn't let a step that was already under way bring a stopped job back", async () => {
    const { jobId } = await startChannelImport(admin, { input: "@test" });
    // Stops the job while the step is waiting for YouTube.
    const realFetch = globalThis.fetch;
    let hasCancelled = false;
    const wrapped: typeof fetch = async (...args) => {
      if (!hasCancelled) {
        hasCancelled = true;
        await cancelImportJob(admin, jobId);
      }
      return realFetch(...args);
    };
    vi.stubGlobal("fetch", wrapped);
    const progress = await runDiscoveryStep(admin, jobId);
    vi.stubGlobal("fetch", realFetch);

    expect(progress.status).toBe("CANCELLED");
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("CANCELLED");
  });

  it("deletes a job and its preview list, keeps what it imported, and records it", async () => {
    const { jobId } = await startChannelImport(admin, { input: "@test" });
    await prisma.importCandidate.create({ data: { jobId, youtubeVideoId: "aaaaaaaaaaa", title: "t", classification: "SHORT_CANDIDATE", expiresAt: new Date(Date.now() + 86_400_000) } });
    const video = await prisma.video.create({ data: { youtubeVideoId: "bbbbbbbbbbb", kind: "SHORT", classification: "SHORT_CANDIDATE", title: "t", feedKey: 1 } });

    await deleteImportJob(admin, jobId);

    expect(await prisma.importJob.count({ where: { id: jobId } })).toBe(0);
    expect(await prisma.importCandidate.count({ where: { jobId } })).toBe(0);
    expect(await prisma.video.count({ where: { id: video.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "import.delete", entityId: jobId } })).toBe(1);
    expect(await codeOf(deleteImportJob(admin, jobId))).toBe("NOT_FOUND");
    expect(await codeOf(runDiscoveryStep(admin, jobId))).toBe("NOT_FOUND");
  });

  it("can delete a job in any state, and enforces permissions on the server", async () => {
    const { jobId } = await startChannelImport(admin, { input: "@test" });
    const contributor = await createActor(prisma, "CONTRIBUTOR");
    expect(await codeOf(deleteImportJob(contributor, jobId))).toBe("FORBIDDEN");
    expect(await codeOf(deleteImportJob(null, jobId))).toBe("UNAUTHENTICATED");
    expect(await codeOf(cancelImportJob(contributor, jobId))).toBe("FORBIDDEN");

    await cancelImportJob(admin, jobId);
    await deleteImportJob(admin, jobId);
    expect(await prisma.importJob.count({ where: { id: jobId } })).toBe(0);
  });
});

describe("one job per channel", () => {
  beforeEach(() => {
    mockChannel({ videoIds: ids(5) });
  });

  it("continues an unfinished job rather than starting a second one for the same channel", async () => {
    const first = await startChannelImport(admin, { input: "@test" });
    const second = await startChannelImport(admin, { input: "@test" });
    expect(second.jobId).toBe(first.jobId);
    expect(await prisma.importJob.count()).toBe(1);

    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: first.jobId } });
    expect((await startChannelSync(admin, job.channelId)).jobId).toBe(first.jobId);
    expect(await prisma.importJob.count()).toBe(1);
  });

  it("allows a new job once the last one has finished", async () => {
    const first = await startChannelImport(admin, { input: "@test" });
    await prisma.importJob.update({ where: { id: first.jobId }, data: { status: "COMPLETED" } });
    const second = await startChannelImport(admin, { input: "@test" });
    expect(second.jobId).not.toBe(first.jobId);
  });
});

describe("the channel list and the 30-day limit", () => {
  it("lists channels with their video counts, and can switch one off", async () => {
    const jobId = await prepared({ videoIds: ids(2) });
    await setCandidatesSelected(admin, { jobId, isSelected: true, filter: {} });
    await importAll(jobId);

    const page = await listChannels(admin, {});
    expect(page.items[0]).toMatchObject({ title: "قناة تجريبية", isActive: true, _count: { videos: 2 } });
    expect((await listChannels(admin, { query: "لا يوجد" })).items).toEqual([]);

    await setChannelActive(admin, page.items[0]!.id, false);
    expect((await listChannels(admin, {})).items[0]!.isActive).toBe(false);
    expect(await codeOf(setChannelActive(await createActor(prisma, "EDITOR"), page.items[0]!.id, true))).toBe("FORBIDDEN");
  });

  it("refreshes channels that are due, and notices one that's gone", async () => {
    mockChannel({ videoIds: [] });
    await startChannelImport(admin, { input: "@test" });
    const channel = await prisma.youTubeChannel.findFirstOrThrow();
    await prisma.youTubeChannel.update({ where: { id: channel.id }, data: { title: "قديم", metadataFetchedAt: new Date(Date.now() - 26 * DAY) } });

    mockChannel({ videoIds: [] });
    expect((await runMetadataRefresh()).channelsUpdated).toBe(1);
    expect((await prisma.youTubeChannel.findUniqueOrThrow({ where: { id: channel.id } })).title).toBe("قناة تجريبية");

    await prisma.youTubeChannel.update({ where: { id: channel.id }, data: { metadataFetchedAt: new Date(Date.now() - 26 * DAY) } });
    fetchMock.mockImplementation(async () => json({ items: [] }));
    expect((await runMetadataRefresh()).channelsRemoved).toBe(1);
    expect(await prisma.youTubeChannel.findUniqueOrThrow({ where: { id: channel.id } })).toMatchObject({ title: "", isActive: false, uploadsPlaylistId: null });
  });

  it("withdraws channel data past 30 days, even with YouTube unreachable", async () => {
    mockChannel({ videoIds: [] });
    await startChannelImport(admin, { input: "@test" });
    await prisma.youTubeChannel.updateMany({ data: { metadataFetchedAt: new Date(Date.now() - 31 * DAY) } });

    fetchMock.mockImplementation(async () => apiError(403, "quotaExceeded"));
    expect((await runMetadataRefresh()).channelsWithdrawn).toBe(1);
    expect(await prisma.youTubeChannel.findFirstOrThrow()).toMatchObject({ title: "", description: null, handle: null, uploadsPlaylistId: null });
  });
});
