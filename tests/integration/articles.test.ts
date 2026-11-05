import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createArticle,
  deleteArticle,
  getArticleConnections,
  getArticleForEditing,
  getPublishedArticleBySlug,
  listArticlesForAdmin,
  listPublishedArticlesForVideo,
  setArticleArchived,
  setArticlePublished,
  updateArticle,
} from "@/features/articles/articles.service";
import { addReviewNote, listReviewNotes, setReviewNoteResolved } from "@/features/articles/review-notes.service";
import { getSavedIds, setContentSaved } from "@/features/favorites/favorites.service";
import { searchPicker } from "@/features/relationships/picker.service";
import { toVideoCards, videoCardSelect } from "@/features/shorts/video-cards";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { clearDatabase, createTestClient } from "./helpers";
import { createActor } from "./phase3-helpers";

process.env.APP_URL = "http://localhost:3000";

let prisma: PrismaClient;
let counter = 0;

async function codeOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : `UNEXPECTED: ${String(error)}`;
  }
}

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const body = (...content: unknown[]) => ({ type: "doc", content });
const textBody = body(paragraph("نص المقال"));

function input(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return { title: `مقال ${counter}`, body: textBody, ...overrides };
}

async function createVideo(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return prisma.video.create({
    data: {
      youtubeVideoId: `vid${String(counter).padStart(8, "0")}`,
      kind: "SHORT",
      classification: "SHORT_CANDIDATE",
      title: `فيديو ${counter}`,
      feedKey: counter,
      status: "PUBLISHED",
      availability: "AVAILABLE",
      ...overrides,
    },
  });
}

async function publishedArticle(admin: Actor, overrides: Record<string, unknown> = {}) {
  const article = await createArticle(admin, input(overrides));
  return setArticlePublished(admin, article.id, true);
}

async function publishedTopic(title = `موضوع ${++counter}`) {
  return prisma.topic.create({ data: { title, slug: `topic-${++counter}`, status: "PUBLISHED" } });
}

beforeAll(() => {
  prisma = createTestClient();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await clearDatabase(prisma);
});

