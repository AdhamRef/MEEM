import type { ContentType, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setArticleFeatured } from "@/features/articles/articles.service";
import {
  addCollectionItem,
  createCollection,
  deleteCollection,
  getCollectionForEditing,
  listExploreCollections,
  MAX_COLLECTION_ITEMS,
  removeCollectionItem,
  reorderCollectionItems,
  setCollectionArchived,
  setCollectionPublished,
} from "@/features/collections/collections.service";
import { summarizeContent } from "@/features/content/describe";
import type { ResolvedContent } from "@/features/content/resolve";
import { getExploreSections, listExploreVideos, listPopularContent, listTopicsForInterests, POPULAR_MIN_ITEMS, POPULAR_MIN_VIEWERS } from "@/features/explore/explore.service";
import { getSavedIds, setContentSaved } from "@/features/favorites/favorites.service";
import { searchContent, suggestContent, type SearchGroup, type SearchResult, type SearchType } from "@/features/search/search.service";
import { clearHistory, listContinueWatching, listHistory, listSavedContent, recordContentView, removeFromHistory } from "@/features/users/library.service";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { ensureMongoIndexes } from "@/lib/prisma/ensure-indexes";
import { buildSearchText, normalizeArabicForSearch } from "@/lib/search/normalize";
import { clearDatabase, createTestClient } from "./helpers";
import { createActor } from "./phase3-helpers";

process.env.APP_URL = "http://localhost:3000";

let prisma: PrismaClient;
let admin: Actor;
let editor: Actor;
let contributor: Actor;
let reader: Actor;
let other: Actor;
let counter = 0;

async function codeOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
}

const next = () => (counter += 1);
const search = (title: string, ...more: (string | null | undefined)[]) => ({ titleSearch: normalizeArabicForSearch(title), searchText: buildSearchText([title, ...more]) });
const live = { status: "PUBLISHED" as const, publishedAt: new Date() };

async function seedVideo(title: string, overrides: Record<string, unknown> & { description?: string; tags?: string[]; channelTitle?: string } = {}) {
  const id = next();
  return prisma.video.create({
    data: {
      youtubeVideoId: `v${String(id).padStart(10, "0")}`,
      kind: "SHORT",
      classification: "SHORT_CANDIDATE",
      reviewedAt: new Date(),
      ...live,
      availability: "AVAILABLE",
      title,
      channelTitle: "قناة",
      thumbnails: [{ quality: "high", url: "https://i.ytimg.com/vi/x/hqdefault.jpg" }],
      durationSeconds: 60,
      metadataFetchedAt: new Date(),
      feedKey: id,
      ...search(title, overrides.description, ...(overrides.tags ?? [])),
      ...overrides,
    },
  });
}

async function seedArticle(title: string, overrides: Record<string, unknown> & { excerpt?: string } = {}) {
  const id = next();
  return prisma.article.create({ data: { title, slug: `article-${id}`, body: { type: "doc", content: [] }, readingMinutes: 1, ...live, ...search(title, overrides.excerpt), ...overrides } });
}

async function seedTopic(title: string, overrides: Record<string, unknown> & { introduction?: string } = {}) {
  const id = next();
  return prisma.topic.create({ data: { title, slug: `topic-${id}`, ...live, ...search(title, overrides.introduction), ...overrides } });
}

async function seedLibrary(name: string, overrides: Record<string, unknown> = {}) {
  const id = next();
  return prisma.library.create({ data: { name, slug: `library-${id}`, ...live, ...search(name), ...overrides } });
}

async function seedPlaylist(title: string, overrides: Record<string, unknown> = {}) {
  const id = next();
  return prisma.playlist.create({ data: { type: "CURATED", title, slug: `playlist-${id}`, sourceKey: `cur:${id}`, ...live, ...search(title), ...overrides } });
}

async function seedResource(title: string, overrides: Record<string, unknown> = {}) {
  const id = next();
  return prisma.externalResource.create({ data: { title, slug: `resource-${id}`, sourceName: "مصدر", url: `https://example.com/${id}`, ...live, ...search(title), ...overrides } });
}

const seedCategory = (title: string, isActive = true) => prisma.category.create({ data: { title, slug: `category-${next()}`, isActive } });

const titlesOf = (group: SearchGroup | undefined) => (group?.items ?? []).map((item) => summarizeContent(item).title);
function groupOf(result: SearchResult, type: SearchType): SearchGroup | undefined {
  if (result.status === "OVERVIEW") return result.groups.find((group) => group.type === type);
  if (result.status === "TYPE") return result.group;
  return undefined;
}
const titlesFound = async (query: string, type: SearchType, extra: Record<string, unknown> = {}) => titlesOf(groupOf(await searchContent({ query, type, ...extra }), type));

beforeAll(async () => {
  prisma = createTestClient();
  await ensureMongoIndexes(prisma);
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clearDatabase(prisma);
  counter = 0;
  admin = await createActor(prisma, "ADMIN");
  editor = await createActor(prisma, "EDITOR");
  contributor = await createActor(prisma, "CONTRIBUTOR");
  reader = await createActor(prisma, "USER");
  other = await createActor(prisma, "USER");
});

