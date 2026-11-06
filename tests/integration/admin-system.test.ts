import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDashboardOverview, getIntegrationStatus, getSettingsForEditing, listAuditLogs, listUsers, updateYouTubeSettings } from "@/features/admin/system.service";
import { createCategory, listAllCategories, listActiveCategories, setCategoryActive, updateCategory } from "@/features/categories/categories.service";
import { addLink, listLinks, removeLink } from "@/features/relationships/links.service";
import { updateScoringConfig } from "@/features/recommendations/settings.service";
import { DEFAULT_SCORING_CONFIG } from "@/features/recommendations/scoring";
import { listArticlesForAdmin, listMatchingArticleIds } from "@/features/articles/articles.service";
import { bulkAssignArticles, bulkAssignVideos, bulkPublishVideos, getVideoForEditing, listMatchingVideoIds, listVideosForAdmin, setVideoArchived } from "@/features/shorts/videos-admin.service";
import { assignVideo } from "@/features/shorts/videos.service";
import { changeUserRole, setUserDeactivated, setUserPermissionGrants } from "@/features/users/user-admin.service";
import { getYouTubeSettings } from "@/features/youtube/settings.service";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { clearDatabase, createTestClient } from "./helpers";
import { createActor } from "./phase3-helpers";

process.env.APP_URL = "http://localhost:3000";

let prisma: PrismaClient;
let admin: Actor;
let superAdmin: Actor;
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
    data: { youtubeVideoId: `ad${String(counter).padStart(9, "0")}`, kind: "SHORT", classification: "SHORT_CANDIDATE", title: `مقطع ${counter}`, titleSearch: `مقطع ${counter}`, feedKey: counter, availability: "AVAILABLE", ...overrides },
  });
}
const topic = () => prisma.topic.create({ data: { title: `موضوع ${++counter}`, slug: `t-${counter}`, status: "PUBLISHED" } });
const category = () => prisma.category.create({ data: { title: `مجال ${++counter}`, slug: `c-${counter}` } });
const article = () => prisma.article.create({ data: { title: `مقال ${++counter}`, slug: `a-${counter}`, body: {} } });

beforeAll(() => {
  prisma = createTestClient();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await clearDatabase(prisma);
  admin = await createActor(prisma, "ADMIN");
  superAdmin = await createActor(prisma, "SUPER_ADMIN");
  editor = await createActor(prisma, "EDITOR");
});

describe("the overview", () => {
  it("shows real counts", async () => {
    await video({ status: "PUBLISHED" });
    await video();
    await video({ kind: "LONG_FORM", status: "PUBLISHED" });
    await video({ isArchived: true });
    await prisma.article.create({ data: { title: "أ", slug: "x1", body: {}, status: "PUBLISHED" } });
    await article();
    await topic();
    await prisma.library.create({ data: { name: "م", slug: "l1" } });
    await prisma.playlist.create({ data: { type: "CURATED", title: "س", slug: "p1", sourceKey: "cur:1" } });
    await prisma.youTubeChannel.create({ data: { youtubeChannelId: "UC1", title: "ق" } });

    const overview = await getDashboardOverview(admin);
    expect(overview.shorts).toEqual({ total: 2, published: 1, draft: 1 });
    expect(overview.articles).toEqual({ total: 2, published: 1, draft: 1 });
    expect([overview.topics, overview.libraries, overview.playlists, overview.channels]).toEqual([1, 1, 1, 1]);
  });

  it("shows recent activity only to those who may read the audit log", async () => {
    await createCategory(admin, { title: "مجال النشاط" });
    expect((await getDashboardOverview(admin)).recentActivity?.[0]?.action).toBe("category.create");
    expect((await getDashboardOverview(editor)).recentActivity).toBeNull();
    expect(await codeOf(getDashboardOverview(await createActor(prisma, "USER")))).toBe("FORBIDDEN");
  });
});