describe("who can do what", () => {
  it("lets staff with the permission create drafts, and nobody else", async () => {
    expect(await codeOf(createArticle(null, input()))).toBe("UNAUTHENTICATED");
    expect(await codeOf(createArticle(await createActor(prisma, "USER"), input()))).toBe("FORBIDDEN");
    expect(await codeOf(createArticle(await createActor(prisma, "SCIENTIFIC_REVIEWER"), input()))).toBe("FORBIDDEN");

    for (const role of ["CONTRIBUTOR", "EDITOR", "ADMIN", "SUPER_ADMIN"] as const) {
      const article = await createArticle(await createActor(prisma, role), input());
      expect(article.status).toBe("DRAFT");
    }
  });

  it("never lets the client choose the status or the author", async () => {
    const contributor = await createActor(prisma, "CONTRIBUTOR");
    expect(await codeOf(createArticle(contributor, input({ status: "PUBLISHED" })))).toBe("VALIDATION");
    expect(await codeOf(createArticle(contributor, input({ authorId: "507f1f77bcf86cd799439011" })))).toBe("VALIDATION");
  });

  it("lets a contributor edit their own draft, but not someone else's", async () => {
    const owner = await createActor(prisma, "CONTRIBUTOR");
    const other = await createActor(prisma, "CONTRIBUTOR");
    const article = await createArticle(owner, input());

    expect(await codeOf(updateArticle(owner, article.id, input()))).toBeUndefined();
    expect(await codeOf(updateArticle(other, article.id, input()))).toBe("FORBIDDEN");
    expect(await codeOf(getArticleForEditing(other, article.id))).toBe("FORBIDDEN");
  });

  it("stops a contributor editing once published, and the reader-facing copy is unchanged", async () => {
    const owner = await createActor(prisma, "CONTRIBUTOR");
    const admin = await createActor(prisma, "ADMIN");
    const article = await createArticle(owner, input({ title: "الأصل" }));
    await setArticlePublished(admin, article.id, true);

    expect(await codeOf(updateArticle(owner, article.id, input({ title: "تعديل" })))).toBe("FORBIDDEN");
    expect((await prisma.article.findUniqueOrThrow({ where: { id: article.id } })).title).toBe("الأصل");
  });

  it("assigning is limited to those who can edit anything, and it grants editing", async () => {
    const editor = await createActor(prisma, "EDITOR");
    const assigned = await createActor(prisma, "CONTRIBUTOR");
    const reader = await createActor(prisma, "USER");
    const contributor = await createActor(prisma, "CONTRIBUTOR");

    expect(await codeOf(createArticle(contributor, input({ assigneeIds: [assigned.id] })))).toBe("FORBIDDEN");
    expect(await codeOf(createArticle(editor, input({ assigneeIds: [reader.id] })))).toBe("VALIDATION");

    const article = await createArticle(editor, input({ assigneeIds: [assigned.id] }));
    expect(await codeOf(updateArticle(assigned, article.id, input()))).toBeUndefined();
    expect(await codeOf(updateArticle(assigned, article.id, input({ assigneeIds: [contributor.id] })))).toBe("FORBIDDEN");
  });

  it("publishing needs the publish permission, whatever the role, and a grant provides it", async () => {
    const editor = await createActor(prisma, "EDITOR");
    const contributor = await createActor(prisma, "CONTRIBUTOR");
    const reviewer = await createActor(prisma, "SCIENTIFIC_REVIEWER");
    const article = await createArticle(editor, input());

    for (const actor of [null, editor, contributor, reviewer]) {
      expect(await codeOf(setArticlePublished(actor, article.id, true))).toBe(actor ? "FORBIDDEN" : "UNAUTHENTICATED");
    }

    const granted = await createActor(prisma, "CONTRIBUTOR", ["content.publish"]);
    expect((await setArticlePublished(granted, article.id, true)).status).toBe("PUBLISHED");
  });

  it("archiving and deleting need their own permissions", async () => {
    const editor = await createActor(prisma, "EDITOR");
    const admin = await createActor(prisma, "ADMIN");
    const article = await createArticle(editor, input());

    expect(await codeOf(setArticleArchived(editor, article.id, true))).toBe("FORBIDDEN");
    expect(await codeOf(deleteArticle(editor, article.id))).toBe("FORBIDDEN");
    expect(await codeOf(setArticleArchived(admin, article.id, true))).toBeUndefined();
    expect(await codeOf(deleteArticle(admin, article.id))).toBeUndefined();
  });

  it("shows staff only what they may see in the list", async () => {
    const editor = await createActor(prisma, "EDITOR");
    const owner = await createActor(prisma, "CONTRIBUTOR");
    const assigned = await createActor(prisma, "CONTRIBUTOR");
    const stranger = await createActor(prisma, "CONTRIBUTOR");
    const mine = await createArticle(owner, input({ title: "مقالتي" }));
    const given = await createArticle(editor, input({ title: "مكلَّف", assigneeIds: [assigned.id] }));
    await createArticle(editor, input({ title: "غيرها" }));

    expect((await listArticlesForAdmin(owner, {})).items.map((row) => row.id)).toEqual([mine.id]);
    expect((await listArticlesForAdmin(assigned, {})).items.map((row) => row.id)).toEqual([given.id]);
    expect((await listArticlesForAdmin(stranger, {})).items).toEqual([]);
    expect((await listArticlesForAdmin(editor, {})).items).toHaveLength(3);
    expect(await codeOf(listArticlesForAdmin(await createActor(prisma, "USER"), {}))).toBe("FORBIDDEN");
  });

  it("searches the list with Arabic spelling variants", async () => {
    const editor = await createActor(prisma, "EDITOR");
    await createArticle(editor, input({ title: "أحكام الصلاة" }));
    await createArticle(editor, input({ title: "مقال آخر" }));

    const found = await listArticlesForAdmin(editor, { query: "احكام الصلاه" });
    expect(found.items.map((row) => row.title)).toEqual(["أحكام الصلاة"]);
  });
});