describe("search across all content types", () => {
  it("finds each of the six required types, and external resources, labelled by type", async () => {
    await seedTopic("أحكام الصلاة");
    await seedVideo("فضل الصلاة في وقتها");
    await seedVideo("شرح الصلاة كاملًا", { kind: "LONG_FORM", classification: "LONG_FORM_CANDIDATE", durationSeconds: 900 });
    await seedArticle("مقال عن الصلاة");
    await seedPlaylist("سلسلة الصلاة");
    await seedLibrary("مكتبة الصلاة");
    await seedResource("كتاب الصلاة");
    await seedArticle("مقال عن الزكاة");

    const result = await searchContent({ query: "الصلاة" });
    expect(result.status).toBe("OVERVIEW");
    if (result.status !== "OVERVIEW") return;
    expect(result.groups.map((group) => group.type).sort()).toEqual(["ARTICLE", "LIBRARY", "LONG_VIDEO", "PLAYLIST", "RESOURCE", "SHORT", "TOPIC"].sort());
    expect(titlesOf(groupOf(result, "SHORT"))).toEqual(["فضل الصلاة في وقتها"]);
    expect(titlesOf(groupOf(result, "LONG_VIDEO"))).toEqual(["شرح الصلاة كاملًا"]);
    expect(titlesOf(groupOf(result, "ARTICLE"))).toEqual(["مقال عن الصلاة"]);
  });

  it("credits YouTube as the source of video and YouTube playlist results, and marks external resources", async () => {
    await seedVideo("درس التوحيد", { channelTitle: "قناة العلم" });
    await seedPlaylist("قائمة التوحيد", { type: "YOUTUBE", channelTitle: "قناة الدروس", youtubePlaylistId: "PLx" });
    await seedResource("موقع التوحيد");

    const result = await searchContent({ query: "التوحيد" });
    const sourceOf = (type: SearchType) => summarizeContent(groupOf(result, type)?.items[0] as ResolvedContent).source;
    expect(sourceOf("SHORT")).toContain("YouTube");
    expect(sourceOf("SHORT")).toContain("قناة العلم");
    expect(sourceOf("PLAYLIST")).toContain("YouTube");
    expect(sourceOf("RESOURCE")).toContain("مصدر خارجي");
  });

  it.each([
    ["صلاة", "الصلاة"],
    ["الصلاه", "صلاة"],
    ["اسلام", "الإسلام"],
    ["القران", "القرآن"],
    ["مُحَمَّد", "محمد"],
    ["موسى", "موسي"],
  ])("Arabic variants: %s finds a title containing %s", async (query, inTitle) => {
    await seedArticle(`مقدمة ${inTitle} للمبتدئين`);
    await seedArticle("عنوان آخر تمامًا");
    expect(await titlesFound(query, "ARTICLE")).toEqual([`مقدمة ${inTitle} للمبتدئين`]);
  });

  it("searches descriptions and tags", async () => {
    await seedVideo("مقطع أول", { description: "نتحدث هنا عن الصبر" });
    await seedVideo("مقطع ثان", { tags: ["الشكر"] });
    expect(await titlesFound("الصبر", "SHORT")).toEqual(["مقطع أول"]);
    expect(await titlesFound("الشكر", "SHORT")).toEqual(["مقطع ثان"]);
  });

  it("ranks a title match above a passing mention", async () => {
    await seedArticle("الصيام والحياة", { excerpt: "نتحدث هنا عن كلمات كثيرة وعن الزكاة أيضًا" });
    await seedArticle("الزكاة");
    expect((await titlesFound("الزكاة", "ARTICLE"))[0]).toBe("الزكاة");
  });

  it("finds content through a topic's name, even if it doesn't repeat it", async () => {
    const topic = await seedTopic("الميراث");
    const video = await seedVideo("مقطع بلا الكلمة", { topicIds: [topic.id] });
    await prisma.videoTopic.create({ data: { videoId: video.id, topicId: topic.id } });
    const article = await seedArticle("مقال بلا الكلمة");
    await prisma.articleTopic.create({ data: { articleId: article.id, topicId: topic.id } });
    const playlist = await seedPlaylist("قائمة بلا الكلمة");
    await prisma.playlistTopic.create({ data: { playlistId: playlist.id, topicId: topic.id } });
    await seedVideo("مقطع لا علاقة له");

    expect(await titlesFound("ميراث", "SHORT")).toEqual(["مقطع بلا الكلمة"]);
    expect(await titlesFound("ميراث", "ARTICLE")).toEqual(["مقال بلا الكلمة"]);
    expect(await titlesFound("ميراث", "PLAYLIST")).toEqual(["قائمة بلا الكلمة"]);
  });

  it("doesn't pull in content of a topic that only mentions the word in passing", async () => {
    const topic = await seedTopic("السيرة", { introduction: "فيها ذكر الميراث" });
    await seedVideo("مقطع السيرة", { topicIds: [topic.id] });
    expect(await titlesFound("الميراث", "SHORT")).toEqual([]);
    expect(await titlesFound("الميراث", "TOPIC")).toEqual(["السيرة"]);
  });

  it("finds content through a category's name, with direct matches first", async () => {
    const category = await seedCategory("الفقه");
    await seedArticle("مقال في الطهارة", { categoryId: category.id });
    await seedArticle("مدخل إلى الفقه");
    const titles = await titlesFound("الفقه", "ARTICLE");
    expect(titles).toEqual(["مدخل إلى الفقه", "مقال في الطهارة"]);
  });

  it("filters by category", async () => {
    const fiqh = await seedCategory("الفقه");
    const history = await seedCategory("التاريخ");
    await seedArticle("الصلاة في الفقه", { categoryId: fiqh.id });
    await seedArticle("الصلاة في التاريخ", { categoryId: history.id });

    expect(await titlesFound("الصلاة", "ARTICLE", { categoryId: fiqh.id })).toEqual(["الصلاة في الفقه"]);
  });

  it("leaves types without categories out when a category is chosen", async () => {
    const fiqh = await seedCategory("الفقه");
    await seedArticle("الصلاة", { categoryId: fiqh.id });
    await seedLibrary("مكتبة الصلاة");

    const result = await searchContent({ query: "الصلاة", categoryId: fiqh.id });
    expect(result.status === "OVERVIEW" && result.groups.map((group) => group.type)).toEqual(["ARTICLE"]);
    expect(await titlesFound("الصلاة", "LIBRARY", { categoryId: fiqh.id })).toEqual([]);
  });

  it("never shows drafts, archived, or withdrawn content", async () => {
    await seedArticle("الزكاة مسودة", { status: "DRAFT" });
    await seedArticle("الزكاة مؤرشفة", { isArchived: true });
    await seedVideo("الزكاة محذوف من يوتيوب", { availability: "UNKNOWN" });
    await seedVideo("الزكاة مسودة", { status: "DRAFT" });
    await seedTopic("الزكاة مسودة", { status: "DRAFT" });
    await seedPlaylist("الزكاة", { title: "", ...search("الزكاة") });

    const result = await searchContent({ query: "الزكاة" });
    expect(result.status === "OVERVIEW" && result.groups).toEqual([]);
  });

  it("doesn't show draft content through a topic's name either", async () => {
    const topic = await seedTopic("الميراث");
    await seedVideo("مسودة", { status: "DRAFT", topicIds: [topic.id] });
    const draft = await seedArticle("مسودة", { status: "DRAFT" });
    await prisma.articleTopic.create({ data: { articleId: draft.id, topicId: topic.id } });
    expect(await titlesFound("الميراث", "SHORT")).toEqual([]);
    expect(await titlesFound("الميراث", "ARTICLE")).toEqual([]);
  });

  it("pages through results with no repeats or gaps", async () => {
    for (let index = 0; index < 30; index += 1) await seedArticle(`الحج ${index}`);

    const seen: string[] = [];
    let page = 1;
    for (;;) {
      const result = await searchContent({ query: "الحج", type: "ARTICLE", page });
      if (result.status !== "TYPE") throw new Error("Expected a type result");
      seen.push(...titlesOf(result.group));
      if (!result.group.hasMore) break;
      page += 1;
    }
    expect(page).toBe(3);
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
  });

  it("limits the overview and says when more exists", async () => {
    for (let index = 0; index < 8; index += 1) await seedArticle(`الحج ${index}`);
    const group = groupOf(await searchContent({ query: "الحج" }), "ARTICLE");
    expect(group?.items).toHaveLength(6);
    expect(group?.hasMore).toBe(true);
  });

  it("treats unusable input as an empty search, and doesn't let it reach MongoDB", async () => {
    expect((await searchContent({ query: "" })).status).toBe("EMPTY_QUERY");
    expect((await searchContent({})).status).toBe("EMPTY_QUERY");
    expect((await searchContent({ query: "!" })).status).toBe("EMPTY_QUERY");
    expect((await searchContent({ query: "x".repeat(500) })).status).toBe("EMPTY_QUERY");
    expect((await searchContent({ query: { $ne: "" } })).status).toBe("EMPTY_QUERY");
    expect((await searchContent({ query: "الصلاة", type: "HACK", categoryId: "not-an-id", page: "-3" })).status).toBe("OVERVIEW");
  });

  it("treats a search operator as plain text", async () => {
    await seedArticle("الزكاة");
    expect(await titlesFound('-الزكاة "', "ARTICLE")).toEqual(["الزكاة"]);
  });

  it("uses the real text index, weighted toward titles", async () => {
    const indexes = (await prisma.$runCommandRaw({ listIndexes: "Article" })) as { cursor: { firstBatch: { name: string; weights?: Record<string, number> }[] } };
    expect(indexes.cursor.firstBatch.find((index) => index.name === "Article_searchText_text")?.weights).toEqual({ titleSearch: 5, searchText: 1 });
  });
});

