import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listSitemapEntries } from "@/features/seo/sitemap.service";
import { deleteOwnAccount, getOwnAccount } from "@/features/users/account.service";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { ensureMongoIndexes } from "@/lib/prisma/ensure-indexes";
import { clearDatabase, createTestClient } from "./helpers";
import { createActor } from "./phase3-helpers";

process.env.APP_URL = "http://localhost:3000";

let prisma: PrismaClient;
let counter = 0;
const next = () => (counter += 1);

async function codeOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
}

const live = () => ({ status: "PUBLISHED" as const, publishedAt: new Date() });
const seedArticle = (overrides: Record<string, unknown> = {}) => prisma.article.create({ data: { title: "مقال", slug: `مقال-${next()}`, body: { type: "doc", content: [] }, ...live(), ...overrides } });
const seedVideo = (overrides: Record<string, unknown> = {}) => {
  const id = next();
  return prisma.video.create({
    data: { youtubeVideoId: `h${String(id).padStart(10, "0")}`, kind: "SHORT", classification: "SHORT_CANDIDATE", ...live(), availability: "AVAILABLE", title: "مقطع", feedKey: id, ...overrides },
  });
};

beforeAll(async () => {
  prisma = createTestClient();
  await ensureMongoIndexes(prisma);
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clearDatabase(prisma);
});

describe("deleting your own account", () => {
  async function seedPersonalData(actor: Actor) {
    const category = await prisma.category.create({ data: { title: "الفقه", slug: `category-${next()}` } });
    const video = await seedVideo();
    await prisma.account.create({ data: { userId: actor.id, type: "oauth", provider: "google", providerAccountId: `g${next()}` } });
    await prisma.session.create({ data: { userId: actor.id, sessionToken: `token-${next()}`, expires: new Date(Date.now() + 86_400_000) } });
    await prisma.userPreference.create({ data: { userId: actor.id } });
    await prisma.userInterest.create({ data: { userId: actor.id, categoryId: category.id, isSelected: true } });
    await prisma.favorite.create({ data: { userId: actor.id, entityType: "VIDEO", entityId: video.id } });
    await prisma.userActivity.create({ data: { userId: actor.id, entityType: "VIDEO", entityId: video.id, action: "VIEW" } });
    await prisma.viewingProgress.create({ data: { userId: actor.id, videoId: video.id, scopeKey: "video", positionSeconds: 5 } });
    return video;
  }

  it("removes everything personal, and nothing belonging to anyone else", async () => {
    const reader = await createActor(prisma, "USER");
    const other = await createActor(prisma, "USER");
    const video = await seedPersonalData(reader);
    await prisma.favorite.create({ data: { userId: other.id, entityType: "VIDEO", entityId: video.id } });

    await deleteOwnAccount(reader);

    const where = { where: { userId: reader.id } };
    expect(await prisma.user.count({ where: { id: reader.id } })).toBe(0);
    for (const remaining of await Promise.all([
      prisma.account.count(where),
      prisma.session.count(where),
      prisma.userPreference.count(where),
      prisma.userInterest.count(where),
      prisma.favorite.count(where),
      prisma.userActivity.count(where),
      prisma.viewingProgress.count(where),
    ])) {
      expect(remaining).toBe(0);
    }
    expect(await prisma.favorite.count({ where: { userId: other.id } })).toBe(1);
    expect(await prisma.video.count({ where: { id: video.id } })).toBe(1);
  });

  it("keeps a staff member's published work and past audit records, without leaving references to them", async () => {
    const contributor = await createActor(prisma, "CONTRIBUTOR");
    const colleague = await createActor(prisma, "CONTRIBUTOR");
    const article = await seedArticle({ authorId: contributor.id, assigneeIds: [contributor.id, colleague.id] });
    const video = await seedVideo({ createdById: contributor.id });
    await prisma.reviewNote.create({ data: { entityType: "ARTICLE", entityId: article.id, authorId: contributor.id, body: "ملاحظة" } });
    await prisma.auditLog.create({ data: { actorId: contributor.id, actorEmail: contributor.email, action: "article.create", entityType: "Article", entityId: article.id } });

    await deleteOwnAccount(contributor);

    const kept = await prisma.article.findUnique({ where: { id: article.id } });
    expect(kept?.authorId).toBeNull();
    expect(kept?.assigneeIds).toEqual([colleague.id]);
    expect((await prisma.video.findUnique({ where: { id: video.id } }))?.createdById).toBeNull();
    expect((await prisma.reviewNote.findFirst({ where: { entityId: article.id } }))?.authorId).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "article.create", actorEmail: contributor.email } })).toBe(1);
  });

  it("records that it happened, without the address of someone who asked to be removed", async () => {
    const reader = await createActor(prisma, "USER");
    await deleteOwnAccount(reader);

    const log = await prisma.auditLog.findFirst({ where: { action: "account.delete_self", entityId: reader.id } });
    expect(log).not.toBeNull();
    expect(log?.actorEmail).toBeNull();
    expect(JSON.stringify(log)).not.toContain(reader.email);
  });

  it("refuses the super admin, guests, and a stale session", async () => {
    const superAdmin = await createActor(prisma, "SUPER_ADMIN");
    expect(await codeOf(deleteOwnAccount(superAdmin))).toBe("FORBIDDEN");
    expect(await prisma.user.count({ where: { id: superAdmin.id } })).toBe(1);
    expect((await getOwnAccount(superAdmin)).canDelete).toBe(false);

    expect(await codeOf(deleteOwnAccount(null))).toBe("UNAUTHENTICATED");

    const reader = await createActor(prisma, "USER");
    await deleteOwnAccount(reader);
    expect(await codeOf(deleteOwnAccount(reader))).toBe("NOT_FOUND");
  });

  it("uses the role in the database, not the one a session claims", async () => {
    const superAdmin = await createActor(prisma, "SUPER_ADMIN");
    expect(await codeOf(deleteOwnAccount({ ...superAdmin, role: "USER" }))).toBe("FORBIDDEN");
  });
});