describe("managing videos", () => {
  it("lists and filters, for those who may view everything", async () => {
    const cat = await category();
    const reviewed = await video({ reviewedAt: new Date(), categoryId: cat.id });
    const waiting = await video();
    const long = await video({ kind: "LONG_FORM", reviewedAt: new Date(), status: "PUBLISHED" });
    const archived = await video({ isArchived: true });

    const list = async (input: Record<string, unknown>) => (await listVideosForAdmin(editor, input)).items.map((row) => row.id).sort();
    expect(await list({})).toEqual([reviewed.id, waiting.id, long.id].sort());
    expect(await list({ kind: "LONG_FORM" })).toEqual([long.id]);
    expect(await list({ review: "NEEDS_REVIEW" })).toEqual([waiting.id]);
    expect(await list({ review: "REVIEWED" })).toEqual([reviewed.id, long.id].sort());
    expect(await list({ categoryId: cat.id })).toEqual([reviewed.id]);
    expect(await list({ status: "PUBLISHED" })).toEqual([long.id]);
    expect(await list({ status: "ARCHIVED" })).toEqual([archived.id]);
    expect(await codeOf(listVideosForAdmin(await createActor(prisma, "CONTRIBUTOR"), {}))).toBe("FORBIDDEN");
  });

  it("includes the review state of videos whose date was never written at all", async () => {
    // Created with the field missing rather than null, which filters treat differently.
    const missing = await prisma.video.create({ data: { youtubeVideoId: "admissing00", kind: "SHORT", classification: "SHORT_CANDIDATE", title: "س", feedKey: 1 } });
    expect((await listVideosForAdmin(editor, { review: "NEEDS_REVIEW" })).items.map((row) => row.id)).toContain(missing.id);
  });

  it("assigns a kind, category, and topics in bulk, keeping existing topics, and audits it", async () => {
    const [a, b] = [await video(), await video()];
    const cat = await category();
    const [first, second] = [await topic(), await topic()];
    await addLink(editor, { kind: "video.topic", ownerId: a.id, targetId: first.id });

    const { changed } = await bulkAssignVideos(editor, { ids: [a.id, b.id], kind: "SHORT", categoryId: cat.id, addTopicIds: [first.id, second.id] });
    expect(changed).toBe(2);

    const stored = await prisma.video.findUniqueOrThrow({ where: { id: a.id } });
    expect(stored.categoryId).toBe(cat.id);
    expect(stored.reviewedAt).not.toBeNull();
    expect([...stored.topicIds].sort()).toEqual([first.id, second.id].sort());
    expect(await prisma.videoTopic.count({ where: { videoId: a.id } })).toBe(2);
    expect(await prisma.videoTopic.count({ where: { videoId: b.id } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "video.bulk_assign" } })).toBe(1);
  });

  it("doesn't mark videos reviewed when only assigning a category", async () => {
    const clip = await video();
    await bulkAssignVideos(editor, { ids: [clip.id], categoryId: (await category()).id });
    expect((await prisma.video.findUniqueOrThrow({ where: { id: clip.id } })).reviewedAt).toBeNull();
  });

  it("rejects an empty bulk action, too many items, and things that don't exist, changing nothing", async () => {
    const clip = await video();
    const missing = "507f1f77bcf86cd799439011";
    expect(await codeOf(bulkAssignVideos(editor, { ids: [clip.id] }))).toBe("VALIDATION");
    expect(await codeOf(bulkAssignVideos(editor, { ids: [], categoryId: (await category()).id }))).toBe("VALIDATION");
    expect(await codeOf(bulkAssignVideos(editor, { ids: Array(101).fill(clip.id), kind: "SHORT" }))).toBe("VALIDATION");
    expect(await codeOf(bulkAssignVideos(editor, { ids: [clip.id], categoryId: missing }))).toBe("VALIDATION");
    expect(await codeOf(bulkAssignVideos(editor, { ids: [clip.id, missing], kind: "LONG_FORM" }))).toBe("VALIDATION");
    expect((await prisma.video.findUniqueOrThrow({ where: { id: clip.id } })).kind).toBe("SHORT");
  });

  it("publishes in bulk whatever can play, with or without a category or earlier review", async () => {
    const cat = await category();
    const ready = await video({ reviewedAt: new Date(), categoryId: cat.id });
    const notReviewed = await video({ categoryId: cat.id });
    const noCategory = await video({ reviewedAt: new Date() });
    const unavailable = await video({ reviewedAt: new Date(), categoryId: cat.id, availability: "UNAVAILABLE" });

    const report = await bulkPublishVideos(admin, { ids: [ready.id, notReviewed.id, noCategory.id, unavailable.id], isPublished: true });
    expect(report).toEqual({ changed: 3, skipped: 1 });
    for (const row of [ready, notReviewed, noCategory]) expect((await prisma.video.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PUBLISHED");
    expect((await prisma.video.findUniqueOrThrow({ where: { id: unavailable.id } })).status).toBe("DRAFT");
    expect(await codeOf(bulkPublishVideos(editor, { ids: [ready.id], isPublished: false }))).toBe("FORBIDDEN");
  });

  it("requires permission for bulk edits on the server", async () => {
    const clip = await video();
    const art = await article();
    const contributor = await createActor(prisma, "CONTRIBUTOR");
    const cat = await category();
    expect(await codeOf(bulkAssignVideos(contributor, { ids: [clip.id], categoryId: cat.id }))).toBe("FORBIDDEN");
    expect(await codeOf(bulkAssignArticles(contributor, { ids: [art.id], categoryId: cat.id }))).toBe("FORBIDDEN");
    expect(await codeOf(bulkAssignVideos(null, { ids: [clip.id], categoryId: cat.id }))).toBe("UNAUTHENTICATED");
  });

  it("assigns articles in bulk without repeats", async () => {
    const [a, b] = [await article(), await article()];
    const cat = await category();
    const t = await topic();
    await prisma.articleTopic.create({ data: { articleId: a.id, topicId: t.id } });

    await bulkAssignArticles(editor, { ids: [a.id, b.id], categoryId: cat.id, addTopicIds: [t.id] });
    expect((await prisma.article.findUniqueOrThrow({ where: { id: b.id } })).categoryId).toBe(cat.id);
    expect(await prisma.articleTopic.count({ where: { topicId: t.id } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "article.bulk_assign" } })).toBe(1);
  });

  it("archives, keeping links, and needs the permission", async () => {
    const clip = await video();
    expect(await codeOf(setVideoArchived(editor, clip.id, true))).toBe("FORBIDDEN");
    await setVideoArchived(admin, clip.id, true);
    expect((await prisma.video.findUniqueOrThrow({ where: { id: clip.id } })).isArchived).toBe(true);
  });

  it("links from the video's side, keeping the feed copy in step", async () => {
    const clip = await video();
    const t = await topic();
    const lib = await prisma.library.create({ data: { name: "م", slug: `l-${++counter}` } });
    const art = await article();

    await addLink(editor, { kind: "video.topic", ownerId: clip.id, targetId: t.id });
    await addLink(editor, { kind: "video.library", ownerId: clip.id, targetId: lib.id });
    await addLink(editor, { kind: "video.article", ownerId: clip.id, targetId: art.id });
    let stored = await prisma.video.findUniqueOrThrow({ where: { id: clip.id } });
    expect(stored.topicIds).toEqual([t.id]);
    expect(stored.libraryIds).toEqual([lib.id]);
    expect((await listLinks(editor, { kind: "video.article", ownerId: clip.id })).items.map((row) => row.id)).toEqual([art.id]);

    await removeLink(editor, { kind: "video.topic", ownerId: clip.id, targetId: t.id });
    stored = await prisma.video.findUniqueOrThrow({ where: { id: clip.id } });
    expect(stored.topicIds).toEqual([]);
    expect(await codeOf(addLink(await createActor(prisma, "CONTRIBUTOR"), { kind: "video.topic", ownerId: clip.id, targetId: t.id }))).toBe("FORBIDDEN");
  });

  it("shows a CTA's target by name", async () => {
    const art = await article();
    const clip = await video();
    await assignVideo(editor, clip.id, { cta: { type: "INTERNAL_ARTICLE", targetId: art.id, label: "اقرأ" } });
    expect((await getVideoForEditing(editor, clip.id)).ctaTarget).toEqual({ id: art.id, type: "ARTICLE", label: art.title });
  });
});