describe("search suggestions", () => {
  it("offers titles that begin with what's typed, with or without the article", async () => {
    await seedTopic("الصيام");
    await seedArticle("صيام التطوع");
    await seedVideo("صيام رمضان");
    await seedArticle("لا علاقة");

    const labels = (await suggestContent("صيا")).map((suggestion) => suggestion.label);
    expect(labels.sort()).toEqual(["الصيام", "صيام التطوع", "صيام رمضان"].sort());
  });

  it("credits YouTube on video suggestions, and links each to its page", async () => {
    const video = await seedVideo("صيام رمضان");
    const topic = await seedTopic("صيام النوافل");

    const suggestions = await suggestContent("صيام");
    expect(suggestions.find((item) => item.id === video.id)).toMatchObject({ href: `/shorts/${video.id}` });
    expect(suggestions.find((item) => item.id === video.id)?.hint).toContain("YouTube");
    expect(suggestions.find((item) => item.id === topic.id)?.href).toBe(`/topics/${topic.slug}`);
  });

  it("offers nothing unpublished, and nothing for too short a query", async () => {
    await seedTopic("صيام مسودة", { status: "DRAFT" });
    await seedVideo("صيام خاص", { availability: "UNKNOWN" });
    expect(await suggestContent("صيام")).toEqual([]);
    await seedTopic("صيام");
    expect(await suggestContent("ص")).toEqual([]);
    expect(await suggestContent({ $ne: "" })).toEqual([]);
  });

  it("treats a regular expression as plain text", async () => {
    await seedTopic("صيام");
    expect(await suggestContent(".*")).toEqual([]);
  });
});

