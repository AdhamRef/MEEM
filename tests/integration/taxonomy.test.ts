import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getInterestCatalogue, listBrowsableTopics, listPublicTopicOptions } from "@/features/topics/catalogue.service";
import { SEED_TOPICS, seedTopics } from "@/features/topics/seed-topics";
import { createTopic, getPublishedTopicBySlug, listPublishedTopics, setTopicArchived, setTopicPublished, updateTopic } from "@/features/topics/topics.service";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { clearDatabase, createTestClient } from "./helpers";
import { createActor, createChannel, createPublishedTopic } from "./phase3-helpers";

let prisma: PrismaClient;
let admin: Actor;
const MISSING_ID = "f".repeat(24);

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
  admin = await createActor(prisma, "ADMIN");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("seedTopics", () => {
  it("creates the twelve starting topics, in order, published, each with a slug and introduction", async () => {
    const { created } = await seedTopics(prisma);
    expect(created).toHaveLength(12);

    const options = await listPublicTopicOptions();
    expect(options.map((topic) => topic.slug)).toEqual(SEED_TOPICS.map((topic) => topic.slug));

    const stored = await prisma.topic.findMany();
    expect(stored.every((topic) => topic.status === "PUBLISHED" && !topic.isArchived && topic.introduction)).toBe(true);
  });

  it("is safe to run again and never overwrites an editor's changes", async () => {
    await seedTopics(prisma);
    const fiqh = await prisma.topic.findUniqueOrThrow({ where: { slug: "الفقه" } });
    await updateTopic(admin, fiqh.id, { title: "فقه العبادات" });
    await setTopicArchived(admin, (await prisma.topic.findUniqueOrThrow({ where: { slug: "النبوة" } })).id, true);

    const second = await seedTopics(prisma);

    expect(second).toEqual({ created: [], alreadyPresent: 12 });
    expect((await prisma.topic.findUniqueOrThrow({ where: { slug: "الفقه" } })).title).toBe("فقه العبادات");
    expect((await prisma.topic.findUniqueOrThrow({ where: { slug: "النبوة" } })).isArchived).toBe(true);
  });

  it("gives the same result when two runs overlap", async () => {
    await Promise.all([seedTopics(prisma), seedTopics(prisma)]);
    expect(await prisma.topic.count()).toBe(12);
  });

  it("restores only what's missing", async () => {
    await seedTopics(prisma);
    await prisma.topic.delete({ where: { slug: "الفقه" } });
    expect((await seedTopics(prisma)).created).toEqual(["الفقه"]);
  });
});

