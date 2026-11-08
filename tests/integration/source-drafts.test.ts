import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addSourceDraftNow, createSourceDraft, deleteSourceDraft, listSourceDrafts, setDraftAutoAdd } from "@/features/youtube/sources/drafts.service";
import { runScheduledSourceCheck } from "@/features/youtube/sources/sources.service";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { markQuotaExhausted } from "@/lib/youtube/quota";
import { clearDatabase, createTestClient } from "./helpers";
import { createActor } from "./phase3-helpers";

process.env.APP_URL = "http://localhost:3000";
process.env.YOUTUBE_API_ENABLED = "true";
process.env.YOUTUBE_API_KEY = "test-api-key-value";

const CHANNEL_ID = "UCabcdefghijklmnopqrstuv";
const UPLOADS = "UUabcdefghijklmnopqrstuv";

let prisma: PrismaClient;
let admin: Actor;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchMock = vi.fn<typeof fetch>();

async function codeOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : `UNEXPECTED: ${String(error)}`;
  }
}

/** A channel with no uploads or playlists: adding it costs one request. */
function mockEmptyChannel() {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/channels")) {
      return json({ items: [{ id: CHANNEL_ID, snippet: { title: "قناة نافعة" }, contentDetails: { relatedPlaylists: { uploads: UPLOADS } }, statistics: { videoCount: "0" } }] });
    }
    if (url.pathname.endsWith("/playlistItems") || url.pathname.endsWith("/playlists")) return json({ items: [] });
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
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
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the source queue", () => {
  it("saves a link without spending any quota, with its kind, name, and note", async () => {
    const draft = await createSourceDraft(admin, { input: "https://www.youtube.com/@Useful", label: "دروس", note: "شروح موثوقة", autoAdd: true });
    expect(draft.kind).toBe("CHANNEL");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.sourceDraft.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ status: "WAITING", label: "دروس", note: "شروح موثوقة", autoAdd: true, createdById: admin.id });
    expect(await prisma.auditLog.count({ where: { action: "source_draft.create" } })).toBe(1);
  });

  it("refuses a link queued twice under another spelling, one already on the site, and one that isn't YouTube", async () => {
    await createSourceDraft(admin, { input: "@Useful", autoAdd: true });
    expect(await codeOf(createSourceDraft(admin, { input: "https://youtube.com/@useful", autoAdd: true }))).toBe("CONFLICT");

    await prisma.playlist.create({ data: { type: "YOUTUBE", youtubePlaylistId: "PLaaaaaaaaaaaaaaaaaaaaaa", sourceKey: "yt:PLaaaaaaaaaaaaaaaaaaaaaa", slug: "p", title: "قائمة" } });
    expect(await codeOf(createSourceDraft(admin, { input: "https://www.youtube.com/playlist?list=PLaaaaaaaaaaaaaaaaaaaaaa", autoAdd: true }))).toBe("CONFLICT");
    expect(await codeOf(createSourceDraft(admin, { input: "https://example.com/@x", autoAdd: true }))).toBe("VALIDATION");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("needs the same permissions as adding a source", async () => {
    expect(await codeOf(createSourceDraft(await createActor(prisma, "EDITOR"), { input: "@Useful", autoAdd: true }))).toBe("FORBIDDEN");
    expect(await codeOf(createSourceDraft(null, { input: "@Useful", autoAdd: true }))).toBe("UNAUTHENTICATED");
    const draft = await createSourceDraft(admin, { input: "@Useful", autoAdd: true });
    expect(await codeOf(addSourceDraftNow(await createActor(prisma, "EDITOR"), draft.id))).toBe("FORBIDDEN");
  });

  it("adds one now, exactly as the Sources box would, and links to it", async () => {
    mockEmptyChannel();
    const draft = await createSourceDraft(admin, { input: "@Useful", autoAdd: false });
    const outcome = await addSourceDraftNow(admin, draft.id);
    expect(outcome.status).toBe("ADDED");
    const channel = await prisma.youTubeChannel.findFirstOrThrow();
    expect(channel.isFollowed).toBe(true);
    expect(await prisma.sourceDraft.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ status: "ADDED", resultHref: `/admin/sources/channels/${channel.id}`, attempts: 1 });
    // Done is done: it can't be added a second time.
    expect((await addSourceDraftNow(admin, draft.id)).status).toBe("BUSY");
  });

  it("goes back to waiting when the quota has run out, and spends nothing trying", async () => {
    mockEmptyChannel();
    await markQuotaExhausted();
    const draft = await createSourceDraft(admin, { input: "@Useful", autoAdd: true });
    const outcome = await addSourceDraftNow(admin, draft.id);
    expect(outcome.status).toBe("WAITING");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.sourceDraft.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ status: "WAITING", attempts: 1 });
  });

  it("is added by the hourly job once there's quota, as the person who queued it", async () => {
    mockEmptyChannel();
    const later = await createSourceDraft(admin, { input: "@Later", autoAdd: false });
    const auto = await createSourceDraft(admin, { input: "@Useful", autoAdd: true });

    await markQuotaExhausted();
    expect((await runScheduledSourceCheck()).draftsAdded).toBe(0);

    await prisma.apiQuotaUsage.deleteMany();
    expect((await runScheduledSourceCheck()).draftsAdded).toBe(1);
    expect((await prisma.sourceDraft.findUniqueOrThrow({ where: { id: auto.id } })).status).toBe("ADDED");
    expect((await prisma.sourceDraft.findUniqueOrThrow({ where: { id: later.id } })).status).toBe("WAITING");
    expect(await prisma.auditLog.count({ where: { action: "source.follow_channel", actorId: admin.id } })).toBe(1);
  });

  it("stops at once for someone who has lost the right to add sources", async () => {
    mockEmptyChannel();
    const editor = await createActor(prisma, "ADMIN");
    const draft = await createSourceDraft(editor, { input: "@Useful", autoAdd: true });
    await prisma.user.update({ where: { id: editor.id }, data: { role: "EDITOR" } });
    await runScheduledSourceCheck();
    expect(await prisma.sourceDraft.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ status: "FAILED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists drafts by state with counts and who added them, toggles auto, and deletes with an audit record", async () => {
    const one = await createSourceDraft(admin, { input: "@One", autoAdd: true });
    await createSourceDraft(admin, { input: "@Two", autoAdd: true });
    await prisma.sourceDraft.update({ where: { id: one.id }, data: { status: "FAILED" } });

    const all = await listSourceDrafts(admin, {});
    expect(all.counts).toEqual({ all: 2, waiting: 1, added: 0, failed: 1 });
    expect(all.items[0]!.createdByName).toBeTruthy();
    expect((await listSourceDrafts(admin, { status: "FAILED" })).items.map((item) => item.id)).toEqual([one.id]);

    await setDraftAutoAdd(admin, one.id, false);
    expect((await prisma.sourceDraft.findUniqueOrThrow({ where: { id: one.id } })).autoAdd).toBe(false);
    await deleteSourceDraft(admin, one.id);
    expect(await prisma.sourceDraft.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "source_draft.delete", entityId: one.id } })).toBe(1);
  });
});
