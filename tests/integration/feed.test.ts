import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getSavedVideoIds, setVideoSaved } from "@/features/favorites/favorites.service";
import { mergeGuestPreferences, saveInterests } from "@/features/preferences/preferences.service";
import { recordVideoSignal } from "@/features/recommendations/signals.service";
import { DEFAULT_SCORING_CONFIG } from "@/features/recommendations/scoring";
import { encodeFeedCursor } from "@/features/shorts/cursor";
import { getFeedPage, getPublicVideo } from "@/features/shorts/feed.service";
import { assignVideo, setVideoPublished } from "@/features/shorts/videos.service";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { clearDatabase, createTestClient } from "./helpers";
import { createActor } from "./phase3-helpers";

process.env.APP_URL = "http://localhost:3000";

let prisma: PrismaClient;
let counter = 0;

async function errorCodeOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : `UNEXPECTED: ${String(error)}`;
  }
}

async function category(title: string) {
  counter += 1;
  return prisma.category.create({ data: { title, slug: `c-${counter}`, displayOrder: counter } });
}

async function video(categoryId: string | null, overrides: Record<string, unknown> = {}) {
  counter += 1;
  return prisma.video.create({
    data: {
      youtubeVideoId: `v${String(counter).padStart(10, "0")}`,
      kind: "SHORT",
      classification: "SHORT_CANDIDATE",
      status: "PUBLISHED",
      availability: "AVAILABLE",
      title: `مقطع ${counter}`,
      feedKey: counter * 1000,
      categoryId,
      metadataFetchedAt: new Date(),
      ...overrides,
    },
  });
}