describe("content safety", () => {
  it("neutralises hostile content on save", async () => {
    const editor = await createActor(prisma, "EDITOR");
    const hostile = body(
      { type: "script", content: [{ type: "text", text: "alert(1)" }] },
      { type: "html", attrs: { value: "<img src=x onerror=alert(1)>" } },
      { type: "paragraph", attrs: { onclick: "alert(1)" }, content: [{ type: "text", text: "رابط", marks: [{ type: "link", attrs: { href: "javascript:alert(1)", onclick: "x" } }] }] },
      { type: "figure", attrs: { src: "javascript:alert(1)", alt: "x" } },
    );
    const article = await createArticle(editor, input({ body: hostile }));

    const stored = (await prisma.article.findUniqueOrThrow({ where: { id: article.id } })).body;
    expect(stored).toEqual(body({ type: "paragraph", content: [{ type: "text", text: "رابط" }] }));
    expect(JSON.stringify(stored)).not.toMatch(/alert|onclick|script/);
  });

  it("re-checks what's stored, even if the database was changed directly", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const article = await publishedArticle(admin, { slug: "tampered" });
    await prisma.article.update({ where: { id: article.id }, data: { body: { type: "doc", content: [{ type: "script" }, paragraph("سليم")] } } });

    const { sanitizeDocument } = await import("@/lib/content/document");
    const loaded = await getPublishedArticleBySlug("tampered");
    expect(sanitizeDocument(loaded!.body)).toEqual(body(paragraph("سليم")));
  });

  it("rejects a body too large to be a real article", async () => {
    const editor = await createActor(prisma, "EDITOR");
    expect(await codeOf(createArticle(editor, input({ body: body(paragraph("أ".repeat(2_600_000))) })))).toBe("VALIDATION");
  });

  it("rejects unsafe source links and cover images", async () => {
    const editor = await createActor(prisma, "EDITOR");
    expect(await codeOf(createArticle(editor, input({ sources: [{ title: "x", url: "javascript:alert(1)" }] })))).toBe("VALIDATION");
    expect(await codeOf(createArticle(editor, input({ coverImage: "javascript:alert(1)" })))).toBe("VALIDATION");
    expect(await codeOf(createArticle(editor, input({ coverImage: "/media/../../.env" })))).toBe("VALIDATION");
  });
});

describe("derived fields", () => {
  it("calculates headings, reading time, and search fields from the body", async () => {
    const editor = await createActor(prisma, "EDITOR");
    const words = Array(450).fill("كلمة").join(" ");
    const article = await createArticle(editor, input({ title: "الصلاة", body: body({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "المقدمة" }] }, paragraph(words)) }));

    expect(article.headings).toEqual([{ anchor: "المقدمة", level: 2, text: "المقدمة" }]);
    expect(article.readingMinutes).toBe(3);
    expect(article.titleSearch).toBe("الصلاه");
    expect(article.searchText.split(" ")).toEqual(expect.arrayContaining(["الصلاه", "صلاه", "كلمه"]));
  });
});

describe("slugs", () => {
  it("numbers a clash from a title, but reports a clash with a typed slug", async () => {
    const editor = await createActor(prisma, "EDITOR");
    const first = await createArticle(editor, input({ title: "عنوان مكرر" }));
    const second = await createArticle(editor, input({ title: "عنوان مكرر" }));
    expect([first.slug, second.slug]).toEqual(["عنوان-مكرر", "عنوان-مكرر-2"]);

    expect(await codeOf(createArticle(editor, input({ slug: "عنوان-مكرر" })))).toBe("CONFLICT");
    expect(await codeOf(createArticle(editor, input({ slug: "has space" })))).toBe("VALIDATION");
  });

  it("locks the address once published, and frees it after unpublishing", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const article = await publishedArticle(admin, { slug: "fixed" });

    expect(await codeOf(updateArticle(admin, article.id, input({ slug: "moved" })))).toBe("CONFLICT");
    expect((await updateArticle(admin, article.id, input())).slug).toBe("fixed");

    await setArticlePublished(admin, article.id, false);
    expect((await updateArticle(admin, article.id, input({ slug: "moved" }))).slug).toBe("moved");
  });

  it("finds an article by its encoded Arabic address", async () => {
    const admin = await createActor(prisma, "ADMIN");
    await publishedArticle(admin, { title: "نقد الإلحاد" });
    expect(await getPublishedArticleBySlug(encodeURIComponent("نقد-الإلحاد"))).not.toBeNull();
  });
});

