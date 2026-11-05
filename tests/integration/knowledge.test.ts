import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createArticle, setArticlePublished } from "@/features/articles/articles.service";
import {
  createLibrary,
  deleteLibrary,
  getLibrarySections,
  getPublicLibraryParent,
  getPublishedLibraryBySlug,
  listLibrariesForAdmin,
  listPublishedLibraries,
  setLibraryArchived,
  setLibraryPublished,
  updateLibrary,
} from "@/features/libraries/libraries.service";
import { uploadImage } from "@/features/media/uploads.service";
import { addLink, listLinks, removeLink, setLibraryItemFeatured } from "@/features/relationships/links.service";
import { createResource, deleteResource, getPublishedResourceBySlug, setResourcePublished, updateResource } from "@/features/resources/resources.service";
import { createTopic, deleteTopic, getPublishedTopicBySlug, getTopicSections, listPublicTopics, setTopicPublished, updateTopic } from "@/features/topics/topics.service";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { readLocalObject } from "@/lib/storage";
import { clearDatabase, createTestClient } from "./helpers";
import { createActor } from "./phase3-helpers";

process.env.APP_URL = "http://localhost:3000";

let prisma: PrismaClient;
let editor: Actor;
let admin: Actor;
let counter = 0;
let uploadsDirectory: string;

async function codeOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : `UNEXPECTED: ${String(error)}`;
  }
}

async function topic(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return prisma.topic.create({ data: { title: `موضوع ${counter}`, slug: `t-${counter}`, status: "PUBLISHED", ...overrides } });
}
async function library(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return prisma.library.create({ data: { name: `مكتبة ${counter}`, slug: `l-${counter}`, status: "PUBLISHED", ...overrides } });
}
async function video(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return prisma.video.create({
    data: {
      youtubeVideoId: `kn${String(counter).padStart(9, "0")}`,
      kind: "SHORT",
      classification: "SHORT_CANDIDATE",
      title: `فيديو ${counter}`,
      feedKey: counter,
      status: "PUBLISHED",
      availability: "AVAILABLE",
      publishedAt: new Date(2026, 0, counter),
      ...overrides,
    },
  });
}
async function article(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return prisma.article.create({ data: { title: `مقال ${counter}`, slug: `a-${counter}`, body: { type: "doc", content: [] }, status: "PUBLISHED", publishedAt: new Date(2026, 0, counter), ...overrides } });
}
async function resource(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return prisma.externalResource.create({ data: { title: `مصدر ${counter}`, slug: `r-${counter}`, sourceName: "موقع", url: `https://example.org/${counter}`, status: "PUBLISHED", ...overrides } });
}

beforeAll(async () => {
  prisma = createTestClient();
  uploadsDirectory = await mkdtemp(path.join(tmpdir(), "uploads-integration-"));
  process.env.STORAGE_LOCAL_DIR = uploadsDirectory;
});
afterAll(async () => {
  await prisma.$disconnect();
  await rm(uploadsDirectory, { recursive: true, force: true });
});
beforeEach(async () => {
  await clearDatabase(prisma);
  editor = await createActor(prisma, "EDITOR");
  admin = await createActor(prisma, "ADMIN");
});