describe("saved content", () => {
  it("saves all four types, across sessions, with no duplicates, newest first", async () => {
    const video = await seedVideo("مقطع");
    const article = await seedArticle("مقال");
    const topic = await seedTopic("موضوع");
    const playlist = await seedPlaylist("قائمة");

    for (const [entityType, entityId] of [["VIDEO", video.id], ["ARTICLE", article.id], ["TOPIC", topic.id], ["PLAYLIST", playlist.id], ["ARTICLE", article.id]] as const) {
      await setContentSaved(reader, { entityType, entityId, isSaved: true });
    }

    const page = await listSavedContent(reader);
    expect(page.items).toHaveLength(4);
    expect(page.items.map((entry) => entry.entityType).sort()).toEqual(["ARTICLE", "PLAYLIST", "TOPIC", "VIDEO"]);
    expect(await getSavedIds(reader, "TOPIC", [topic.id])).toEqual([topic.id]);
    expect(await getSavedIds(reader, "PLAYLIST", [playlist.id])).toEqual([playlist.id]);
  });

  it("filters by type and pages without repeats", async () => {
    for (let index = 0; index < 25; index += 1) {
      const article = await seedArticle(`مقال ${index}`);
      await setContentSaved(reader, { entityType: "ARTICLE", entityId: article.id, isSaved: true });
    }
    const topic = await seedTopic("موضوع");
    await setContentSaved(reader, { entityType: "TOPIC", entityId: topic.id, isSaved: true });

    expect((await listSavedContent(reader, { type: "TOPIC" })).items).toHaveLength(1);

    const first = await listSavedContent(reader, { type: "ARTICLE" });
    const second = await listSavedContent(reader, { type: "ARTICLE", cursor: first.nextCursor });
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((entry) => entry.entityId)).size).toBe(25);
  });

  it("removes a saved item", async () => {
    const topic = await seedTopic("موضوع");
    await setContentSaved(reader, { entityType: "TOPIC", entityId: topic.id, isSaved: true });
    await setContentSaved(reader, { entityType: "TOPIC", entityId: topic.id, isSaved: false });
    expect((await listSavedContent(reader)).items).toEqual([]);
  });

  it("keeps a saved item that was unpublished, without its content, and allows removing it", async () => {
    const article = await seedArticle("مقال");
    await setContentSaved(reader, { entityType: "ARTICLE", entityId: article.id, isSaved: true });
    await prisma.article.update({ where: { id: article.id }, data: { status: "DRAFT" } });

    const [entry] = (await listSavedContent(reader)).items;
    expect(entry?.content).toBeNull();
    await setContentSaved(reader, { entityType: "ARTICLE", entityId: article.id, isSaved: false });
    expect((await listSavedContent(reader)).items).toEqual([]);
  });

  it("refuses to save what isn't public, and what can't be saved", async () => {
    const draft = await seedTopic("مسودة", { status: "DRAFT" });
    const library = await seedLibrary("مكتبة");
    expect(await codeOf(setContentSaved(reader, { entityType: "TOPIC", entityId: draft.id, isSaved: true }))).toBe("NOT_FOUND");
    expect(await codeOf(setContentSaved(reader, { entityType: "LIBRARY", entityId: library.id, isSaved: true }))).toBe("VALIDATION");
  });

  it("requires signing in, and keeps each person's items their own", async () => {
    const topic = await seedTopic("موضوع");
    await setContentSaved(reader, { entityType: "TOPIC", entityId: topic.id, isSaved: true });

    expect(await codeOf(listSavedContent(null))).toBe("UNAUTHENTICATED");
    expect(await codeOf(setContentSaved(null, { entityType: "TOPIC", entityId: topic.id, isSaved: true }))).toBe("UNAUTHENTICATED");
    expect((await listSavedContent(other)).items).toEqual([]);
    expect(await getSavedIds(other, "TOPIC", [topic.id])).toEqual([]);

    // Removing "your" copy can't touch someone else's.
    await setContentSaved(other, { entityType: "TOPIC", entityId: topic.id, isSaved: false });
    expect((await listSavedContent(reader)).items).toHaveLength(1);
  });

  it("counts a saved topic as interest in its category, but only the first time", async () => {
    const category = await seedCategory("الفقه");
    const topic = await seedTopic("موضوع", { categoryId: category.id });
    await setContentSaved(reader, { entityType: "TOPIC", entityId: topic.id, isSaved: true });
    const once = await prisma.userInterest.findFirst({ where: { userId: reader.id, categoryId: category.id } });
    await setContentSaved(reader, { entityType: "TOPIC", entityId: topic.id, isSaved: true });
    const twice = await prisma.userInterest.findFirst({ where: { userId: reader.id, categoryId: category.id } });
    expect(once?.behaviourScore).toBeGreaterThan(0);
    expect(twice?.behaviourScore).toBe(once?.behaviourScore);
  });
});