describe("topics", () => {
  it("fills the search fields with normalised text and keeps the title as written", async () => {
    const topic = await createTopic(admin, { title: "الصَّلاة", introduction: "أحكام الطهارة" });
    expect(topic.title).toBe("الصَّلاة");
    expect(topic.titleSearch).toBe("الصلاه");
    expect(topic.searchText.split(" ")).toEqual(expect.arrayContaining(["الصلاه", "صلاه", "احكام", "الطهاره", "طهاره"]));
  });

  it("refreshes the search fields on update, keeping unchanged parts", async () => {
    const topic = await createTopic(admin, { title: "الصلاة", introduction: "الطهارة" });
    const updated = await updateTopic(admin, topic.id, { title: "الزكاة" });
    expect(updated.titleSearch).toBe("الزكاه");
    expect(updated.searchText).toContain("الزكاه");
    expect(updated.searchText).toContain("الطهاره");
    expect(updated.searchText).not.toContain("الصلاه");
  });

  it("derives an Arabic slug from the title", async () => {
    const topic = await createTopic(admin, { title: "علوم الحديث" });
    expect(topic.slug).toBe("علوم-الحديث");
  });

  it("rejects a duplicate explicit slug as a conflict, not a server error", async () => {
    await createTopic(admin, { title: "الفقه", slug: "fiqh" });
    expect(await errorCodeOf(createTopic(admin, { title: "الفقه", slug: "fiqh" }))).toBe("CONFLICT");
  });

  it.each([
    ["an empty title", { title: "  " }],
    ["a title with nothing usable for a slug", { title: "!!!" }],
    ["a bad slug", { title: "x", slug: "not a slug" }],
    ["an unknown field", { title: "x", isActive: false }],
    ["a malformed parent", { title: "x", parentId: "nope" }],
    ["a parent that doesn't exist", { title: "x", parentId: MISSING_ID }],
  ])("rejects %s", async (_name, input) => {
    expect(await errorCodeOf(createTopic(admin, input))).toBe("VALIDATION");
  });

  it("supports a hierarchy, but no cycles", async () => {
    const parent = await createTopic(admin, { title: "الأب" });
    const child = await createTopic(admin, { title: "الابن", parentId: parent.id });
    const grandchild = await createTopic(admin, { title: "الحفيد", parentId: child.id });

    expect(await errorCodeOf(updateTopic(admin, parent.id, { parentId: parent.id }))).toBe("VALIDATION");
    expect(await errorCodeOf(updateTopic(admin, parent.id, { parentId: grandchild.id }))).toBe("VALIDATION");
  });

  it("reports a missing topic", async () => {
    expect(await errorCodeOf(updateTopic(admin, MISSING_ID, { title: "x" }))).toBe("NOT_FOUND");
    expect(await errorCodeOf(setTopicArchived(admin, MISSING_ID, true))).toBe("NOT_FOUND");
  });

  it("shows only published, unarchived topics publicly", async () => {
    const topic = await createTopic(admin, { title: "الصلاة" });
    expect(await getPublishedTopicBySlug("الصلاة")).toBeNull();
    expect((await listPublishedTopics()).items).toEqual([]);

    await setTopicPublished(admin, topic.id, true);
    expect((await getPublishedTopicBySlug(encodeURIComponent("الصلاة")))?.id).toBe(topic.id);
    expect((await listPublishedTopics()).items).toHaveLength(1);

    await setTopicArchived(admin, topic.id, true);
    expect(await getPublishedTopicBySlug("الصلاة")).toBeNull();
    expect((await listPublishedTopics()).items).toEqual([]);
  });

  it("returns nothing for an unusable slug", async () => {
    expect(await getPublishedTopicBySlug("%E0%A4%A")).toBeNull();
  });

  it("pages with a cursor, with no repeats or gaps", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const topic = await createTopic(admin, { title: `موضوع ${index + 1}` });
      await setTopicPublished(admin, topic.id, true);
      ids.push(topic.id);
    }

    const first = await listPublishedTopics({ limit: 2 });
    const second = await listPublishedTopics({ limit: 2, cursor: first.nextCursor! });
    const third = await listPublishedTopics({ limit: 2, cursor: second.nextCursor! });

    const seen = [...first.items, ...second.items, ...third.items].map((topic) => topic.id);
    expect(seen).toEqual([...ids].reverse());
    expect(third.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor", async () => {
    expect(await errorCodeOf(listPublishedTopics({ cursor: "nope" }))).toBe("VALIDATION");
  });
});

describe("the topic catalogue", () => {
  async function publicVideo(channelId: string, youtubeVideoId: string) {
    return prisma.video.create({ data: { youtubeVideoId, kind: "SHORT", classification: "SHORT_CANDIDATE", status: "PUBLISHED", availability: "AVAILABLE", title: "مقطع", feedKey: 1, channelId } });
  }

  it("offers for filtering only public topics, in order", async () => {
    const [first, second] = [await createPublishedTopic(prisma), await createPublishedTopic(prisma)];
    await createPublishedTopic(prisma, { status: "DRAFT" });
    await createPublishedTopic(prisma, { isArchived: true });
    expect((await listPublicTopicOptions()).map((topic) => topic.id)).toEqual([first.id, second.id]);
  });

  it("offers for browsing videos only public topics that have a channel", async () => {
    const withChannel = await createPublishedTopic(prisma);
    await createPublishedTopic(prisma);
    const draft = await createPublishedTopic(prisma, { status: "DRAFT" });
    await createChannel(prisma, [withChannel.id, draft.id]);
    expect((await listBrowsableTopics()).map((topic) => topic.id)).toEqual([withChannel.id]);
  });

  it("offers as interests only what has something to watch, so a choice can't empty the feed", async () => {
    const watchable = await createPublishedTopic(prisma);
    const emptyChannelTopic = await createPublishedTopic(prisma);
    await createPublishedTopic(prisma);
    const draft = await createPublishedTopic(prisma, { status: "DRAFT" });

    const channel = await createChannel(prisma, [watchable.id, draft.id]);
    await publicVideo(channel.id, "catalogue01");
    await publicVideo(channel.id, "catalogue02");
    await createChannel(prisma, [emptyChannelTopic.id]);
    const withdrawn = await createChannel(prisma, [watchable.id], { title: "" });
    await publicVideo(withdrawn.id, "catalogue03");

    const { topics, channels } = await getInterestCatalogue();
    expect(topics.map((topic) => topic.id)).toEqual([watchable.id]);
    expect(topics[0]?.channelIds).toEqual([channel.id]);
    expect(channels).toEqual([expect.objectContaining({ id: channel.id, videoCount: 2, topicIds: [watchable.id] })]);
  });
});