describe("publishing", () => {
  it("is only draft to published, and keeps the first publication date", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const article = await createArticle(admin, input());
    const published = await setArticlePublished(admin, article.id, true);
    const firstDate = published.publishedAt;
    expect(firstDate).not.toBeNull();

    await setArticlePublished(admin, article.id, false);
    const again = await setArticlePublished(admin, article.id, true);
    expect(again.publishedAt).toEqual(firstDate);
  });

  it("refuses to publish an empty article or an archived one", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const empty = await createArticle(admin, input({ body: body({ type: "paragraph" }) }));
    expect(await codeOf(setArticlePublished(admin, empty.id, true))).toBe("CONFLICT");

    const archived = await createArticle(admin, input());
    await setArticleArchived(admin, archived.id, true);
    expect(await codeOf(setArticlePublished(admin, archived.id, true))).toBe("CONFLICT");
  });

  it("hides drafts, unpublished, and archived articles from the public", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const draft = await createArticle(admin, input({ slug: "draft-one" }));
    expect(await getPublishedArticleBySlug(draft.slug)).toBeNull();

    const live = await publishedArticle(admin, { slug: "live-one" });
    expect(await getPublishedArticleBySlug(live.slug)).not.toBeNull();

    await setArticleArchived(admin, live.id, true);
    expect(await getPublishedArticleBySlug(live.slug)).toBeNull();

    await setArticleArchived(admin, live.id, false);
    await setArticlePublished(admin, live.id, false);
    expect(await getPublishedArticleBySlug(live.slug)).toBeNull();
  });

  it("records each privileged step in the audit log", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const article = await createArticle(admin, input());
    await updateArticle(admin, article.id, input());
    await setArticlePublished(admin, article.id, true);
    await setArticlePublished(admin, article.id, false);
    await setArticleArchived(admin, article.id, true);
    await setArticleArchived(admin, article.id, false);
    await deleteArticle(admin, article.id);

    const actions = (await prisma.auditLog.findMany({ where: { entityId: article.id }, orderBy: { createdAt: "asc" } })).map((row) => row.action);
    expect(actions).toEqual(["article.create", "article.update", "article.publish", "article.unpublish", "article.archive", "article.restore", "article.delete"]);
  });

  it("rolls back an edit completely when one attached item is invalid", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const topic = await publishedTopic();
    const article = await createArticle(admin, input({ title: "قبل", topicIds: [topic.id] }));

    expect(await codeOf(updateArticle(admin, article.id, input({ title: "بعد", topicIds: ["507f1f77bcf86cd799439011"] })))).toBe("VALIDATION");

    const stored = await prisma.article.findUniqueOrThrow({ where: { id: article.id }, include: { topics: true } });
    expect(stored.title).toBe("قبل");
    expect(stored.topics).toHaveLength(1);
  });
});