describe("links", () => {
  it("adds a video to a topic in the join and the feed copy together, and removes it from both", async () => {
    const owner = await topic();
    const clip = await video();

    await addLink(editor, { kind: "topic.video", ownerId: owner.id, targetId: clip.id });
    expect((await prisma.video.findUniqueOrThrow({ where: { id: clip.id } })).topicIds).toEqual([owner.id]);
    expect(await prisma.videoTopic.count({ where: { topicId: owner.id, videoId: clip.id } })).toBe(1);

    await removeLink(editor, { kind: "topic.video", ownerId: owner.id, targetId: clip.id });
    expect((await prisma.video.findUniqueOrThrow({ where: { id: clip.id } })).topicIds).toEqual([]);
    expect(await prisma.videoTopic.count({ where: { topicId: owner.id } })).toBe(0);
  });

  it("does the same for libraries", async () => {
    const owner = await library();
    const clip = await video();

    await addLink(editor, { kind: "library.video", ownerId: owner.id, targetId: clip.id });
    expect((await prisma.video.findUniqueOrThrow({ where: { id: clip.id } })).libraryIds).toEqual([owner.id]);

    await removeLink(editor, { kind: "library.video", ownerId: owner.id, targetId: clip.id });
    expect((await prisma.video.findUniqueOrThrow({ where: { id: clip.id } })).libraryIds).toEqual([]);
  });

  it("removing from one topic leaves the video's other topics alone", async () => {
    const [first, second] = [await topic(), await topic()];
    const clip = await video();
    await addLink(editor, { kind: "topic.video", ownerId: first.id, targetId: clip.id });
    await addLink(editor, { kind: "topic.video", ownerId: second.id, targetId: clip.id });

    await removeLink(editor, { kind: "topic.video", ownerId: first.id, targetId: clip.id });
    expect((await prisma.video.findUniqueOrThrow({ where: { id: clip.id } })).topicIds).toEqual([second.id]);
  });

  it("treats adding twice as done, with no duplicate in the join or the copy", async () => {
    const owner = await topic();
    const clip = await video();
    await addLink(editor, { kind: "topic.video", ownerId: owner.id, targetId: clip.id });
    await addLink(editor, { kind: "topic.video", ownerId: owner.id, targetId: clip.id });

    expect(await prisma.videoTopic.count({ where: { topicId: owner.id } })).toBe(1);
    expect((await prisma.video.findUniqueOrThrow({ where: { id: clip.id } })).topicIds).toEqual([owner.id]);
  });

  it("stores a topic relation once, whichever side adds it, and shows it on both", async () => {
    const [first, second] = [await topic(), await topic()];
    await addLink(editor, { kind: "topic.related", ownerId: first.id, targetId: second.id });
    await addLink(editor, { kind: "topic.related", ownerId: second.id, targetId: first.id });
    expect(await prisma.topicRelation.count()).toBe(1);

    expect((await listLinks(editor, { kind: "topic.related", ownerId: first.id })).items.map((row) => row.id)).toEqual([second.id]);
    expect((await listLinks(editor, { kind: "topic.related", ownerId: second.id })).items.map((row) => row.id)).toEqual([first.id]);

    await removeLink(editor, { kind: "topic.related", ownerId: second.id, targetId: first.id });
    expect(await prisma.topicRelation.count()).toBe(0);
  });

  it("allows related and complementary as separate relationships", async () => {
    const [first, second] = [await topic(), await topic()];
    await addLink(editor, { kind: "topic.related", ownerId: first.id, targetId: second.id });
    await addLink(editor, { kind: "topic.complementary", ownerId: first.id, targetId: second.id });
    expect(await prisma.topicRelation.count()).toBe(2);
  });

  it("rejects linking something to itself, for topics and libraries", async () => {
    const owner = await topic();
    const shelf = await library();
    expect(await codeOf(addLink(editor, { kind: "topic.related", ownerId: owner.id, targetId: owner.id }))).toBe("VALIDATION");
    expect(await codeOf(addLink(editor, { kind: "library.related", ownerId: shelf.id, targetId: shelf.id }))).toBe("VALIDATION");
  });

  it("rejects missing items and bad input", async () => {
    const owner = await topic();
    const missing = "507f1f77bcf86cd799439011";
    expect(await codeOf(addLink(editor, { kind: "topic.video", ownerId: owner.id, targetId: missing }))).toBe("VALIDATION");
    expect(await codeOf(addLink(editor, { kind: "topic.video", ownerId: missing, targetId: (await video()).id }))).toBe("NOT_FOUND");
    expect(await codeOf(addLink(editor, { kind: "made.up", ownerId: owner.id, targetId: missing }))).toBe("VALIDATION");
    expect(await codeOf(addLink(editor, { kind: "topic.video", ownerId: "$ne", targetId: missing }))).toBe("VALIDATION");
  });

  it("enforces permissions on the server for every direction", async () => {
    const owner = await topic();
    const shelf = await library();
    const clip = await video();
    const contributor = await createActor(prisma, "CONTRIBUTOR");
    const reader = await createActor(prisma, "USER");

    for (const actor of [contributor, reader]) {
      expect(await codeOf(addLink(actor, { kind: "topic.video", ownerId: owner.id, targetId: clip.id }))).toBe("FORBIDDEN");
      expect(await codeOf(addLink(actor, { kind: "library.video", ownerId: shelf.id, targetId: clip.id }))).toBe("FORBIDDEN");
      expect(await codeOf(removeLink(actor, { kind: "topic.video", ownerId: owner.id, targetId: clip.id }))).toBe("FORBIDDEN");
    }
    expect(await codeOf(addLink(null, { kind: "topic.video", ownerId: owner.id, targetId: clip.id }))).toBe("UNAUTHENTICATED");

    const granted = await createActor(prisma, "CONTRIBUTOR", ["topics.manage"]);
    expect(await codeOf(addLink(granted, { kind: "topic.video", ownerId: owner.id, targetId: clip.id }))).toBeUndefined();
  });

  it("audits every change", async () => {
    const owner = await topic();
    const clip = await video();
    await addLink(editor, { kind: "topic.video", ownerId: owner.id, targetId: clip.id });
    await removeLink(editor, { kind: "topic.video", ownerId: owner.id, targetId: clip.id });
    const actions = (await prisma.auditLog.findMany({ where: { entityId: owner.id }, orderBy: { createdAt: "asc" } })).map((row) => row.action);
    expect(actions).toEqual(["link.add", "link.remove"]);
  });

  it("pages through long lists without repeats", async () => {
    const owner = await topic();
    for (let index = 0; index < 35; index += 1) await addLink(editor, { kind: "topic.video", ownerId: owner.id, targetId: (await video()).id });

    const first = await listLinks(editor, { kind: "topic.video", ownerId: owner.id });
    expect(first.items).toHaveLength(30);
    const second = await listLinks(editor, { kind: "topic.video", ownerId: owner.id, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(35);
  });
});

describe("topic pages", () => {
  it("returns nothing for sections with no content, so the page can hide them", async () => {
    const page = await topic();
    const sections = await getTopicSections(page.id, null);
    expect(sections.shorts.items).toEqual([]);
    expect(sections.videos.items).toEqual([]);
    expect(sections.articles.items).toEqual([]);
    expect(sections.resources.items).toEqual([]);
    expect(sections.children).toEqual([]);
    expect(sections.related).toEqual([]);
    expect(sections.complementary).toEqual([]);
    expect(sections.libraries).toEqual([]);
    expect(sections.parent).toBeNull();
  });

  it("shows each kind of content in its own section, and only what's public", async () => {
    const page = await topic();
    const short = await video();
    const longVideo = await video({ kind: "LONG_FORM" });
    const hidden = await video({ status: "DRAFT" });
    const withdrawn = await video({ availability: "UNKNOWN" });
    for (const clip of [short, longVideo, hidden, withdrawn]) await addLink(editor, { kind: "topic.video", ownerId: page.id, targetId: clip.id });

    const live = await article();
    const draft = await article({ status: "DRAFT" });
    const archived = await article({ isArchived: true });
    for (const item of [live, draft, archived]) await addLink(editor, { kind: "topic.article", ownerId: page.id, targetId: item.id });

    const child = await topic({ parentId: page.id });
    await topic({ parentId: page.id, status: "DRAFT" });
    const related = await topic();
    const complementary = await topic();
    const draftRelated = await topic({ status: "DRAFT" });
    await addLink(editor, { kind: "topic.related", ownerId: page.id, targetId: related.id });
    await addLink(editor, { kind: "topic.related", ownerId: page.id, targetId: draftRelated.id });
    await addLink(editor, { kind: "topic.complementary", ownerId: complementary.id, targetId: page.id });

    const shelf = await library();
    await addLink(editor, { kind: "topic.library", ownerId: page.id, targetId: shelf.id });
    const source = await resource();
    await addLink(editor, { kind: "topic.resource", ownerId: page.id, targetId: source.id });

    const sections = await getTopicSections(page.id, null);
    expect(sections.shorts.items.map((row) => row.id)).toEqual([short.id]);
    expect(sections.videos.items.map((row) => row.id)).toEqual([longVideo.id]);
    expect(sections.articles.items.map((row) => row.id)).toEqual([live.id]);
    expect(sections.children.map((row) => row.id)).toEqual([child.id]);
    expect(sections.related.map((row) => row.id)).toEqual([related.id]);
    expect(sections.complementary.map((row) => row.id)).toEqual([complementary.id]);
    expect(sections.libraries.map((row) => row.id)).toEqual([shelf.id]);
    expect(sections.resources.items.map((row) => row.id)).toEqual([source.id]);
  });

  it("shows a parent only if it's public", async () => {
    const parent = await topic();
    const draftParent = await topic({ status: "DRAFT" });
    const child = await topic();
    expect((await getTopicSections(child.id, parent.id)).parent?.slug).toBe(parent.slug);
    expect((await getTopicSections(child.id, draftParent.id)).parent).toBeNull();
  });

  it("pages through a section with no repeats", async () => {
    const page = await topic();
    for (let index = 0; index < 15; index += 1) await addLink(editor, { kind: "topic.article", ownerId: page.id, targetId: (await article()).id });

    const first = await getTopicSections(page.id, null);
    expect(first.articles.items).toHaveLength(12);
    const second = await getTopicSections(page.id, null, { articles: first.articles.nextCursor });
    expect(second.articles.items).toHaveLength(3);
    expect(new Set([...first.articles.items, ...second.articles.items].map((row) => row.id)).size).toBe(15);
  });

  it("ignores a malformed cursor from a URL", async () => {
    const page = await topic();
    await addLink(editor, { kind: "topic.article", ownerId: page.id, targetId: (await article()).id });
    expect((await getTopicSections(page.id, null, { articles: "../../etc" })).articles.items).toHaveLength(1);
  });

  it("lists public topics only, and filters by category", async () => {
    const category = await prisma.category.create({ data: { title: "الفقه", slug: "fiqh" } });
    const inCategory = await topic({ categoryId: category.id });
    const other = await topic();
    await topic({ status: "DRAFT" });
    await topic({ isArchived: true });

    expect((await listPublicTopics()).items.map((row) => row.id).sort()).toEqual([inCategory.id, other.id].sort());
    expect((await listPublicTopics({ categoryId: category.id })).items.map((row) => row.id)).toEqual([inCategory.id]);
  });

  it("makes a clear slug from a title, numbers a clash, and locks it once published", async () => {
    const first = await createTopic(editor, { title: "مشكلة الشر" });
    const second = await createTopic(editor, { title: "مشكلة الشر" });
    expect([first.slug, second.slug]).toEqual(["مشكلة-الشر", "مشكلة-الشر-2"]);

    await setTopicPublished(admin, first.id, true);
    expect(await codeOf(updateTopic(editor, first.id, { slug: "other" }))).toBe("CONFLICT");
    expect(await getPublishedTopicBySlug(encodeURIComponent(first.slug))).not.toBeNull();
  });

  it("rejects an unsafe cover image", async () => {
    expect(await codeOf(createTopic(editor, { title: "س", coverImage: "javascript:alert(1)" }))).toBe("VALIDATION");
  });
});

describe("deleting a topic", () => {
  it("removes every link, keeps its children and videos, and needs permission", async () => {
    const page = await topic();
    const child = await topic({ parentId: page.id });
    const related = await topic();
    const clip = await video();
    const keptTopic = await topic();
    await addLink(editor, { kind: "topic.video", ownerId: page.id, targetId: clip.id });
    await addLink(editor, { kind: "topic.video", ownerId: keptTopic.id, targetId: clip.id });
    await addLink(editor, { kind: "topic.related", ownerId: page.id, targetId: related.id });
    await prisma.video.update({ where: { id: clip.id }, data: { cta: { type: "TOPIC", targetId: page.id } } });

    expect(await codeOf(deleteTopic(editor, page.id))).toBe("FORBIDDEN");
    await deleteTopic(admin, page.id);

    expect(await prisma.topic.count({ where: { id: page.id } })).toBe(0);
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: child.id } })).parentId).toBeNull();
    expect(await prisma.topicRelation.count()).toBe(0);
    expect(await prisma.videoTopic.count({ where: { topicId: page.id } })).toBe(0);

    const stored = await prisma.video.findUniqueOrThrow({ where: { id: clip.id } });
    expect(stored.topicIds).toEqual([keptTopic.id]);
    expect(stored.cta).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "topic.delete", entityId: page.id } })).toBe(1);
  });
});