describe("categories", () => {
  it("are managed only by those allowed, and listed with inactive ones", async () => {
    expect(await codeOf(createCategory(editor, { title: "س" }))).toBe("FORBIDDEN");
    const created = await createCategory(admin, { title: "مجال جديد" });
    await updateCategory(admin, created.id, { displayOrder: 5, description: "وصف" });
    await setCategoryActive(admin, created.id, false);

    expect((await listActiveCategories()).map((row) => row.id)).not.toContain(created.id);
    expect((await listAllCategories(admin)).find((row) => row.id === created.id)).toMatchObject({ isActive: false, displayOrder: 5, description: "وصف" });
    expect(await codeOf(listAllCategories(editor))).toBe("FORBIDDEN");
  });
});

describe("users and roles", () => {
  it("can be viewed by admins, and changed only by the super admin", async () => {
    const person = await createActor(prisma, "USER");
    expect((await listUsers(admin, {})).items.map((row) => row.id)).toContain(person.id);
    expect(await codeOf(listUsers(editor, {}))).toBe("FORBIDDEN");

    expect(await codeOf(changeUserRole(admin, person.id, "EDITOR"))).toBe("FORBIDDEN");
    await changeUserRole(superAdmin, person.id, "EDITOR");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).role).toBe("EDITOR");
  });

  it("can't touch the super admin, or make another one, whoever asks", async () => {
    for (const actor of [admin, superAdmin]) {
      expect(await codeOf(changeUserRole(actor, superAdmin.id, "USER"))).toBe("FORBIDDEN");
      expect(await codeOf(setUserDeactivated(actor, superAdmin.id, true))).toBe("FORBIDDEN");
      expect(await codeOf(setUserPermissionGrants(actor, superAdmin.id, []))).toBe("FORBIDDEN");
    }
    const person = await createActor(prisma, "USER");
    expect(await codeOf(changeUserRole(superAdmin, person.id, "SUPER_ADMIN"))).toBe("VALIDATION");
  });

  it("filters by role and searches, without exposing anything beyond what's needed", async () => {
    const person = await prisma.user.create({ data: { email: "findme@example.com", name: "الاسم المطلوب", role: "CONTRIBUTOR" } });
    const page = await listUsers(admin, { query: "findme" });
    expect(page.items.map((row) => row.id)).toEqual([person.id]);
    expect((await listUsers(admin, { role: "CONTRIBUTOR" })).items.map((row) => row.id)).toEqual([person.id]);
    expect(Object.keys(page.items[0]!).sort()).toEqual(["createdAt", "email", "id", "isDeactivated", "name", "permissionGrants", "role"].sort());
  });

  it("refuses grants outside the allowed set", async () => {
    const person = await createActor(prisma, "EDITOR");
    expect(await codeOf(setUserPermissionGrants(superAdmin, person.id, ["users.manage"]))).toBe("VALIDATION");
    expect(await codeOf(setUserPermissionGrants(superAdmin, person.id, ["settings.manage"]))).toBe("VALIDATION");
    await setUserPermissionGrants(superAdmin, person.id, ["content.publish"]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).permissionGrants).toEqual(["content.publish"]);
  });
});

