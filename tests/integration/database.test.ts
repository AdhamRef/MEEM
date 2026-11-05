import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { isUniqueConstraintError } from "@/lib/errors";
import { ensureMongoIndexes, listIndexNames } from "@/lib/prisma/ensure-indexes";
import { mongoIndexes } from "../../prisma/mongo-indexes";
import { clearDatabase, createTestClient } from "./helpers";

const prisma = createTestClient();

const videoData = (youtubeVideoId: string) => ({
  youtubeVideoId,
  kind: "SHORT" as const,
  classification: "SHORT_CANDIDATE" as const,
  title: "عنوان",
  feedKey: 1,
});

beforeEach(() => clearDatabase(prisma));
afterAll(() => prisma.$disconnect());

describe("MongoDB through Prisma", () => {
  it("commits a transaction, which requires a replica set", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.category.create({ data: { title: "العقيدة", slug: "العقيدة" } });
      await tx.category.create({ data: { title: "الفقه", slug: "الفقه" } });
    });
    expect(await prisma.category.count()).toBe(2);
  });

  it("rolls back every write when a transaction fails", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.category.create({ data: { title: "العقيدة", slug: "العقيدة" } });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await prisma.category.count()).toBe(0);
  });

  it("rejects a duplicate YouTube video ID with a recognisable error", async () => {
    await prisma.video.create({ data: videoData("abc123DEF45") });
    const error = await prisma.video.create({ data: videoData("abc123DEF45") }).catch((e: unknown) => e);
    expect(isUniqueConstraintError(error)).toBe(true);
    expect(await prisma.video.count()).toBe(1);
  });

  it("prevents duplicate join records", async () => {
    const video = await prisma.video.create({ data: videoData("abc123DEF45") });
    const topic = await prisma.topic.create({ data: { title: "الصلاة", slug: "الصلاة" } });
    const link = { videoId: video.id, topicId: topic.id };
    await prisma.videoTopic.create({ data: link });
    const error = await prisma.videoTopic.create({ data: link }).catch((e: unknown) => e);
    expect(isUniqueConstraintError(error)).toBe(true);
  });

  it("allows many curated playlists with no YouTube ID, and no duplicate YouTube playlists", async () => {
    const curated = (n: number) => ({
      type: "CURATED" as const,
      title: `قائمة ${n}`,
      slug: `قائمة-${n}`,
      sourceKey: `cur:${n}`,
    });
    await prisma.playlist.create({ data: curated(1) });
    await prisma.playlist.create({ data: curated(2) });
    expect(await prisma.playlist.count()).toBe(2);

    const youtube = (slug: string) => ({
      type: "YOUTUBE" as const,
      title: "قائمة يوتيوب",
      slug,
      sourceKey: "yt:PL123",
      youtubePlaylistId: "PL123",
    });
    await prisma.playlist.create({ data: youtube("a") });
    const error = await prisma.playlist.create({ data: youtube("b") }).catch((e: unknown) => e);
    expect(isUniqueConstraintError(error)).toBe(true);
  });

  it("stores Arabic slugs and finds them exactly", async () => {
    await prisma.topic.create({ data: { title: "أدلة وجود الله", slug: "أدلة-وجود-الله" } });
    expect(await prisma.topic.findUnique({ where: { slug: "أدلة-وجود-الله" } })).not.toBeNull();
  });

  it("matches default required flags in queries, so soft-delete filtering is safe", async () => {
    await prisma.video.create({ data: videoData("abc123DEF45") });
    expect(await prisma.video.count({ where: { isArchived: false } })).toBe(1);
  });

  it("removes join records when their parent is deleted", async () => {
    const video = await prisma.video.create({ data: videoData("abc123DEF45") });
    const topic = await prisma.topic.create({ data: { title: "الصلاة", slug: "الصلاة" } });
    await prisma.videoTopic.create({ data: { videoId: video.id, topicId: topic.id } });
    await prisma.video.delete({ where: { id: video.id } });
    expect(await prisma.videoTopic.count()).toBe(0);
    expect(await prisma.topic.count()).toBe(1);
  });
});

describe("script-managed indexes", () => {
  it("creates every text and TTL index", async () => {
    await ensureMongoIndexes(prisma);
    for (const index of mongoIndexes) {
      expect(await listIndexNames(prisma, index.collection)).toContain(index.name);
    }
  });

  it("is idempotent", async () => {
    await ensureMongoIndexes(prisma);
    const before = await listIndexNames(prisma, "Video");
    await ensureMongoIndexes(prisma);
    expect(await listIndexNames(prisma, "Video")).toEqual(before);
  });

  // Records a real Prisma behaviour: db push removes indexes the schema doesn't declare.
  // This is why `npm run db:sync` is the only supported way to push. If this test starts
  // failing after a Prisma upgrade, that restriction may no longer be needed.
  it("loses text and TTL indexes on prisma db push, and recreating them restores every one", async () => {
    await ensureMongoIndexes(prisma);
    execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], {
      env: process.env,
      stdio: "pipe",
    });

    // It leaves unique indexes alone, even ones the schema does not declare.
    for (const index of mongoIndexes.filter((candidate) => !candidate.options?.unique)) {
      expect(await listIndexNames(prisma, index.collection)).not.toContain(index.name);
    }

    await ensureMongoIndexes(prisma);
    for (const index of mongoIndexes) {
      expect(await listIndexNames(prisma, index.collection)).toContain(index.name);
    }
  });

  it("keeps schema-declared unique indexes through db push", async () => {
    execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], {
      env: process.env,
      stdio: "pipe",
    });
    await prisma.video.create({ data: videoData("abc123DEF45") });
    const error = await prisma.video.create({ data: videoData("abc123DEF45") }).catch((e: unknown) => e);
    expect(isUniqueConstraintError(error)).toBe(true);
  });

  it("supports the text-search query the search service will use", async () => {
    await ensureMongoIndexes(prisma);
    await prisma.video.create({ data: { ...videoData("abc123DEF45"), searchText: "اركان الصلاه صلاه" } });
    await prisma.video.create({ data: { ...videoData("xyz123DEF45"), searchText: "مشكله الشر" } });

    const result = (await prisma.video.findRaw({
      filter: { $text: { $search: "صلاه" } },
    })) as unknown as { youtubeVideoId: string }[];

    expect(result.map((video) => video.youtubeVideoId)).toEqual(["abc123DEF45"]);
  });
});