async function readWholeFeed(actor: Actor | null, request: Parameters<typeof getFeedPage>[1] = {}) {
  const pages = [];
  let cursor: string | null | undefined = request.cursor;
  for (let page = 0; page < 200; page += 1) {
    const result = await getFeedPage(actor, { ...request, cursor });
    pages.push(result);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return pages;
}

beforeAll(() => {
  prisma = createTestClient();
});

beforeEach(async () => {
  await clearDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the feed", () => {
  it("makes no YouTube API call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { id } = await category("أ");
    await video(id);
    await getFeedPage(null, {});
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("has no duplicates and misses nothing, across all pages, categories, and start points", async () => {
    const categories = [await category("أ"), await category("ب"), await category("ج")];
    const expected = new Set<string>();
    for (let index = 0; index < 45; index += 1) expected.add((await video(categories[index % 3]!.id)).id);

    // Random start key on each read, including ones that force wrapping around.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const pages = await readWholeFeed(null);
      const ids = pages.flatMap((page) => page.items.map((item) => item.id));
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(ids)).toEqual(expected);
    }
  });

  it("wraps around correctly from a start key in the middle", async () => {
    const { id } = await category("أ");
    const expected = new Set<string>();
    for (let index = 0; index < 20; index += 1) expected.add((await video(id, { feedKey: index * 10 })).id);

    const cursor = encodeFeedCursor({ s: 95, n: 0, o: {}, r: [] });
    const pages = await readWholeFeed(null, { cursor });
    const ids = pages.flatMap((page) => page.items.map((item) => item.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(expected);
  });

  it("handles videos with the same feed key, which is possible with random keys", async () => {
    const { id } = await category("أ");
    const expected = new Set<string>();
    for (let index = 0; index < 20; index += 1) expected.add((await video(id, { feedKey: 500 })).id);

    const pages = await readWholeFeed(null);
    const ids = pages.flatMap((page) => page.items.map((item) => item.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(expected);
  });

  it("returns a bounded page", async () => {
    const { id } = await category("أ");
    for (let index = 0; index < 30; index += 1) await video(id);
    expect((await getFeedPage(null, {}, 8)).items.length).toBeLessThanOrEqual(8);
  });

  it("shows only public, watchable Shorts, leaving out inactive categories", async () => {
    const active = await category("أ");
    const inactive = await prisma.category.create({ data: { title: "ب", slug: "inactive", isActive: false } });

    const visible = await video(active.id);
    await video(active.id, { status: "DRAFT" });
    await video(active.id, { isArchived: true });
    await video(active.id, { availability: "NOT_EMBEDDABLE" });
    await video(active.id, { availability: "UNAVAILABLE" });
    await video(active.id, { availability: "UNKNOWN" });
    await video(active.id, { kind: "LONG_FORM" });
    await video(inactive.id);
    const uncategorized = await video(null);

    const pages = await readWholeFeed(null);
    expect(pages.flatMap((page) => page.items.map((item) => item.id)).sort()).toEqual([visible.id, uncategorized.id].sort());
  });

  it("is empty, not an error, with no content", async () => {
    expect(await getFeedPage(null, {})).toEqual({ items: [], nextCursor: null });
  });

  it("favours chosen categories while still exploring, for an account", async () => {
    const chosen = await category("مختار");
    const other = await category("آخر");
    for (let index = 0; index < 40; index += 1) {
      await video(chosen.id);
      await video(other.id);
    }
    const actor = await createActor(prisma, "USER");
    await saveInterests(actor, { categoryIds: [chosen.id] });

    const { items } = await getFeedPage(actor, {}, 10);
    const inChosen = items.filter((item) => item.category?.id === chosen.id).length;
    expect(inChosen).toBe(10 - Math.round(10 * DEFAULT_SCORING_CONFIG.explorationShare));
    expect(items.length - inChosen).toBeGreaterThan(0);
  });

  it("uses guest hints for a guest, and ignores them for an account", async () => {
    const chosen = await category("مختار");
    const other = await category("آخر");
    for (let index = 0; index < 30; index += 1) {
      await video(chosen.id);
      await video(other.id);
    }
    const guest = { selectedCategoryIds: [chosen.id], behaviour: {} };

    const asGuest = await getFeedPage(null, { guest }, 10);
    expect(asGuest.items.filter((item) => item.category?.id === chosen.id).length).toBe(8);

    const actor = await createActor(prisma, "USER");
    await saveInterests(actor, { categoryIds: [other.id] });
    const asAccount = await getFeedPage(actor, { guest }, 10);
    expect(asAccount.items.filter((item) => item.category?.id === other.id).length).toBe(8);
  });

  it("limits how far a guest's edited hints can push anything", async () => {
    const { id } = await category("أ");
    await video(id);
    expect(await errorCodeOf(getFeedPage(null, { guest: { selectedCategoryIds: [], behaviour: { [id]: 1e308 } } }))).toBeUndefined();
    expect(await errorCodeOf(getFeedPage(null, { guest: { selectedCategoryIds: ["nope"], behaviour: {} } }))).toBe("VALIDATION");
    expect(await errorCodeOf(getFeedPage(null, { guest: { selectedCategoryIds: [], behaviour: { [id]: Number.NaN } } }))).toBe("VALIDATION");
  });

  it("gives a category feed only that category", async () => {
    const first = await category("أ");
    const second = await category("ب");
    for (let index = 0; index < 12; index += 1) {
      await video(first.id);
      await video(second.id);
    }
    const pages = await readWholeFeed(null, { categoryId: first.id });
    const items = pages.flatMap((page) => page.items);
    expect(items).toHaveLength(12);
    expect(items.every((item) => item.category?.id === first.id)).toBe(true);
  });

  it("rejects a bad category or cursor", async () => {
    await category("أ");
    expect(await errorCodeOf(getFeedPage(null, { categoryId: "nope" }))).toBe("VALIDATION");
    expect(await errorCodeOf(getFeedPage(null, { categoryId: "f".repeat(24) }))).toBe("NOT_FOUND");
    expect(await errorCodeOf(getFeedPage(null, { cursor: "garbage!" }))).toBe("VALIDATION");
  });

  async function channelsOf(items: { id: string }[]) {
    const rows = await prisma.video.findMany({ where: { id: { in: items.map((item) => item.id) } }, select: { id: true, channelId: true } });
    const channelOf = new Map(rows.map((row) => [row.id, row.channelId]));
    return items.map((item) => channelOf.get(item.id)!);
  }

  const createChannels = (count: number) => Promise.all(Array.from({ length: count }, (_, n) => prisma.youTubeChannel.create({ data: { youtubeChannelId: `UC${n}`, title: String(n) } })));

  it("avoids runs of one channel when others are available", async () => {
    const { id } = await category("أ");
    const channels = await createChannels(2);
    for (let index = 0; index < 8; index += 1) await video(id, { channelId: channels[index % 2]!.id, feedKey: index < 4 ? index : index + 100 });

    const { items } = await getFeedPage(null, { cursor: encodeFeedCursor({ s: 0, n: 0, o: {}, r: [] }) }, 8);
    const channelIds = await channelsOf(items);
    for (let index = 1; index < channelIds.length; index += 1) expect(channelIds[index]).not.toBe(channelIds[index - 1]);
  });

  it("keeps a channel with most of the videos from dominating, across pages, and still shows everything once", async () => {
    const { id } = await category("أ");
    const channels = await createChannels(8);
    const expected = new Set<string>();
    // One channel has 40 videos with neighbouring feed keys, and seven others have 4 each.
    for (let index = 0; index < 40; index += 1) expected.add((await video(id, { channelId: channels[0]!.id, feedKey: index })).id);
    for (const channel of channels.slice(1)) for (let index = 0; index < 4; index += 1) expected.add((await video(id, { channelId: channel.id, feedKey: 1000 + index })).id);

    const pages = await readWholeFeed(null, { cursor: encodeFeedCursor({ s: 0, n: 0, o: {}, r: [] }) });
    const ids = pages.flatMap((page) => page.items.map((item) => item.id));
    expect(new Set(ids)).toEqual(expected);
    expect(ids).toHaveLength(expected.size);

    // While others remain, it stays spaced: the first 24 can't include a repeat within 6.
    const channelIds = await channelsOf(ids.slice(0, 24).map((item) => ({ id: item })));
    for (let index = 0; index < channelIds.length; index += 1) expect(channelIds.slice(Math.max(0, index - 6), index)).not.toContain(channelIds[index]);
  });

  it("answers what happened this visit, on the next page", async () => {
    const [liked, other, skipped] = await Promise.all([category("أ"), category("ب"), category("ج")]);
    const channels = await createChannels(21);
    for (const [offset, cat] of [liked, other, skipped].entries()) {
      for (let index = 0; index < 14; index += 1) await video(cat.id, { channelId: channels[offset * 7 + (index % 7)]!.id });
    }
    const countIn = (items: { category: { id: string } | null }[], id: string) => items.filter((item) => item.category?.id === id).length;

    const { items } = await getFeedPage(null, { session: { categories: { [liked.id]: 3, [skipped.id]: -3 }, channels: {} } }, 8);
    // Its share is limited, so a burst of activity can't turn the feed into one topic.
    expect(countIn(items, liked.id)).toBe(6);
    expect(countIn(items, skipped.id)).toBeLessThanOrEqual(1);
  });

  it("rejects bad session hints and limits large ones", async () => {
    const { id } = await category("أ");
    await video(id);
    expect(await errorCodeOf(getFeedPage(null, { session: { categories: { nope: 1 }, channels: {} } }))).toBe("VALIDATION");
    expect(await errorCodeOf(getFeedPage(null, { session: { categories: {}, channels: { [id]: Number.NaN } } }))).toBe("VALIDATION");
    expect(await errorCodeOf(getFeedPage(null, { session: { categories: { [id]: 1e308 }, channels: {} } }))).toBeUndefined();
  });

  it("starts a new round rather than let a very long session's cursor outgrow a URL", async () => {
    const { id } = await category("أ");
    await video(id);
    await video(id);
    const huge = Object.fromEntries(Array.from({ length: 450 }, (_, index) => [index.toString(16).padStart(16, "0"), 1]));
    const { nextCursor } = await getFeedPage(null, { cursor: encodeFeedCursor({ s: 0, n: 0, o: huge, r: [] }) }, 1);
    expect(nextCursor!.length).toBeLessThan(8000);
  });
});

describe("video cards", () => {
  it("show stored data, and no statistics while they're off", async () => {
    const cat = await category("فقه");
    const row = await video(cat.id, {
      title: "العنوان الأصلي",
      channelTitle: "قناة",
      thumbnails: [{ quality: "high", url: "https://i.ytimg.com/h.jpg" }],
      stats: { viewCount: 99n, fetchedAt: new Date() },
    });
    expect(await getPublicVideo(row.id)).toMatchObject({ title: "العنوان الأصلي", channelTitle: "قناة", thumbnailUrl: "https://i.ytimg.com/h.jpg", viewCount: null, category: { title: "فقه" }, cta: null });
  });

  it("include only published topics", async () => {
    const cat = await category("فقه");
    const published = await prisma.topic.create({ data: { title: "منشور", slug: "p", status: "PUBLISHED" } });
    const draft = await prisma.topic.create({ data: { title: "مسودة", slug: "d" } });
    const row = await video(cat.id, { topicIds: [published.id, draft.id] });
    expect((await getPublicVideo(row.id))?.topics).toEqual(["منشور"]);
  });

  describe("CTAs", () => {
    it("link to a full video only when it's public", async () => {
      const cat = await category("فقه");
      const full = await video(cat.id, { kind: "LONG_FORM" });
      const withCta = await video(cat.id, { cta: { type: "FULL_VIDEO", targetId: full.id, label: "المحاضرة" } });
      expect((await getPublicVideo(withCta.id))?.cta).toEqual({ type: "FULL_VIDEO", label: "المحاضرة", href: `/videos/${full.id}`, isExternal: false });

      await prisma.video.update({ where: { id: full.id }, data: { status: "DRAFT" } });
      expect((await getPublicVideo(withCta.id))?.cta).toBeNull();
    });

    it("open external resources, but never an unsafe link", async () => {
      const cat = await category("فقه");
      const safe = await video(cat.id, { cta: { type: "EXTERNAL_RESOURCE", externalUrl: "https://example.org/a" } });
      expect((await getPublicVideo(safe.id))?.cta).toMatchObject({ href: "https://example.org/a", isExternal: true });

      const unsafe = await video(cat.id, { cta: { type: "EXTERNAL_RESOURCE", externalUrl: "javascript:alert(1)" } });
      expect((await getPublicVideo(unsafe.id))?.cta).toBeNull();
    });

    it("stay hidden while the playlist they lead to isn't public", async () => {
      const cat = await category("فقه");
      const playlist = await prisma.playlist.create({ data: { type: "CURATED", title: "x", slug: "x", sourceKey: "cur:x" } });
      const row = await video(cat.id, { cta: { type: "CURATED_PLAYLIST", targetId: playlist.id } });
      expect((await getPublicVideo(row.id))?.cta).toBeNull();
    });
  });

  it("aren't available for a hidden video or a bad ID", async () => {
    const cat = await category("فقه");
    expect(await getPublicVideo((await video(cat.id, { status: "DRAFT" })).id)).toBeNull();
    expect(await getPublicVideo("nope")).toBeNull();
    expect(await getPublicVideo("f".repeat(24))).toBeNull();
  });
});

describe("publishing a video", () => {
  it("is a separate, audited permission from editing", async () => {
    const cat = await category("فقه");
    const row = await video(cat.id, { status: "DRAFT" });
    const editor = await createActor(prisma, "EDITOR");
    const admin = await createActor(prisma, "ADMIN");

    await assignVideo(editor, row.id, { kind: "SHORT", categoryId: cat.id });
    expect(await errorCodeOf(setVideoPublished(editor, row.id, true))).toBe("FORBIDDEN");
    expect(await errorCodeOf(setVideoPublished(null, row.id, true))).toBe("UNAUTHENTICATED");

    expect((await setVideoPublished(admin, row.id, true)).status).toBe("PUBLISHED");
    expect(await prisma.auditLog.count({ where: { action: "video.publish", actorId: admin.id } })).toBe(1);
  });

  it("counts a person pressing publish as the review, since nothing publishes by itself (§7.2)", async () => {
    const cat = await category("فقه");
    const row = await video(cat.id, { status: "DRAFT", reviewedAt: null });
    const admin = await createActor(prisma, "ADMIN");

    const published = await setVideoPublished(admin, row.id, true);
    expect(published.status).toBe("PUBLISHED");
    expect(published.reviewedAt).toBeInstanceOf(Date);
    expect(await prisma.auditLog.count({ where: { action: "video.publish", entityId: row.id } })).toBe(1);
  });

  it("keeps an earlier review's date", async () => {
    const cat = await category("فقه");
    const reviewedAt = new Date("2026-01-01T00:00:00.000Z");
    const row = await video(cat.id, { status: "DRAFT", reviewedAt });
    const admin = await createActor(prisma, "ADMIN");
    expect((await setVideoPublished(admin, row.id, true)).reviewedAt).toEqual(reviewedAt);
  });

  it("publishes a Short with no category, and the feed shows it", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const row = await video(null, { status: "DRAFT", reviewedAt: null });
    expect((await setVideoPublished(admin, row.id, true)).status).toBe("PUBLISHED");

    const page = await getFeedPage(null, {});
    expect(page.items.map((item) => item.id)).toContain(row.id);
    expect(page.items.find((item) => item.id === row.id)?.category).toBeNull();
  });

  it("serves uncategorized Shorts alongside categorised ones, with no repeats across pages", async () => {
    const cat = await category("فقه");
    const ids: string[] = [];
    for (let index = 0; index < 12; index += 1) ids.push((await video(index % 2 ? cat.id : null)).id);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let turn = 0; turn < 10; turn += 1) {
      const page: Awaited<ReturnType<typeof getFeedPage>> = await getFeedPage(null, { cursor }, 5);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen.sort()).toEqual(ids.sort());
  });

  it("keeps uncategorized Shorts out of a chosen category's feed", async () => {
    const cat = await category("فقه");
    const inside = await video(cat.id);
    await video(null);
    expect((await getFeedPage(null, { categoryId: cat.id })).items.map((item) => item.id)).toEqual([inside.id]);
  });

  it("still refuses a video that can't play, or one that's archived", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const archived = await video(null, { status: "DRAFT", isArchived: true });
    expect(await errorCodeOf(setVideoPublished(admin, archived.id, true))).toBe("CONFLICT");

    const cat = await category("فقه");
    const blocked = await video(cat.id, { status: "DRAFT", reviewedAt: new Date(), availability: "NOT_EMBEDDABLE" });
    expect(await errorCodeOf(setVideoPublished(admin, blocked.id, true))).toBe("CONFLICT");
  });

  it("validates assignments", async () => {
    const cat = await category("فقه");
    const row = await video(cat.id);
    const admin = await createActor(prisma, "ADMIN");
    expect(await errorCodeOf(assignVideo(admin, row.id, { categoryId: "f".repeat(24) }))).toBe("VALIDATION");
    expect(await errorCodeOf(assignVideo(admin, row.id, { title: "changed" }))).toBe("VALIDATION");
    expect(await errorCodeOf(assignVideo(admin, row.id, { cta: { type: "EXTERNAL_RESOURCE", externalUrl: "javascript:alert(1)" } }))).toBe("VALIDATION");
    expect(await errorCodeOf(assignVideo(admin, "nope", {}))).toBe("VALIDATION");
    expect((await assignVideo(admin, row.id, { cta: { type: "EXTERNAL_RESOURCE", externalUrl: "https://example.org" } })).cta?.externalUrl).toBe("https://example.org");
    expect((await assignVideo(admin, row.id, { cta: null })).cta).toBeNull();
  });
});

describe("signals", () => {
  async function setup() {
    const cat = await category("فقه");
    const row = await video(cat.id);
    const actor = await createActor(prisma, "USER");
    return { cat, row, actor };
  }
  const interestOf = (userId: string, categoryId: string) => prisma.userInterest.findUnique({ where: { userId_categoryId: { userId, categoryId } } });

  it("raises a category a little for a completion, and records it with an expiry", async () => {
    const { cat, row, actor } = await setup();
    await recordVideoSignal(actor, { videoId: row.id, signal: "completion" });

    expect((await interestOf(actor.id, cat.id))?.behaviourScore).toBe(DEFAULT_SCORING_CONFIG.signalWeights.completion);
    const activity = await prisma.userActivity.findFirstOrThrow({ where: { userId: actor.id } });
    expect(activity).toMatchObject({ action: "COMPLETE", entityType: "VIDEO", entityId: row.id, categoryId: cat.id });
    expect(activity.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("lowers it for an early skip", async () => {
    const { cat, row, actor } = await setup();
    await recordVideoSignal(actor, { videoId: row.id, signal: "earlySkip" });
    expect((await interestOf(actor.id, cat.id))?.behaviourScore).toBe(DEFAULT_SCORING_CONFIG.signalWeights.earlySkip);
  });

  it("recognises repeated engagement with a category, without any single watch counting much", async () => {
    const { cat, actor } = await setup();
    const now = new Date();
    for (let index = 0; index < 3; index += 1) {
      const row = await video(cat.id);
      await recordVideoSignal(actor, { videoId: row.id, signal: "completion" }, now);
    }
    const { completion, repeatedEngagement } = DEFAULT_SCORING_CONFIG.signalWeights;
    expect((await interestOf(actor.id, cat.id))?.behaviourScore).toBeCloseTo(completion * 3 + repeatedEngagement);
  });

  it("doesn't change a person's explicit selection", async () => {
    const { cat, row, actor } = await setup();
    await saveInterests(actor, { categoryIds: [cat.id] });
    await recordVideoSignal(actor, { videoId: row.id, signal: "earlySkip" });
    expect(await interestOf(actor.id, cat.id)).toMatchObject({ isSelected: true, explicitWeight: 1 });
  });

  it("needs a signed-in person and a public video, and rejects anything else", async () => {
    const { row, actor } = await setup();
    const other = await createActor(prisma, "USER");
    const draft = await video(row.categoryId, { status: "DRAFT" });

    expect(await errorCodeOf(recordVideoSignal(null, { videoId: row.id, signal: "completion" }))).toBe("UNAUTHENTICATED");
    expect(await errorCodeOf(recordVideoSignal(actor, { videoId: draft.id, signal: "completion" }))).toBe("NOT_FOUND");
    expect(await errorCodeOf(recordVideoSignal(actor, { videoId: row.id, signal: "save" }))).toBe("VALIDATION");
    expect(await errorCodeOf(recordVideoSignal(actor, { videoId: row.id, signal: "completion", userId: other.id }))).toBe("VALIDATION");
    expect(await prisma.userActivity.count({ where: { userId: other.id } })).toBe(0);
  });

  it("moves a guest's browser-held signals into the account once, bounded", async () => {
    const { cat, actor } = await setup();
    const merge = (score: number) => mergeGuestPreferences(actor, { version: 1, selectedCategoryIds: [], onboarding: "pending", behaviour: { [cat.id]: score } });

    await merge(99999);
    expect((await interestOf(actor.id, cat.id))?.behaviourScore).toBe(DEFAULT_SCORING_CONFIG.maxBehaviourScore);

    await merge(1);
    expect((await interestOf(actor.id, cat.id))?.behaviourScore).toBe(DEFAULT_SCORING_CONFIG.maxBehaviourScore);
  });
});

describe("saving videos", () => {
  it("is safe to repeat, counts as one signal, and can be undone", async () => {
    const cat = await category("فقه");
    const row = await video(cat.id);
    const actor = await createActor(prisma, "USER");

    expect(await setVideoSaved(actor, { videoId: row.id, isSaved: true })).toEqual({ isSaved: true });
    await setVideoSaved(actor, { videoId: row.id, isSaved: true });

    expect(await prisma.favorite.count({ where: { userId: actor.id } })).toBe(1);
    expect(await getSavedVideoIds(actor, [row.id])).toEqual([row.id]);
    const interest = await prisma.userInterest.findFirstOrThrow({ where: { userId: actor.id } });
    expect(interest.behaviourScore).toBe(DEFAULT_SCORING_CONFIG.signalWeights.save);

    await setVideoSaved(actor, { videoId: row.id, isSaved: false });
    expect(await getSavedVideoIds(actor, [row.id])).toEqual([]);
  });

  it("handles two saves at once without an error", async () => {
    const cat = await category("فقه");
    const row = await video(cat.id);
    const actor = await createActor(prisma, "USER");
    await Promise.all(Array.from({ length: 4 }, () => setVideoSaved(actor, { videoId: row.id, isSaved: true })));
    expect(await prisma.favorite.count({ where: { userId: actor.id } })).toBe(1);
  });

  it("keeps each person's saves separate, and takes no user ID from input", async () => {
    const cat = await category("فقه");
    const row = await video(cat.id);
    const owner = await createActor(prisma, "USER");
    const other = await createActor(prisma, "USER");
    await setVideoSaved(owner, { videoId: row.id, isSaved: true });

    expect(await getSavedVideoIds(other, [row.id])).toEqual([]);
    await setVideoSaved(other, { videoId: row.id, isSaved: false });
    expect(await getSavedVideoIds(owner, [row.id])).toEqual([row.id]);
    expect(await errorCodeOf(setVideoSaved(other, { videoId: row.id, isSaved: true, userId: owner.id }))).toBe("VALIDATION");
  });

  it("needs sign-in and a public video", async () => {
    const cat = await category("فقه");
    const draft = await video(cat.id, { status: "DRAFT" });
    const actor = await createActor(prisma, "USER");
    expect(await errorCodeOf(setVideoSaved(null, { videoId: draft.id, isSaved: true }))).toBe("UNAUTHENTICATED");
    expect(await errorCodeOf(setVideoSaved(actor, { videoId: draft.id, isSaved: true }))).toBe("NOT_FOUND");
    expect(await errorCodeOf(getSavedVideoIds(null, []))).toBe("UNAUTHENTICATED");
    expect(await errorCodeOf(getSavedVideoIds(actor, Array(51).fill(draft.id)))).toBe("VALIDATION");
  });
});