describe("the audit log", () => {
  it("is readable only with permission, filterable, and newest first", async () => {
    await createCategory(admin, { title: "أول" });
    await createCategory(superAdmin, { title: "ثان" });
    await changeUserRole(superAdmin, (await createActor(prisma, "USER")).id, "EDITOR");

    expect(await codeOf(listAuditLogs(editor, {}))).toBe("FORBIDDEN");
    expect((await listAuditLogs(admin, {})).items[0]!.action).toBe("user.role_change");
    expect((await listAuditLogs(admin, { action: "category." })).items).toHaveLength(2);
    expect((await listAuditLogs(admin, { actor: admin.email })).items.map((row) => row.actorEmail)).toEqual([admin.email]);
  });

  it("offers no way to change or remove records", async () => {
    const audit = await import("@/features/admin/audit");
    expect(Object.keys(audit)).toEqual(["recordAudit"]);
  });

  it("pages without repeats", async () => {
    for (let index = 0; index < 55; index += 1) await prisma.auditLog.create({ data: { action: "test.entry", entityType: "Test" } });
    const first = await listAuditLogs(admin, { action: "test." });
    expect(first.items).toHaveLength(50);
    const second = await listAuditLogs(admin, { action: "test.", cursor: first.nextCursor! });
    expect(second.items).toHaveLength(5);
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(55);
  });
});