describe("history", () => {
  it("lists each item once, most recent first, whichever type it is", async () => {
    const article = await seedArticle("مقال");
    const topic = await seedTopic("موضوع");
    const library = await seedLibrary("مكتبة");
    const base = Date.now();

    await recordContentView(reader, { entityType: "ARTICLE", entityId: article.id }, new Date(base));
    await recordContentView(reader, { entityType: "TOPIC", entityId: topic.id }, new Date(base + 1000));
    await recordContentView(reader, { entityType: "LIBRARY", entityId: library.id }, new Date(base + 2000));
    await recordContentView(reader, { entityType: "ARTICLE", entityId: article.id }, new Date(base + 3000));

    expect((await listHistory(reader)).items.map((entry) => entry.entityType)).toEqual(["ARTICLE", "LIBRARY", "TOPIC"]);
  });

  it("holds one record even when two first views race", async () => {
    const article = await seedArticle("مقال");
    await Promise.all(Array.from({ length: 5 }, () => recordContentView(reader, { entityType: "ARTICLE", entityId: article.id })));
    expect(await prisma.userActivity.count({ where: { userId: reader.id, action: "VIEW" } })).toBe(1);
  });

  it("gives views an expiry, and records nothing about interests", async () => {
    const category = await seedCategory("الفقه");
    const article = await seedArticle("مقال", { categoryId: category.id });
    await recordContentView(reader, { entityType: "ARTICLE", entityId: article.id });

    const activity = await prisma.userActivity.findFirst({ where: { userId: reader.id } });
    expect(activity?.expiresAt?.getTime()).toBeGreaterThan(Date.now());
    expect(await prisma.userInterest.count({ where: { userId: reader.id } })).toBe(0);
  });

  it("refuses views of what isn't public, and from guests", async () => {
    const draft = await seedArticle("مسودة", { status: "DRAFT" });
    expect(await codeOf(recordContentView(reader, { entityType: "ARTICLE", entityId: draft.id }))).toBe("NOT_FOUND");
    expect(await codeOf(recordContentView(null, { entityType: "ARTICLE", entityId: draft.id }))).toBe("UNAUTHENTICATED");
    expect(await codeOf(recordContentView(reader, { entityType: "ARTICLE", entityId: "nope" }))).toBe("VALIDATION");
  });

  it("leaves other activity alone when removing and clearing, and only touches the person's own", async () => {
    const video = await seedVideo("مقطع");
    const article = await seedArticle("مقال");
    await prisma.userActivity.create({ data: { userId: reader.id, entityType: "VIDEO", entityId: video.id, action: "COMPLETE" } });
    await recordContentView(reader, { entityType: "VIDEO", entityId: video.id });
    await recordContentView(reader, { entityType: "ARTICLE", entityId: article.id });
    await recordContentView(other, { entityType: "ARTICLE", entityId: article.id });
    await setContentSaved(reader, { entityType: "ARTICLE", entityId: article.id, isSaved: true });

    await removeFromHistory(reader, { entityType: "ARTICLE", entityId: article.id });
    expect((await listHistory(reader)).items.map((entry) => entry.entityType)).toEqual(["VIDEO"]);
    expect((await listHistory(other)).items).toHaveLength(1);

    await clearHistory(reader);
    expect((await listHistory(reader)).items).toEqual([]);
    expect((await listHistory(other)).items).toHaveLength(1);
    expect(await prisma.userActivity.count({ where: { userId: reader.id, action: "COMPLETE" } })).toBe(1);
    expect((await listSavedContent(reader)).items).toHaveLength(1);
  });

  it("forgets where a removed video stopped, and clearing forgets every position", async () => {
    const video = await seedVideo("مقطع", { kind: "LONG_FORM", classification: "LONG_FORM_CANDIDATE" });
    await prisma.viewingProgress.create({ data: { userId: reader.id, videoId: video.id, scopeKey: "video", positionSeconds: 30, durationSeconds: 100 } });
    await recordContentView(reader, { entityType: "VIDEO", entityId: video.id });

    expect(await listContinueWatching(reader)).toHaveLength(1);
    await removeFromHistory(reader, { entityType: "VIDEO", entityId: video.id });
    expect(await listContinueWatching(reader)).toEqual([]);

    await prisma.viewingProgress.create({ data: { userId: reader.id, videoId: video.id, scopeKey: "video", positionSeconds: 30 } });
    await clearHistory(reader);
    expect(await prisma.viewingProgress.count({ where: { userId: reader.id } })).toBe(0);
  });
});

