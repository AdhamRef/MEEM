import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCategory, listActiveCategories, setCategoryActive, updateCategory } from "@/features/categories/categories.service";
import { SEED_CATEGORIES, seedTaxonomy } from "@/features/categories/seed-taxonomy";
import { createTopic, getPublishedTopicBySlug, listPublishedTopics, setTopicArchived, setTopicPublished, updateTopic } from "@/features/topics/topics.service";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { clearDatabase, createTestClient } from "./helpers";
import { createActor } from "./phase3-helpers";

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

describe("seedTaxonomy", () => {
  it("creates the twelve starting categories, in order, active, each with a slug and icon", async () => {
    const { created } = await seedTaxonomy(prisma);
    expect(created).toHaveLength(12);

    const categories = await listActiveCategories();
    expect(categories.map((category) => category.slug)).toEqual(SEED_CATEGORIES.map((category) => category.slug));
    expect(categories.every((category) => category.icon && category.description)).toBe(true);
  });

  it("is safe to run again and never overwrites an editor's changes", async () => {
    await seedTaxonomy(prisma);
    const fiqh = await prisma.category.findUniqueOrThrow({ where: { slug: "الفقه" } });
    await updateCategory(admin, fiqh.id, { title: "فقه العبادات" });
    await setCategoryActive(admin, (await prisma.category.findUniqueOrThrow({ where: { slug: "النبوة" } })).id, false);

    const second = await seedTaxonomy(prisma);

    expect(second).toEqual({ created: [], alreadyPresent: 12 });
    expect((await prisma.category.findUniqueOrThrow({ where: { slug: "الفقه" } })).title).toBe("فقه العبادات");
    expect((await prisma.category.findUniqueOrThrow({ where: { slug: "النبوة" } })).isActive).toBe(false);
  });

  it("gives the same result when two runs overlap", async () => {
    await Promise.all([seedTaxonomy(prisma), seedTaxonomy(prisma)]);
    expect(await prisma.category.count()).toBe(12);
  });

  it("restores only what's missing", async () => {
    await seedTaxonomy(prisma);
    await prisma.category.delete({ where: { slug: "الفقه" } });
    expect((await seedTaxonomy(prisma)).created).toEqual(["الفقه"]);
  });
});

describe("categories", () => {
  it("derives an Arabic slug from the title", async () => {
    const category = await createCategory(admin, { title: "علوم الحديث" });
    expect(category.slug).toBe("علوم-الحديث");
  });

  it("rejects a duplicate slug as a conflict, not a server error", async () => {
    await createCategory(admin, { title: "الفقه" });
    expect(await errorCodeOf(createCategory(admin, { title: "الفقه" }))).toBe("CONFLICT");
  });

  it.each([
    ["an empty title", { title: "  " }],
    ["a title with nothing usable for a slug", { title: "!!!" }],
    ["a bad slug", { title: "x", slug: "not a slug" }],
    ["an icon outside the list", { title: "x", icon: "skull" }],
    ["an unknown field", { title: "x", isActive: false }],
    ["a malformed parent", { title: "x", parentId: "nope" }],
    ["a parent that doesn't exist", { title: "x", parentId: MISSING_ID }],
  ])("rejects %s", async (_name, input) => {
    expect(await errorCodeOf(createCategory(admin, input))).toBe("VALIDATION");
  });

  it("supports a hierarchy, but no cycles", async () => {
    const parent = await createCategory(admin, { title: "الأب" });
    const child = await createCategory(admin, { title: "الابن", parentId: parent.id });
    const grandchild = await createCategory(admin, { title: "الحفيد", parentId: child.id });

    expect(await errorCodeOf(updateCategory(admin, parent.id, { parentId: parent.id }))).toBe("VALIDATION");
    expect(await errorCodeOf(updateCategory(admin, parent.id, { parentId: grandchild.id }))).toBe("VALIDATION");
  });

  it("hides inactive categories from public lists and shows them again when reactivated", async () => {
    const category = await createCategory(admin, { title: "الفقه" });
    await setCategoryActive(admin, category.id, false);
    expect(await listActiveCategories()).toEqual([]);

    await setCategoryActive(admin, category.id, true);
    expect(await listActiveCategories()).toHaveLength(1);
  });

  it("reports a missing category", async () => {
    expect(await errorCodeOf(updateCategory(admin, MISSING_ID, { title: "x" }))).toBe("NOT_FOUND");
    expect(await errorCodeOf(setCategoryActive(admin, MISSING_ID, false))).toBe("NOT_FOUND");
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

  it("rejects a category or parent that doesn't exist, and cycles", async () => {
    expect(await errorCodeOf(createTopic(admin, { title: "x", categoryId: MISSING_ID }))).toBe("VALIDATION");
    expect(await errorCodeOf(createTopic(admin, { title: "x", parentId: MISSING_ID }))).toBe("VALIDATION");

    const parent = await createTopic(admin, { title: "الأب" });
    const child = await createTopic(admin, { title: "الابن", parentId: parent.id });
    expect(await errorCodeOf(updateTopic(admin, parent.id, { parentId: child.id }))).toBe("VALIDATION");
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