describe("settings", () => {
  it("belong to the super admin, and changes are validated and audited", async () => {
    expect(await codeOf(getSettingsForEditing(admin))).toBe("FORBIDDEN");
    expect(await codeOf(updateScoringConfig(admin, DEFAULT_SCORING_CONFIG))).toBe("FORBIDDEN");
    expect(await codeOf(updateYouTubeSettings(admin, { maxShortSeconds: 60, refreshAfterDays: 20, refreshBatchesPerRun: 5 }))).toBe("FORBIDDEN");

    await updateScoringConfig(superAdmin, { ...DEFAULT_SCORING_CONFIG, explorationShare: 0.35 });
    expect((await getSettingsForEditing(superAdmin)).scoring.explorationShare).toBe(0.35);
    expect(await codeOf(updateScoringConfig(superAdmin, { ...DEFAULT_SCORING_CONFIG, explorationShare: 5 }))).toBe("VALIDATION");

    await updateYouTubeSettings(superAdmin, { maxShortSeconds: 60, refreshAfterDays: 20, refreshBatchesPerRun: 5 });
    expect(await getYouTubeSettings()).toMatchObject({ maxShortSeconds: 60, refreshAfterDays: 20, refreshBatchesPerRun: 5 });
    expect(await prisma.auditLog.count({ where: { action: "settings.update" } })).toBe(2);
  });

  it("can't push the refresh past YouTube's 30-day limit", async () => {
    expect(await codeOf(updateYouTubeSettings(superAdmin, { maxShortSeconds: 60, refreshAfterDays: 30, refreshBatchesPerRun: 5 }))).toBe("VALIDATION");
  });

  it("can't change statistics from the settings screen", async () => {
    expect(await codeOf(updateYouTubeSettings(superAdmin, { maxShortSeconds: 60, refreshAfterDays: 20, refreshBatchesPerRun: 5, statisticsEnabled: true }))).toBe("VALIDATION");
    await updateYouTubeSettings(superAdmin, { maxShortSeconds: 60, refreshAfterDays: 20, refreshBatchesPerRun: 5 });
    expect((await getYouTubeSettings()).statisticsEnabled).toBe(true);
  });
});

describe("the integration status", () => {
  it("reports real numbers, and spends no quota", async () => {
    const old = new Date(Date.now() - 31 * 86_400_000);
    await video({ metadataFetchedAt: old });
    await prisma.apiQuotaUsage.create({ data: { day: "2026-01-01", units: 42 } });

    const status = await getIntegrationStatus(admin);
    expect(status.refresh).toMatchObject({ videosDue: 1, videosPastLimit: 1 });
    expect(status.quota.recentDays).toEqual([{ day: "2026-01-01", units: 42, exhausted: false }]);
    expect(status.statisticsEnabled).toBe(true);
    expect(await prisma.apiQuotaUsage.count()).toBe(1);
    expect(await codeOf(getIntegrationStatus(editor))).toBe("FORBIDDEN");
  });
});