describe("continue watching", () => {
  it("shows unfinished videos only, with their real progress, on the right page", async () => {
    const unfinished = await seedVideo("لم يكتمل", { kind: "LONG_FORM", classification: "LONG_FORM_CANDIDATE" });
    const finished = await seedVideo("اكتمل", { kind: "LONG_FORM", classification: "LONG_FORM_CANDIDATE" });
    const untouched = await seedVideo("لم يبدأ", { kind: "LONG_FORM", classification: "LONG_FORM_CANDIDATE" });
    await prisma.viewingProgress.create({ data: { userId: reader.id, videoId: unfinished.id, scopeKey: "video", positionSeconds: 60, durationSeconds: 600 } });
    await prisma.viewingProgress.create({ data: { userId: reader.id, videoId: finished.id, scopeKey: "video", positionSeconds: 600, durationSeconds: 600, isCompleted: true } });
    await prisma.viewingProgress.create({ data: { userId: reader.id, videoId: untouched.id, scopeKey: "video", positionSeconds: 0 } });

    const items = await listContinueWatching(reader);
    expect(items.map((item) => item.video.title)).toEqual(["لم يكتمل"]);
    expect(items[0]).toMatchObject({ positionSeconds: 60, durationSeconds: 600, href: `/videos/${unfinished.id}`, playlistTitle: null });
  });

  it("sends a video watched in a playlist back to that playlist", async () => {
    const draftItem = await seedVideo("عنصر", { status: "DRAFT", kind: "LONG_FORM", classification: "LONG_FORM_CANDIDATE" });
    const playlist = await seedPlaylist("قائمة", { type: "YOUTUBE", youtubePlaylistId: "PLy" });
    await prisma.viewingProgress.create({ data: { userId: reader.id, videoId: draftItem.id, playlistId: playlist.id, scopeKey: `playlist:${playlist.id}`, positionSeconds: 10 } });

    const [item] = await listContinueWatching(reader);
    expect(item?.href).toBe(`/playlists/${playlist.slug}`);
    expect(item?.playlistTitle).toBe("قائمة");
  });

  it("leaves out what's no longer public, and other people's progress", async () => {
    const withdrawn = await seedVideo("سحب", { availability: "UNKNOWN", kind: "LONG_FORM", classification: "LONG_FORM_CANDIDATE" });
    const hiddenList = await seedPlaylist("مخفية", { status: "DRAFT" });
    const video = await seedVideo("مقطع", { status: "DRAFT", kind: "LONG_FORM", classification: "LONG_FORM_CANDIDATE" });
    await prisma.viewingProgress.create({ data: { userId: reader.id, videoId: withdrawn.id, scopeKey: "video", positionSeconds: 10 } });
    await prisma.viewingProgress.create({ data: { userId: reader.id, videoId: video.id, playlistId: hiddenList.id, scopeKey: `playlist:${hiddenList.id}`, positionSeconds: 10 } });
    await prisma.viewingProgress.create({ data: { userId: other.id, videoId: withdrawn.id, scopeKey: "video", positionSeconds: 10 } });

    expect(await listContinueWatching(reader)).toEqual([]);
    expect(await codeOf(listContinueWatching(null))).toBe("UNAUTHENTICATED");
  });
});

describe("explore", () => {
  it("shows only what editors chose in the chosen sections, and only public content", async () => {
    const picked = await seedArticle("مختار");
    await seedArticle("عادي");
    await seedArticle("مختار مسودة", { status: "DRAFT", isFeatured: true });
    await setArticleFeatured(editor, picked.id, true);
    const topic = await seedTopic("موضوع مميز", { isFeatured: true });
    await seedTopic("مسودة مميزة", { isFeatured: true, status: "DRAFT" });
    await seedPlaylist("قائمة مميزة", { isFeatured: true });
    await seedPlaylist("قائمة عادية");

    const sections = await getExploreSections();
    expect(sections.articles.map((article) => article.id)).toEqual([picked.id]);
    expect(sections.featuredTopics.map((row) => row.id)).toEqual([topic.id]);
    expect(sections.playlists.map((row) => row.title)).toEqual(["قائمة مميزة"]);
  });

  it("shows new content across types, newest first, without repeating featured topics below", async () => {
    await seedArticle("أقدم", { publishedAt: new Date(Date.UTC(2000, 0, 1)) });
    await seedArticle("أحدث");
    await seedVideo("مقطع جديد");
    await seedVideo("درس جديد", { kind: "LONG_FORM", classification: "LONG_FORM_CANDIDATE" });
    const featured = await seedTopic("مميز", { isFeatured: true });
    const plain = await seedTopic("عادي");

    const { newContent, updatedTopics } = await getExploreSections();
    expect(newContent.articles.map((article) => article.title)).toEqual(["أحدث", "أقدم"]);
    expect(newContent.shorts.map((video) => video.title)).toEqual(["مقطع جديد"]);
    expect(newContent.longVideos.map((video) => video.title)).toEqual(["درس جديد"]);
    expect(updatedTopics.map((topic) => topic.id)).toEqual([plain.id]);
    expect(updatedTopics.map((topic) => topic.id)).not.toContain(featured.id);
  });

  it("recommends topics only from categories the person chose", async () => {
    const chosen = await seedCategory("الفقه");
    const notChosen = await seedCategory("التاريخ");
    await seedTopic("في الفقه", { categoryId: chosen.id });
    await seedTopic("في التاريخ", { categoryId: notChosen.id });
    await seedTopic("فقه مسودة", { categoryId: chosen.id, status: "DRAFT" });

    expect((await listTopicsForInterests([chosen.id])).map((topic) => topic.title)).toEqual(["في الفقه"]);
    expect(await listTopicsForInterests([])).toEqual([]);
    expect(await listTopicsForInterests(["not-an-id"])).toEqual([]);
  });
});