describe("libraries", () => {
  it("creates drafts and hides them until published", async () => {
    const shelf = await createLibrary(editor, { name: "مكتبة نقد الإلحاد", description: "وصف" });
    expect(shelf.status).toBe("DRAFT");
    expect(shelf.slug).toBe("مكتبة-نقد-الإلحاد");
    expect(await getPublishedLibraryBySlug(shelf.slug)).toBeNull();
    expect((await listPublishedLibraries()).items).toEqual([]);

    expect(await codeOf(setLibraryPublished(editor, shelf.id, true))).toBe("FORBIDDEN");
    await setLibraryPublished(admin, shelf.id, true);
    expect(await getPublishedLibraryBySlug(shelf.slug)).not.toBeNull();

    await setLibraryArchived(admin, shelf.id, true);
    expect(await getPublishedLibraryBySlug(shelf.slug)).toBeNull();
    expect(await codeOf(setLibraryPublished(admin, shelf.id, true))).toBe("CONFLICT");
  });

  it("lists top-level libraries whether their parent field is null or missing", async () => {
    const created = await createLibrary(editor, { name: "بلا حقل أب" });
    const explicit = await createLibrary(editor, { name: "أب فارغ", parentId: null });
    const child = await createLibrary(editor, { name: "فرعية", parentId: created.id });
    for (const item of [created, explicit, child]) await setLibraryPublished(admin, item.id, true);

    expect((await listPublishedLibraries()).items.map((row) => row.id).sort()).toEqual([created.id, explicit.id].sort());
  });

  it("refuses staff without the permission, and non-staff", async () => {
    const contributor = await createActor(prisma, "CONTRIBUTOR");
    expect(await codeOf(createLibrary(contributor, { name: "م" }))).toBe("FORBIDDEN");
    expect(await codeOf(createLibrary(null, { name: "م" }))).toBe("UNAUTHENTICATED");
    expect(await codeOf(listLibrariesForAdmin(await createActor(prisma, "USER"), {}))).toBe("FORBIDDEN");
    expect((await createLibrary(await createActor(prisma, "CONTRIBUTOR", ["libraries.manage"]), { name: "م" })).status).toBe("DRAFT");
  });

  it("rejects a parent that would create a loop, or doesn't exist", async () => {
    const top = await library();
    const middle = await library({ parentId: top.id });
    const bottom = await library({ parentId: middle.id });

    expect(await codeOf(updateLibrary(editor, top.id, { name: "س", parentId: bottom.id }))).toBe("VALIDATION");
    expect(await codeOf(updateLibrary(editor, top.id, { name: "س", parentId: top.id }))).toBe("VALIDATION");
    expect(await codeOf(createLibrary(editor, { name: "س", parentId: "507f1f77bcf86cd799439011" }))).toBe("VALIDATION");
  });

  it("holds the same article in several libraries without duplicating it", async () => {
    const [first, second] = [await library(), await library()];
    const item = await article();
    await addLink(editor, { kind: "library.article", ownerId: first.id, targetId: item.id });
    await addLink(editor, { kind: "library.article", ownerId: second.id, targetId: item.id });

    expect(await prisma.article.count()).toBe(1);
    expect((await getLibrarySections(first.id)).articles.items.map((row) => row.id)).toEqual([item.id]);
    expect((await getLibrarySections(second.id)).articles.items.map((row) => row.id)).toEqual([item.id]);
  });

  it("leads with featured items, without repeating them below", async () => {
    const shelf = await library();
    const picked = await article();
    const other = await article();
    const pickedClip = await video();
    await addLink(editor, { kind: "library.article", ownerId: shelf.id, targetId: picked.id });
    await addLink(editor, { kind: "library.article", ownerId: shelf.id, targetId: other.id });
    await addLink(editor, { kind: "library.video", ownerId: shelf.id, targetId: pickedClip.id });

    await setLibraryItemFeatured(editor, { kind: "library.article", ownerId: shelf.id, targetId: picked.id, isFeatured: true });
    await setLibraryItemFeatured(editor, { kind: "library.video", ownerId: shelf.id, targetId: pickedClip.id, isFeatured: true });

    const sections = await getLibrarySections(shelf.id);
    expect(sections.featuredArticles.map((row) => row.id)).toEqual([picked.id]);
    expect(sections.featuredVideos.map((row) => row.id)).toEqual([pickedClip.id]);
    expect(sections.articles.items.map((row) => row.id)).toEqual([other.id]);
    expect(sections.videos.items).toEqual([]);

    expect(await codeOf(setLibraryItemFeatured(await createActor(prisma, "CONTRIBUTOR"), { kind: "library.article", ownerId: shelf.id, targetId: picked.id, isFeatured: false }))).toBe("FORBIDDEN");
    expect(await codeOf(setLibraryItemFeatured(editor, { kind: "library.article", ownerId: shelf.id, targetId: "507f1f77bcf86cd799439011", isFeatured: true }))).toBe("NOT_FOUND");
  });

  it("shows sub-libraries, related libraries, topics, and resources, public only", async () => {
    const shelf = await library();
    const child = await library({ parentId: shelf.id });
    await library({ parentId: shelf.id, status: "DRAFT" });
    const related = await library();
    const page = await topic();
    const source = await resource();
    const hidden = await resource({ status: "DRAFT" });
    await addLink(editor, { kind: "library.related", ownerId: related.id, targetId: shelf.id });
    await addLink(editor, { kind: "library.topic", ownerId: shelf.id, targetId: page.id });
    await addLink(editor, { kind: "library.resource", ownerId: shelf.id, targetId: source.id });
    await addLink(editor, { kind: "library.resource", ownerId: shelf.id, targetId: hidden.id });

    const sections = await getLibrarySections(shelf.id);
    expect(sections.children.map((row) => row.id)).toEqual([child.id]);
    expect(sections.related.map((row) => row.id)).toEqual([related.id]);
    expect(sections.topics.map((row) => row.id)).toEqual([page.id]);
    expect(sections.resources.map((row) => row.id)).toEqual([source.id]);
    expect((await listPublishedLibraries()).items.map((row) => row.id)).not.toContain(child.id);
    expect((await getPublicLibraryParent(shelf.id))?.slug).toBe(shelf.slug);
  });

  it("deleting removes links and copies, and keeps sub-libraries", async () => {
    const shelf = await library();
    const child = await library({ parentId: shelf.id });
    const related = await library();
    const clip = await video();
    await addLink(editor, { kind: "library.video", ownerId: shelf.id, targetId: clip.id });
    await addLink(editor, { kind: "library.related", ownerId: shelf.id, targetId: related.id });

    expect(await codeOf(deleteLibrary(editor, shelf.id))).toBe("FORBIDDEN");
    await deleteLibrary(admin, shelf.id);

    expect(await prisma.library.count({ where: { id: shelf.id } })).toBe(0);
    expect((await prisma.library.findUniqueOrThrow({ where: { id: child.id } })).parentId).toBeNull();
    expect(await prisma.libraryRelation.count()).toBe(0);
    expect((await prisma.video.findUniqueOrThrow({ where: { id: clip.id } })).libraryIds).toEqual([]);
  });
});