describe("relationships from the article form", () => {
  it("works with no relationships at all, since all are optional", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const article = await publishedArticle(admin);
    const connections = await getArticleConnections(article.id);
    expect(connections).toEqual({ topics: [], libraries: [], shorts: [], longVideos: [], relationGroups: [] });
  });

  it("attaches everything in one save and returns only what is public", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const topic = await publishedTopic();
    const draftTopic = await prisma.topic.create({ data: { title: "مسودة", slug: `draft-${++counter}` } });
    const library = await prisma.library.create({ data: { name: "مكتبة", slug: `lib-${++counter}`, status: "PUBLISHED" } });
    const short = await createVideo();
    const longVideo = await createVideo({ kind: "LONG_FORM" });
    const hiddenVideo = await createVideo({ status: "DRAFT" });
    const related = await publishedArticle(admin);
    const draftRelated = await createArticle(admin, input());
    const resource = await prisma.externalResource.create({ data: { title: "مصدر", slug: `res-${++counter}`, sourceName: "موقع", url: `https://example.org/${counter}`, status: "PUBLISHED" } });

    const article = await publishedArticle(admin, {
      topicIds: [topic.id, draftTopic.id],
      libraryIds: [library.id],
      videoIds: [short.id, longVideo.id, hiddenVideo.id],
      relations: [
        { relationType: "RELATED_ARTICLE", targetType: "ARTICLE", targetId: related.id },
        { relationType: "RELATED_ARTICLE", targetType: "ARTICLE", targetId: draftRelated.id },
        { relationType: "RELATED_RESOURCE", targetType: "RESOURCE", targetId: resource.id },
      ],
    });

    const connections = await getArticleConnections(article.id);
    expect(connections.topics.map((row) => row.id)).toEqual([topic.id]);
    expect(connections.libraries.map((row) => row.id)).toEqual([library.id]);
    expect(connections.shorts.map((row) => row.id)).toEqual([short.id]);
    expect(connections.longVideos.map((row) => row.id)).toEqual([longVideo.id]);

    const groups = Object.fromEntries(connections.relationGroups.map((group) => [group.relationType, group]));
    expect(groups.RELATED_ARTICLE!.articles.map((row) => row.id)).toEqual([related.id]);
    expect(groups.RELATED_RESOURCE!.resources.map((row) => row.id)).toEqual([resource.id]);
  });

  it("keeps Shorts in the order the editor chose", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const [a, b, c] = [await createVideo(), await createVideo(), await createVideo()];
    const article = await publishedArticle(admin, { videoIds: [c.id, a.id, b.id] });
    expect((await getArticleConnections(article.id)).shorts.map((row) => row.id)).toEqual([c.id, a.id, b.id]);
  });

  it("shows a related article from both sides", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const target = await publishedArticle(admin);
    const source = await publishedArticle(admin, { relations: [{ relationType: "RELATED_ARTICLE", targetType: "ARTICLE", targetId: target.id }] });

    const fromTarget = await getArticleConnections(target.id);
    expect(fromTarget.relationGroups[0]!.articles.map((row) => row.id)).toEqual([source.id]);
  });

  it("rejects a self-relation, a wrong target type, and targets that don't exist", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const article = await createArticle(admin, input());
    const topic = await publishedTopic();

    expect(await codeOf(updateArticle(admin, article.id, input({ relations: [{ relationType: "RELATED_ARTICLE", targetType: "ARTICLE", targetId: article.id }] })))).toBe("VALIDATION");
    expect(await codeOf(updateArticle(admin, article.id, input({ relations: [{ relationType: "RELATED_ARTICLE", targetType: "TOPIC", targetId: topic.id }] })))).toBe("VALIDATION");
    expect(await codeOf(updateArticle(admin, article.id, input({ relations: [{ relationType: "RELATED_RESOURCE", targetType: "RESOURCE", targetId: "507f1f77bcf86cd799439011" }] })))).toBe("VALIDATION");
    expect(await codeOf(updateArticle(admin, article.id, input({ topicIds: ["507f1f77bcf86cd799439011"] })))).toBe("VALIDATION");
    expect(await codeOf(updateArticle(admin, article.id, input({ videoIds: ["not-an-id"] })))).toBe("VALIDATION");
  });

  it("treats repeated picks as one, and a later save replaces the links", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const [first, second] = [await publishedTopic(), await publishedTopic()];
    const article = await createArticle(admin, input({ topicIds: [first.id, first.id] }));
    expect(await prisma.articleTopic.count({ where: { articleId: article.id } })).toBe(1);

    await updateArticle(admin, article.id, input({ topicIds: [second.id] }));
    const links = await prisma.articleTopic.findMany({ where: { articleId: article.id } });
    expect(links.map((link) => link.topicId)).toEqual([second.id]);
  });

  it("returns the attached items' names for the editing form", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const topic = await publishedTopic("الصلاة");
    const video = await createVideo({ title: "مقطع", channelTitle: "قناة" });
    const article = await createArticle(admin, input({ topicIds: [topic.id], videoIds: [video.id] }));

    const editing = await getArticleForEditing(admin, article.id);
    expect(editing.topics).toEqual([{ id: topic.id, type: "TOPIC", label: "الصلاة" }]);
    expect(editing.videos[0]!.hint).toContain("YouTube");
    expect(editing.videos[0]!.hint).toContain("قناة");
    expect(editing.canEdit).toBe(true);
  });

  it("lists articles on a video's page, published only", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const video = await createVideo();
    const live = await publishedArticle(admin, { videoIds: [video.id] });
    await createArticle(admin, input({ videoIds: [video.id] }));

    expect((await listPublishedArticlesForVideo(video.id)).map((row) => row.id)).toEqual([live.id]);
  });
});