describe("popular content", () => {
  async function viewedBy(entityType: ContentType, entityId: string, people: number, occurredAt = new Date()) {
    for (let index = 0; index < people; index += 1) {
      const user = await prisma.user.create({ data: { email: `viewer-${next()}@example.com` } });
      await prisma.userActivity.create({ data: { userId: user.id, entityType, entityId, action: "VIEW", occurredAt } });
    }
  }

  it("stays hidden with too little data, rather than showing thin numbers", async () => {
    const article = await seedArticle("مقال");
    await viewedBy("ARTICLE", article.id, POPULAR_MIN_VIEWERS - 1);
    expect(await listPopularContent()).toEqual([]);

    await viewedBy("ARTICLE", article.id, 1);
    expect(await listPopularContent()).toEqual([]);
  }, 60_000);

  it("orders by how many people opened something, ignoring old views and drafts", async () => {
    const most = await seedArticle("الأكثر");
    const middle = await seedTopic("أوسط");
    const least = await seedPlaylist("الأقل");
    const old = await seedArticle("قديم");
    const draft = await seedArticle("مسودة", { status: "DRAFT" });
    expect(POPULAR_MIN_ITEMS).toBe(3);

    await viewedBy("ARTICLE", most.id, 7);
    await viewedBy("TOPIC", middle.id, 6);
    await viewedBy("PLAYLIST", least.id, 5);
    await viewedBy("ARTICLE", old.id, 8, new Date(Date.now() - 40 * 86_400_000));
    await viewedBy("ARTICLE", draft.id, 9);

    const titles = (await listPopularContent()).map((item) => summarizeContent(item).title);
    expect(titles).toEqual(["الأكثر", "أوسط", "الأقل"]);
  }, 120_000);

  it("counts YouTube's statistics for nothing", async () => {
    await seedVideo("ملايين المشاهدات", { stats: { viewCount: 99_000_000n, fetchedAt: new Date() } });
    expect(await listPopularContent()).toEqual([]);
  });
});

describe("collections", () => {
  async function publishedWith(...items: { entityType: "TOPIC" | "ARTICLE" | "VIDEO" | "PLAYLIST" | "LIBRARY" | "RESOURCE"; entityId: string }[]) {
    const collection = await createCollection(editor, { title: `مجموعة ${next()}` });
    for (const item of items) await addCollectionItem(editor, { collectionId: collection.id, ...item });
    await setCollectionPublished(admin, collection.id, true);
    return collection;
  }

  it("shows a published collection's public items, in order, across types", async () => {
    const topic = await seedTopic("موضوع");
    const article = await seedArticle("مقال");
    const library = await seedLibrary("مكتبة");
    const draft = await seedArticle("مسودة", { status: "DRAFT" });
    const collection = await publishedWith({ entityType: "ARTICLE", entityId: article.id }, { entityType: "TOPIC", entityId: topic.id }, { entityType: "ARTICLE", entityId: draft.id }, { entityType: "LIBRARY", entityId: library.id });

    const [shown] = await listExploreCollections();
    expect(shown?.id).toBe(collection.id);
    expect(shown?.items.map((item) => summarizeContent(item).title)).toEqual(["مقال", "موضوع", "مكتبة"]);
  });

  it("hides drafts, archived collections, and any with nothing public in them", async () => {
    const article = await seedArticle("مقال");
    const draftCollection = await createCollection(editor, { title: "مسودة" });
    await addCollectionItem(editor, { collectionId: draftCollection.id, entityType: "ARTICLE", entityId: article.id });
    const archived = await publishedWith({ entityType: "ARTICLE", entityId: article.id });
    await setCollectionArchived(admin, archived.id, true);
    await publishedWith();

    expect(await listExploreCollections()).toEqual([]);
  });

  it("reorders, removes, refuses duplicates, and enforces the limit", async () => {
    const collection = await createCollection(editor, { title: "مجموعة" });
    const articles = await Promise.all(Array.from({ length: MAX_COLLECTION_ITEMS + 1 }, (_, index) => seedArticle(`مقال ${index}`)));
    for (const article of articles.slice(0, MAX_COLLECTION_ITEMS)) await addCollectionItem(editor, { collectionId: collection.id, entityType: "ARTICLE", entityId: article.id });

    expect(await codeOf(addCollectionItem(editor, { collectionId: collection.id, entityType: "ARTICLE", entityId: articles.at(-1)!.id }))).toBe("CONFLICT");

    const { items } = await getCollectionForEditing(editor, collection.id);
    expect(items).toHaveLength(MAX_COLLECTION_ITEMS);
    await removeCollectionItem(editor, collection.id, items[0]!.id);
    expect(await codeOf(removeCollectionItem(editor, collection.id, items[0]!.id))).toBe("NOT_FOUND");

    const remaining = items.slice(1);
    await reorderCollectionItems(editor, collection.id, [...remaining].reverse().map((item) => item.id));
    const after = await getCollectionForEditing(editor, collection.id);
    expect(after.items.map((item) => item.id)).toEqual([...remaining].reverse().map((item) => item.id));

    const duplicateTarget = articles[1]!;
    expect(await codeOf(addCollectionItem(editor, { collectionId: collection.id, entityType: "ARTICLE", entityId: duplicateTarget.id }))).toBe("CONFLICT");
    expect(await codeOf(reorderCollectionItems(editor, collection.id, [remaining[0]!.id]))).toBe("CONFLICT");
  }, 120_000);

  it("refuses items that don't exist", async () => {
    const collection = await createCollection(editor, { title: "مجموعة" });
    expect(await codeOf(addCollectionItem(editor, { collectionId: collection.id, entityType: "ARTICLE", entityId: "507f1f77bcf86cd799439011" }))).toBe("NOT_FOUND");
  });

  it("enforces permissions on the server, and audits every change", async () => {
    const article = await seedArticle("مقال");
    expect(await codeOf(createCollection(contributor, { title: "ممنوع" }))).toBe("FORBIDDEN");
    expect(await codeOf(createCollection(reader, { title: "ممنوع" }))).toBe("FORBIDDEN");
    expect(await codeOf(createCollection(null, { title: "ممنوع" }))).toBe("UNAUTHENTICATED");

    const collection = await createCollection(editor, { title: "مجموعة" });
    expect(await codeOf(addCollectionItem(contributor, { collectionId: collection.id, entityType: "ARTICLE", entityId: article.id }))).toBe("FORBIDDEN");
    expect(await codeOf(setCollectionPublished(contributor, collection.id, true))).toBe("FORBIDDEN");
    expect(await codeOf(deleteCollection(contributor, collection.id))).toBe("FORBIDDEN");

    await addCollectionItem(editor, { collectionId: collection.id, entityType: "ARTICLE", entityId: article.id });
    await setCollectionPublished(admin, collection.id, true);
    await deleteCollection(admin, collection.id);

    const actions = (await prisma.auditLog.findMany({ where: { entityType: "Collection", entityId: collection.id } })).map((log) => log.action);
    expect(actions.sort()).toEqual(["collection.create", "collection.delete", "collection.item.add", "collection.publish"]);
    expect(await prisma.collectionItem.count({ where: { collectionId: collection.id } })).toBe(0);
    expect(await prisma.article.count({ where: { id: article.id } })).toBe(1);
  });

  it("drops an item from its collection when the content is permanently deleted", async () => {
    const library = await seedLibrary("مكتبة");
    const collection = await publishedWith({ entityType: "LIBRARY", entityId: library.id });
    const { deleteLibrary } = await import("@/features/libraries/libraries.service");
    await deleteLibrary(admin, library.id);
    expect(await prisma.collectionItem.count({ where: { collectionId: collection.id } })).toBe(0);
  });
});