describe("sitemap", () => {
  it("lists public content only, with encoded Arabic addresses", async () => {
    const article = await seedArticle({ slug: "فضل-الصلاة" });
    await seedArticle({ slug: "مسودة", status: "DRAFT" });
    await seedArticle({ slug: "مؤرشف", isArchived: true });

    const entries = await listSitemapEntries("articles");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ path: `/articles/${encodeURIComponent("فضل-الصلاة")}`, lastModified: article.updatedAt });
  });

  it("sends each video to its own kind of page, leaving out withdrawn ones", async () => {
    const short = await seedVideo();
    const long = await seedVideo({ kind: "LONG_FORM", classification: "LONG_FORM_CANDIDATE" });
    await seedVideo({ availability: "UNKNOWN" });
    await seedVideo({ status: "DRAFT" });

    expect((await listSitemapEntries("videos")).map((entry) => entry.path).sort()).toEqual([`/shorts/${short.id}`, `/videos/${long.id}`].sort());
  });

  it("leaves out playlists whose YouTube data was withdrawn", async () => {
    await prisma.playlist.create({ data: { type: "YOUTUBE", title: "", slug: "withdrawn", sourceKey: "yt:x", ...live() } });
    expect(await listSitemapEntries("playlists")).toEqual([]);
  });

  it("lists static public pages, and no private ones", async () => {
    const paths = (await listSitemapEntries("pages")).map((entry) => entry.path);
    expect(paths).toEqual(expect.arrayContaining(["/", "/explore", "/privacy", "/terms"]));
    for (const privatePath of ["/admin", "/saved", "/history", "/account", "/search"]) expect(paths).not.toContain(privatePath);
  });
});

describe("query plans", () => {
  interface Stage {
    stage?: string;
    inputStage?: Stage;
    inputStages?: Stage[];
    queryPlan?: Stage;
  }
  const stagesOf = (node: Stage | undefined): string[] => (node ? [node.stage ?? "", ...stagesOf(node.inputStage), ...(node.inputStages ?? []).flatMap(stagesOf), ...stagesOf(node.queryPlan)] : []);

  async function winningStages(command: Record<string, unknown>): Promise<string[]> {
    const result = (await prisma.$runCommandRaw({ explain: command as never, verbosity: "queryPlanner" })) as { queryPlanner?: { winningPlan?: Stage }; stages?: { $cursor?: { queryPlanner?: { winningPlan?: Stage } } }[] };
    return stagesOf(result.queryPlanner?.winningPlan ?? result.stages?.[0]?.$cursor?.queryPlanner?.winningPlan);
  }

  beforeEach(async () => {
    const category = await prisma.category.create({ data: { title: "الفقه", slug: `category-${next()}` } });
    for (let index = 0; index < 20; index += 1) await seedVideo({ categoryId: category.id, searchText: "صلاه", titleSearch: "صلاه" });
  }, 60_000);

  it.each([
    ["the feed", { find: "Video", filter: { status: "PUBLISHED", isArchived: false, availability: "AVAILABLE", kind: "SHORT" }, sort: { feedKey: 1, _id: 1 }, limit: 10 }],
    ["search", { find: "Video", filter: { $text: { $search: "صلاه" }, status: "PUBLISHED" }, limit: 10 }],
    ["suggestions", { find: "Video", filter: { titleSearch: { $regex: "^صل" } }, limit: 3 }],
    ["saved items", { find: "Favorite", filter: { userId: { $oid: "507f1f77bcf86cd799439011" } }, sort: { createdAt: -1, _id: -1 }, limit: 20 }],
    ["history", { find: "UserActivity", filter: { userId: { $oid: "507f1f77bcf86cd799439011" }, action: "VIEW" }, sort: { occurredAt: -1, _id: -1 }, limit: 20 }],
    ["popular", { find: "UserActivity", filter: { action: "VIEW", occurredAt: { $gte: { $date: "2026-01-01T00:00:00.000Z" } } } }],
    ["the refresh queue", { find: "Video", filter: { metadataFetchedAt: { $lt: { $date: "2026-01-01T00:00:00.000Z" } } }, sort: { metadataFetchedAt: 1 }, limit: 50 }],
  ])("%s uses an index rather than scanning the collection", async (_name, command) => {
    const stages = await winningStages(command);
    expect(stages.length).toBeGreaterThan(0);
    expect(stages).not.toContain("COLLSCAN");
  });
});