describe("deleting an article", () => {
  it("leaves no reference behind", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const reader = await createActor(prisma, "USER");
    const topic = await publishedTopic();
    const library = await prisma.library.create({ data: { name: "م", slug: `lib-${++counter}` } });
    const video = await createVideo();
    const other = await publishedArticle(admin);
    const article = await publishedArticle(admin, {
      topicIds: [topic.id],
      libraryIds: [library.id],
      videoIds: [video.id],
      relations: [{ relationType: "RELATED_ARTICLE", targetType: "ARTICLE", targetId: other.id }],
    });
    await updateArticle(admin, other.id, input({ relations: [{ relationType: "FURTHER_READING", targetType: "ARTICLE", targetId: article.id }] }));
    await setContentSaved(reader, { entityType: "ARTICLE", entityId: article.id, isSaved: true });
    await addReviewNote(admin, article.id, "ملاحظة");
    await prisma.video.update({ where: { id: video.id }, data: { cta: { type: "INTERNAL_ARTICLE", targetId: article.id } } });
    await prisma.collection.create({ data: { title: "c", slug: `col-${++counter}`, items: { create: { entityType: "ARTICLE", entityId: article.id, position: 0 } } } });

    await deleteArticle(admin, article.id);

    expect(await prisma.article.count({ where: { id: article.id } })).toBe(0);
    expect(await prisma.articleTopic.count({ where: { articleId: article.id } })).toBe(0);
    expect(await prisma.articleLibrary.count({ where: { articleId: article.id } })).toBe(0);
    expect(await prisma.articleVideo.count({ where: { articleId: article.id } })).toBe(0);
    expect(await prisma.contentRelation.count({ where: { OR: [{ sourceId: article.id }, { targetId: article.id }] } })).toBe(0);
    expect(await prisma.favorite.count({ where: { entityId: article.id } })).toBe(0);
    expect(await prisma.reviewNote.count({ where: { entityId: article.id } })).toBe(0);
    expect(await prisma.collectionItem.count({ where: { entityId: article.id } })).toBe(0);
    expect((await prisma.video.findUniqueOrThrow({ where: { id: video.id } })).cta).toBeNull();
    // What it was linked to survives.
    expect(await prisma.topic.count({ where: { id: topic.id } })).toBe(1);
    expect(await prisma.article.count({ where: { id: other.id } })).toBe(1);
  });
});

describe("review notes", () => {
  it("are feedback only: they never block publishing, even unresolved", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const reviewer = await createActor(prisma, "SCIENTIFIC_REVIEWER");
    const article = await createArticle(admin, input());
    await addReviewNote(reviewer, article.id, "يحتاج إلى مراجعة");

    expect((await setArticlePublished(admin, article.id, true)).status).toBe("PUBLISHED");
  });

  it("gives a reviewer no way to publish", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const reviewer = await createActor(prisma, "SCIENTIFIC_REVIEWER");
    const article = await createArticle(admin, input());
    expect(await codeOf(setArticlePublished(reviewer, article.id, true))).toBe("FORBIDDEN");
  });

  it("limits who can add, read, and resolve", async () => {
    const owner = await createActor(prisma, "CONTRIBUTOR");
    const stranger = await createActor(prisma, "CONTRIBUTOR");
    const reviewer = await createActor(prisma, "SCIENTIFIC_REVIEWER");
    const article = await createArticle(owner, input());

    expect(await codeOf(addReviewNote(owner, article.id, "ملاحظة"))).toBe("FORBIDDEN");
    expect(await codeOf(addReviewNote(null, article.id, "ملاحظة"))).toBe("UNAUTHENTICATED");
    const note = await addReviewNote(reviewer, article.id, "ملاحظة");
    expect(await codeOf(addReviewNote(reviewer, article.id, "   "))).toBe("VALIDATION");

    expect((await listReviewNotes(owner, article.id)).map((row) => row.body)).toEqual(["ملاحظة"]);
    expect(await codeOf(listReviewNotes(stranger, article.id))).toBe("FORBIDDEN");

    expect(await codeOf(setReviewNoteResolved(stranger, note.id, true))).toBe("FORBIDDEN");
    await setReviewNoteResolved(owner, note.id, true);
    expect((await listReviewNotes(owner, article.id))[0]!.isResolved).toBe(true);
  });

  it("lets a reviewer read a draft they can't edit", async () => {
    const owner = await createActor(prisma, "CONTRIBUTOR");
    const reviewer = await createActor(prisma, "SCIENTIFIC_REVIEWER");
    const article = await createArticle(owner, input());

    const editing = await getArticleForEditing(reviewer, article.id);
    expect(editing.canEdit).toBe(false);
    expect(await codeOf(updateArticle(reviewer, article.id, input()))).toBe("FORBIDDEN");
  });
});