describe("external resources", () => {
  const valid = (overrides: Record<string, unknown> = {}) => {
    counter += 1;
    return { title: "مقال خارجي", sourceName: "موقع", url: `https://example.org/article-${counter}`, ...overrides };
  };

  it("stores only a description and a link, and starts as a draft", async () => {
    const item = await createResource(editor, valid({ description: "وصف قصير" }));
    expect(item.status).toBe("DRAFT");
    expect(await getPublishedResourceBySlug(item.slug)).toBeNull();
    expect(await codeOf(createResource(editor, valid({ body: "نص كامل منسوخ" })))).toBe("VALIDATION");

    await setResourcePublished(admin, item.id, true);
    expect((await getPublishedResourceBySlug(item.slug))?.resource.description).toBe("وصف قصير");
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "ftp://example.org/x", "/articles/x", "example.org", ""])("rejects the address %j", async (url) => {
    expect(await codeOf(createResource(editor, valid({ url })))).toBe("VALIDATION");
  });

  it("refuses the same link twice", async () => {
    await createResource(editor, valid({ url: "https://example.org/same" }));
    expect(await codeOf(createResource(editor, valid({ url: "https://example.org/same" })))).toBe("CONFLICT");
  });

  it("enforces permissions, and locks the address once published", async () => {
    const contributor = await createActor(prisma, "CONTRIBUTOR");
    expect(await codeOf(createResource(contributor, valid()))).toBe("FORBIDDEN");
    expect(await codeOf(createResource(null, valid()))).toBe("UNAUTHENTICATED");

    const item = await createResource(editor, valid({ slug: "fixed-resource" }));
    expect(await codeOf(setResourcePublished(editor, item.id, true))).toBe("FORBIDDEN");
    await setResourcePublished(admin, item.id, true);
    expect(await codeOf(updateResource(editor, item.id, valid({ slug: "moved" })))).toBe("CONFLICT");
  });

  it("deleting clears links from topics, libraries, and video CTAs", async () => {
    const item = await resource();
    const page = await topic();
    const clip = await video({ cta: { type: "EXTERNAL_RESOURCE", targetId: item.id } });
    await addLink(editor, { kind: "topic.resource", ownerId: page.id, targetId: item.id });

    expect(await codeOf(deleteResource(editor, item.id))).toBe("FORBIDDEN");
    await deleteResource(admin, item.id);

    expect(await prisma.resourceTopic.count()).toBe(0);
    expect((await prisma.video.findUniqueOrThrow({ where: { id: clip.id } })).cta).toBeNull();
  });
});