describe("featured articles", () => {
  it("is an editor's choice, audited", async () => {
    const article = await seedArticle("مقال");
    expect(await codeOf(setArticleFeatured(contributor, article.id, true))).toBe("FORBIDDEN");
    expect(await codeOf(setArticleFeatured(reader, article.id, true))).toBe("FORBIDDEN");
    expect(await codeOf(setArticleFeatured(editor, "507f1f77bcf86cd799439011", true))).toBe("NOT_FOUND");

    await setArticleFeatured(editor, article.id, true);
    expect((await prisma.article.findUnique({ where: { id: article.id } }))?.isFeatured).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "article.feature", entityId: article.id } })).toBe(1);
  });
});

describe("the explore video list", () => {
  async function exploreVideo(kind: "SHORT" | "LONG_FORM", categoryId: string | null, channelId: string | null, index: number) {
    return prisma.video.create({
      data: {
        youtubeVideoId: `x${kind[0]}${String(index).padStart(9, "0")}`,
        kind,
        classification: kind === "SHORT" ? "SHORT_CANDIDATE" : "LONG_FORM_CANDIDATE",
        status: "PUBLISHED",
        availability: "AVAILABLE",
        title: `مقطع ${index}`,
        feedKey: index * 1000,
        categoryId,
        channelId,
        metadataFetchedAt: new Date(),
      },
    });
  }

  it("goes through every video of a kind, once each, with no limit on how many", async () => {
    const category = await prisma.category.create({ data: { title: "أ", slug: "explore-all" } });
    const channels = await Promise.all(["1", "2", "3"].map((n) => prisma.youTubeChannel.create({ data: { youtubeChannelId: `UCx${n}`, title: n } })));
    const expected = new Set<string>();
    for (let index = 0; index < 60; index += 1) expected.add((await exploreVideo("LONG_FORM", category.id, channels[index % 3]!.id, index)).id);
    await exploreVideo("SHORT", category.id, channels[0]!.id, 100);

    const seen: string[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await listExploreVideos({ kind: "LONG_FORM", cursor, size: 24 });
      seen.push(...result.items.map((item) => item.id));
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(60);
    expect(new Set(seen)).toEqual(expected);
  });

  it("narrows to one category, and refuses bad input", async () => {
    const [first, second] = await Promise.all([prisma.category.create({ data: { title: "أ", slug: "explore-a" } }), prisma.category.create({ data: { title: "ب", slug: "explore-b" } })]);
    const inside = await exploreVideo("LONG_FORM", first.id, null, 1);
    await exploreVideo("LONG_FORM", second.id, null, 2);

    const { items } = await listExploreVideos({ kind: "LONG_FORM", categoryId: first.id, size: 24 });
    expect(items.map((item) => item.id)).toEqual([inside.id]);
    await expect(listExploreVideos({ kind: "OTHER", size: 24 })).rejects.toThrow();
    await expect(listExploreVideos({ kind: "SHORT", size: 1000 })).rejects.toThrow();
    await expect(listExploreVideos({ kind: "SHORT", categoryId: "nope", size: 24 })).rejects.toThrow();
  });
});