describe("saving articles", () => {
  it("is for signed-in people, for public articles, and safe to repeat", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const reader = await createActor(prisma, "USER");
    const other = await createActor(prisma, "USER");
    const live = await publishedArticle(admin);
    const draft = await createArticle(admin, input());

    expect(await codeOf(setContentSaved(null, { entityType: "ARTICLE", entityId: live.id, isSaved: true }))).toBe("UNAUTHENTICATED");
    expect(await codeOf(setContentSaved(reader, { entityType: "ARTICLE", entityId: draft.id, isSaved: true }))).toBe("NOT_FOUND");

    await setContentSaved(reader, { entityType: "ARTICLE", entityId: live.id, isSaved: true });
    await setContentSaved(reader, { entityType: "ARTICLE", entityId: live.id, isSaved: true });
    expect(await getSavedIds(reader, "ARTICLE", [live.id])).toEqual([live.id]);
    expect(await getSavedIds(other, "ARTICLE", [live.id])).toEqual([]);

    await setContentSaved(reader, { entityType: "ARTICLE", entityId: live.id, isSaved: false });
    expect(await getSavedIds(reader, "ARTICLE", [live.id])).toEqual([]);
  });
});

describe("searchable pickers", () => {
  it("hides unpublished titles from staff who can't view everything", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const contributor = await createActor(prisma, "CONTRIBUTOR");
    const live = await publishedArticle(admin, { title: "منشور" });
    const draft = await createArticle(admin, input({ title: "سري" }));

    expect((await searchPicker(contributor, { type: "ARTICLE" })).map((row) => row.id)).toEqual([live.id]);
    expect((await searchPicker(admin, { type: "ARTICLE" })).map((row) => row.id).sort()).toEqual([live.id, draft.id].sort());
  });

  it("searches with spelling variants and never treats input as a pattern", async () => {
    const admin = await createActor(prisma, "ADMIN");
    await publishedArticle(admin, { title: "إعجاز القرآن" });
    expect(await searchPicker(admin, { type: "ARTICLE", query: "اعجاز" })).toHaveLength(1);
    expect(await searchPicker(admin, { type: "ARTICLE", query: "(.*" })).toHaveLength(1);
    expect(await searchPicker(admin, { type: "ARTICLE", query: "لا يوجد" })).toHaveLength(0);
  });

  it("credits YouTube on video results", async () => {
    const admin = await createActor(prisma, "ADMIN");
    await createVideo({ title: "مقطع", titleSearch: "مقطع", channelTitle: "قناة" });
    const [result] = await searchPicker(admin, { type: "VIDEO", query: "مقطع" });
    expect(result!.hint).toContain("YouTube");
  });

  it("limits staff lookups to people who can assign, and excludes non-staff", async () => {
    const editor = await createActor(prisma, "EDITOR");
    const contributor = await createActor(prisma, "CONTRIBUTOR");
    const reader = await createActor(prisma, "USER");

    expect(await codeOf(searchPicker(contributor, { type: "STAFF" }))).toBe("FORBIDDEN");
    const staff = await searchPicker(editor, { type: "STAFF" });
    expect(staff.map((row) => row.id)).toContain(contributor.id);
    expect(staff.map((row) => row.id)).not.toContain(reader.id);
  });

  it("refuses non-staff entirely", async () => {
    expect(await codeOf(searchPicker(await createActor(prisma, "USER"), { type: "ARTICLE" }))).toBe("FORBIDDEN");
    expect(await codeOf(searchPicker(null, { type: "ARTICLE" }))).toBe("UNAUTHENTICATED");
  });
});

describe("video CTAs", () => {
  const cardFor = async (id: string) => {
    const rows = await prisma.video.findMany({ where: { id }, select: videoCardSelect });
    return (await toVideoCards(rows))[0]!;
  };

  it("lead to a published article or topic, and disappear when it's hidden", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const article = await publishedArticle(admin, { title: "مقال الزر" });
    const topic = await publishedTopic();
    const toArticle = await createVideo({ cta: { type: "INTERNAL_ARTICLE", targetId: article.id } });
    const toTopic = await createVideo({ cta: { type: "TOPIC", targetId: topic.id, label: "استكشف" } });

    expect((await cardFor(toArticle.id)).cta).toEqual({ type: "INTERNAL_ARTICLE", label: null, href: `/articles/${encodeURIComponent(article.slug)}`, isExternal: false });
    expect((await cardFor(toTopic.id)).cta?.label).toBe("استكشف");

    await setArticlePublished(admin, article.id, false);
    expect((await cardFor(toArticle.id)).cta).toBeNull();
  });
});