describe("publishing in bulk", () => {
  it("publishes a whole batch in one go, keeps earlier dates, and audits once", async () => {
    const reviewedAt = new Date("2026-01-01T00:00:00.000Z");
    const publishedAt = new Date("2026-02-01T00:00:00.000Z");
    const earlier = await video({ reviewedAt, publishedAt });
    const fresh = await video({});
    const report = await bulkPublishVideos(admin, { ids: [earlier.id, fresh.id, earlier.id], isPublished: true });
    expect(report).toEqual({ changed: 2, skipped: 0 });

    const kept = await prisma.video.findUniqueOrThrow({ where: { id: earlier.id } });
    expect(kept.reviewedAt).toEqual(reviewedAt);
    expect(kept.publishedAt).toEqual(publishedAt);
    const stamped = await prisma.video.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(stamped.status).toBe("PUBLISHED");
    expect(stamped.reviewedAt).toBeInstanceOf(Date);
    expect(stamped.publishedAt).toBeInstanceOf(Date);
    expect(await prisma.auditLog.count({ where: { action: "video.bulk_publish" } })).toBe(1);
  });

  it("skips what can't play or is archived, and missing IDs, and reports them", async () => {
    const good = await video({});
    const gone = await video({ availability: "UNAVAILABLE" });
    const archived = await video({ isArchived: true });
    const report = await bulkPublishVideos(admin, { ids: [good.id, gone.id, archived.id, "507f1f77bcf86cd799439011"], isPublished: true });
    expect(report).toEqual({ changed: 1, skipped: 3 });
    expect((await prisma.video.findUniqueOrThrow({ where: { id: gone.id } })).status).toBe("DRAFT");
  });

  it("can repeat a batch safely, and unpublish one", async () => {
    const clip = await video({});
    await bulkPublishVideos(admin, { ids: [clip.id], isPublished: true });
    const first = await prisma.video.findUniqueOrThrow({ where: { id: clip.id } });
    expect(await bulkPublishVideos(admin, { ids: [clip.id], isPublished: true })).toEqual({ changed: 1, skipped: 0 });
    expect((await prisma.video.findUniqueOrThrow({ where: { id: clip.id } })).publishedAt).toEqual(first.publishedAt);

    expect(await bulkPublishVideos(admin, { ids: [clip.id], isPublished: false })).toEqual({ changed: 1, skipped: 0 });
    const undone = await prisma.video.findUniqueOrThrow({ where: { id: clip.id } });
    expect(undone.status).toBe("DRAFT");
    expect(undone.publishedAt).toEqual(first.publishedAt);
  });

  it("publishes the most a batch allows without running out of time", async () => {
    const stamp = Date.now();
    await prisma.video.createMany({ data: Array.from({ length: 100 }, (_, index) => ({ youtubeVideoId: `b${stamp}${index}`.slice(-11).padStart(11, "x"), kind: "SHORT" as const, classification: "SHORT_CANDIDATE" as const, title: "مقطع", availability: "AVAILABLE" as const, feedKey: index })) });
    const ids = (await prisma.video.findMany({ where: { title: "مقطع" }, select: { id: true } })).map((row) => row.id);
    expect(await bulkPublishVideos(admin, { ids, isPublished: true })).toEqual({ changed: 100, skipped: 0 });
  });
});

describe("select all, across every page", () => {
  async function seedVideos(count: number, overrides: Record<string, unknown> = {}) {
    const stamp = Date.now();
    await prisma.video.createMany({
      data: Array.from({ length: count }, (_, index) => ({ youtubeVideoId: `m${stamp}${index}`.slice(-11).padStart(11, "x"), kind: "SHORT" as const, classification: "SHORT_CANDIDATE" as const, title: "مقطع", titleSearch: "مقطع", feedKey: index, ...overrides })),
    });
  }

  it("returns every matching video, past the size of one page, and nothing else", async () => {
    await seedVideos(60);
    await seedVideos(5, { kind: "LONG_FORM", classification: "LONG_FORM_CANDIDATE" });
    const superAdmin = await createActor(prisma, "ADMIN");

    const list = await listVideosForAdmin(superAdmin, { kind: "SHORT" });
    expect(list.items.length).toBe(50);
    expect(list.total).toBe(60);

    const { ids, nextCursor } = await listMatchingVideoIds(superAdmin, { kind: "SHORT" });
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
    expect(nextCursor).toBeNull();
  });

  it("applies the same filters as the list", async () => {
    await seedVideos(3);
    await seedVideos(2, { status: "PUBLISHED" });
    const admin = await createActor(prisma, "ADMIN");
    expect((await listMatchingVideoIds(admin, { status: "PUBLISHED" })).ids).toHaveLength(2);
    expect((await listMatchingVideoIds(admin, { query: "لا يوجد" })).ids).toEqual([]);
    expect((await listMatchingVideoIds(admin, { status: "DRAFT", review: "NEEDS_REVIEW" })).ids).toHaveLength(3);
  });

  it("is limited by permission, and an article list by what the person can see", async () => {
    const contributor = await createActor(prisma, "CONTRIBUTOR");
    const admin = await createActor(prisma, "ADMIN");
    expect(await codeOf(listMatchingVideoIds(contributor, {}))).toBe("FORBIDDEN");
    expect(await codeOf(listMatchingVideoIds(null, {}))).toBe("UNAUTHENTICATED");

    const body = { type: "doc", content: [] };
    const own = await prisma.article.create({ data: { title: "لي", slug: `own-${Date.now()}`, body, authorId: contributor.id } });
    await prisma.article.create({ data: { title: "لغيري", slug: `other-${Date.now()}`, body } });
    expect((await listMatchingArticleIds(contributor, {})).ids).toEqual([own.id]);
    expect((await listMatchingArticleIds(admin, {})).ids).toHaveLength(2);
    expect((await listArticlesForAdmin(contributor, {})).total).toBe(1);
  });
});