describe("image uploads", () => {
  const png = () => sharp({ create: { width: 30, height: 20, channels: 3, background: "#222222" } }).png().toBuffer();

  it("stores a processed image for staff, audits it, and returns its address", async () => {
    const contributor = await createActor(prisma, "CONTRIBUTOR");
    const image = await uploadImage(contributor, await png());

    expect(image.url).toMatch(/^\/media\/images\/\d{4}\/\d{2}\/[a-f0-9-]{36}\.webp$/);
    expect([image.width, image.height]).toEqual([30, 20]);
    expect(await readLocalObject(image.url.replace("/media/", ""))).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "media.upload", actorId: contributor.id } })).toBe(1);
  });

  it("refuses guests and non-staff, before looking at the file", async () => {
    expect(await codeOf(uploadImage(null, await png()))).toBe("UNAUTHENTICATED");
    expect(await codeOf(uploadImage(await createActor(prisma, "USER"), await png()))).toBe("FORBIDDEN");
  });

  it("lets a reviewer upload, since they can edit what's assigned to them", async () => {
    const reviewer = await createActor(prisma, "SCIENTIFIC_REVIEWER");
    expect(await codeOf(uploadImage(reviewer, await png()))).toBeUndefined();
  });

  it("rejects files that aren't images, and records nothing", async () => {
    const before = await prisma.auditLog.count();
    expect(await codeOf(uploadImage(editor, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')))).toBe("VALIDATION");
    expect(await codeOf(uploadImage(editor, Buffer.from("not an image at all")))).toBe("VALIDATION");
    expect(await prisma.auditLog.count()).toBe(before);
  });
});

describe("articles appearing on topics and libraries", () => {
  it("follow an article's publishing status, whichever side made the link", async () => {
    const page = await topic();
    const draft = await createArticle(admin, { title: "من النموذج", body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "نص" }] }] }, topicIds: [page.id] });
    expect((await getTopicSections(page.id, null)).articles.items).toEqual([]);

    await setArticlePublished(admin, draft.id, true);
    expect((await getTopicSections(page.id, null)).articles.items.map((row) => row.id)).toEqual([draft.id]);
  });
});
