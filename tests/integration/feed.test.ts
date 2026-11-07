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
import { createActor, createChannel, createPublishedTopic } from "./phase3-helpers";

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

/** A published topic with one channel in it, since a video only has topics through its channel. */
async function topic(title: string) {
  const row = await createPublishedTopic(prisma, { title });
  const channel = await createChannel(prisma, [row.id]);
  return { id: row.id, title: row.title, channelId: channel.id };
}

async function video(channelId: string | null, overrides: Record<string, unknown> = {}) {
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
      channelId,
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

const idsIn = (pages: { items: { id: string }[] }[]) => pages.flatMap((page) => page.items.map((item) => item.id));
const countInTopic = (items: { topics: { id: string }[] }[], topicId: string) => items.filter((item) => item.topics.some((row) => row.id === topicId)).length;
const noHints = { selectedTopicIds: [], channelChoices: {}, behaviour: {} };

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
    const { channelId } = await topic("أ");
    await video(channelId);
    await getFeedPage(null, {});
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("has no duplicates and misses nothing, across all pages, topics, and start points", async () => {
    const topics = [await topic("أ"), await topic("ب"), await topic("ج")];
    const expected = new Set<string>();
    for (let index = 0; index < 45; index += 1) expected.add((await video(topics[index % 3]!.channelId)).id);

    // Random start key on each read, including ones that force wrapping around.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const ids = idsIn(await readWholeFeed(null));
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(ids)).toEqual(expected);
    }
  });

  it("shows a video of a channel in two topics only once", async () => {
    const [first, second] = [await createPublishedTopic(prisma), await createPublishedTopic(prisma)];
    const shared = await createChannel(prisma, [first.id, second.id]);
    const expected = new Set<string>();
    for (let index = 0; index < 20; index += 1) expected.add((await video(shared.id)).id);

    const ids = idsIn(await readWholeFeed(null));
    expect(ids).toHaveLength(expected.size);
    expect(new Set(ids)).toEqual(expected);
  });

  it("wraps around correctly from a start key in the middle", async () => {
    const { channelId } = await topic("أ");
    const expected = new Set<string>();
    for (let index = 0; index < 20; index += 1) expected.add((await video(channelId, { feedKey: index * 10 })).id);

    const cursor = encodeFeedCursor({ s: 95, n: 0, o: {}, r: [] });
    const ids = idsIn(await readWholeFeed(null, { cursor }));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(expected);
  });

  it("handles videos with the same feed key, which is possible with random keys", async () => {
    const { channelId } = await topic("أ");
    const expected = new Set<string>();
    for (let index = 0; index < 20; index += 1) expected.add((await video(channelId, { feedKey: 500 })).id);

    const ids = idsIn(await readWholeFeed(null));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(expected);
  });

  it("returns a bounded page", async () => {
    const { channelId } = await topic("أ");
    for (let index = 0; index < 30; index += 1) await video(channelId);
    expect((await getFeedPage(null, {}, 8)).items.length).toBeLessThanOrEqual(8);
  });

  it("shows only public, watchable Shorts", async () => {
    const { channelId } = await topic("أ");

    const visible = await video(channelId);
    await video(channelId, { status: "DRAFT" });
    await video(channelId, { isArchived: true });
    await video(channelId, { availability: "NOT_EMBEDDABLE" });
    await video(channelId, { availability: "UNAVAILABLE" });
    await video(channelId, { availability: "UNKNOWN" });
    await video(channelId, { kind: "LONG_FORM" });
    const noChannel = await video(null);

    expect(idsIn(await readWholeFeed(null)).sort()).toEqual([visible.id, noChannel.id].sort());
  });

  it("treats a channel whose only topic isn't public as having no topic", async () => {
    const chosen = await topic("مختار");
    const draftTopic = await createPublishedTopic(prisma, { status: "DRAFT" });
    const archivedTopic = await createPublishedTopic(prisma, { isArchived: true });
    const inDraft = await video((await createChannel(prisma, [draftTopic.id])).id);
    const inArchived = await video((await createChannel(prisma, [archivedTopic.id])).id);
    const inChosen = await video(chosen.channelId);

    expect(idsIn(await readWholeFeed(null)).sort()).toEqual([inDraft.id, inArchived.id, inChosen.id].sort());
    expect((await getPublicVideo(inDraft.id))?.topics).toEqual([]);

    // They don't belong to anything chosen, and can't be reached through the hidden topic.
    expect(idsIn(await readWholeFeed(null, { guest: { ...noHints, selectedTopicIds: [chosen.id] } }))).toEqual([inChosen.id]);
    expect(await errorCodeOf(getFeedPage(null, { topicId: draftTopic.id }))).toBe("NOT_FOUND");
  });

  it("is empty, not an error, with no content", async () => {
    expect(await getFeedPage(null, {})).toEqual({ items: [], nextCursor: null });
  });

  describe("which channels are on", () => {
    async function library() {
      const [chosen, other] = [await topic("مختار"), await topic("آخر")];
      const inChosen = await video(chosen.channelId);
      const inOther = await video(other.channelId);
      const noChannel = await video(null);
      return { chosen, other, inChosen, inOther, noChannel };
    }

    it("is everything with no selection, including videos with no channel", async () => {
      const { inChosen, inOther, noChannel } = await library();
      expect(idsIn(await readWholeFeed(null, { guest: noHints })).sort()).toEqual([inChosen.id, inOther.id, noChannel.id].sort());
    });

    it("is only channels sharing a selected topic, once there's a selection, with no video lacking a channel", async () => {
      const { chosen, inChosen } = await library();
      expect(idsIn(await readWholeFeed(null, { guest: { ...noHints, selectedTopicIds: [chosen.id] } }))).toEqual([inChosen.id]);

      const actor = await createActor(prisma, "USER");
      await saveInterests(actor, { topicIds: [chosen.id], channelChoices: {} });
      expect(idsIn(await readWholeFeed(actor))).toEqual([inChosen.id]);
    });

    it("adds a channel switched on by hand, outside the selected topics", async () => {
      const { chosen, other, inChosen, inOther } = await library();
      const request = { guest: { ...noHints, selectedTopicIds: [chosen.id], channelChoices: { [other.channelId]: true } } };
      expect(idsIn(await readWholeFeed(null, request)).sort()).toEqual([inChosen.id, inOther.id].sort());
    });

    it("removes a channel switched off by hand, even inside a selected topic", async () => {
      const { chosen } = await library();
      const second = await createChannel(prisma, [chosen.id]);
      const inSecond = await video(second.id);

      const guest = { ...noHints, selectedTopicIds: [chosen.id], channelChoices: { [chosen.channelId]: false } };
      expect(idsIn(await readWholeFeed(null, { guest }))).toEqual([inSecond.id]);

      const actor = await createActor(prisma, "USER");
      await saveInterests(actor, { topicIds: [chosen.id], channelChoices: { [chosen.channelId]: false } });
      expect(idsIn(await readWholeFeed(actor))).toEqual([inSecond.id]);
    });

    it("removes a channel switched off with no selection, and leaves the rest on", async () => {
      const { chosen, inOther, noChannel } = await library();
      const guest = { ...noHints, channelChoices: { [chosen.channelId]: false } };
      expect(idsIn(await readWholeFeed(null, { guest })).sort()).toEqual([inOther.id, noChannel.id].sort());
    });

    it("acts as if nothing was chosen when every chosen topic has since been unpublished", async () => {
      const { chosen, inChosen, inOther, noChannel } = await library();
      await prisma.topic.update({ where: { id: chosen.id }, data: { status: "DRAFT" } });
      expect(idsIn(await readWholeFeed(null, { guest: { ...noHints, selectedTopicIds: [chosen.id] } })).sort()).toEqual([inChosen.id, inOther.id, noChannel.id].sort());
    });
  });

  /**
   * A topic with more channels than the spacing rule covers, so topic shares are what decide a
   * page. With fewer, the rule would hand slots to other topics to keep channels apart.
   */
  async function topicWithManyChannels(videoCount: number) {
    const row = await createPublishedTopic(prisma);
    const channels = await Promise.all(Array.from({ length: DEFAULT_SCORING_CONFIG.channelSpacing + 2 }, () => createChannel(prisma, [row.id])));
    for (let index = 0; index < videoCount; index += 1) await video(channels[index % channels.length]!.id);
    return { id: row.id, switchedOn: Object.fromEntries(channels.map((channel) => [channel.id, true])) };
  }

  it("favours chosen topics while still exploring, for an account", async () => {
    const chosen = await topicWithManyChannels(40);
    const other = await topicWithManyChannels(40);
    const actor = await createActor(prisma, "USER");
    // Only a channel that's on can be explored, once there's a selection.
    await saveInterests(actor, { topicIds: [chosen.id], channelChoices: other.switchedOn });

    const { items } = await getFeedPage(actor, {}, 10);
    const inChosen = countInTopic(items, chosen.id);
    expect(inChosen).toBe(10 - Math.round(10 * DEFAULT_SCORING_CONFIG.explorationShare));
    expect(items.length - inChosen).toBeGreaterThan(0);
  });

  it("uses guest hints for a guest, and ignores them for an account", async () => {
    const chosen = await topicWithManyChannels(30);
    const other = await topicWithManyChannels(30);
    const guest = { selectedTopicIds: [chosen.id], channelChoices: other.switchedOn, behaviour: {} };

    const asGuest = await getFeedPage(null, { guest }, 10);
    expect(countInTopic(asGuest.items, chosen.id)).toBe(8);

    const actor = await createActor(prisma, "USER");
    await saveInterests(actor, { topicIds: [other.id], channelChoices: chosen.switchedOn });
    const asAccount = await getFeedPage(actor, { guest }, 10);
    expect(countInTopic(asAccount.items, other.id)).toBe(8);
  });

  it("limits how far a guest's edited hints can push anything", async () => {
    const { id, channelId } = await topic("أ");
    await video(channelId);
    expect(await errorCodeOf(getFeedPage(null, { guest: { ...noHints, behaviour: { [id]: 1e308 } } }))).toBeUndefined();
    expect(await errorCodeOf(getFeedPage(null, { guest: { ...noHints, selectedTopicIds: ["nope"] } }))).toBe("VALIDATION");
    expect(await errorCodeOf(getFeedPage(null, { guest: { ...noHints, behaviour: { [id]: Number.NaN } } }))).toBe("VALIDATION");
    expect(await errorCodeOf(getFeedPage(null, { guest: { ...noHints, channelChoices: { nope: true } } }))).toBe("VALIDATION");
  });

  it("gives a topic feed only that topic", async () => {
    const first = await topic("أ");
    const second = await topic("ب");
    for (let index = 0; index < 12; index += 1) {
      await video(first.channelId);
      await video(second.channelId);
    }
    const pages = await readWholeFeed(null, { topicId: first.id });
    const items = pages.flatMap((page) => page.items);
    expect(items).toHaveLength(12);
    expect(items.every((item) => item.topics.some((row) => row.id === first.id))).toBe(true);
  });

  it("reads a channel in several topics from each of its topic feeds", async () => {
    const [first, second] = [await createPublishedTopic(prisma), await createPublishedTopic(prisma)];
    const shared = await video((await createChannel(prisma, [first.id, second.id])).id);
    expect(idsIn(await readWholeFeed(null, { topicId: first.id }))).toEqual([shared.id]);
    expect(idsIn(await readWholeFeed(null, { topicId: second.id }))).toEqual([shared.id]);
  });

  it("rejects a bad topic or cursor", async () => {
    await topic("أ");
    expect(await errorCodeOf(getFeedPage(null, { topicId: "nope" }))).toBe("VALIDATION");
    expect(await errorCodeOf(getFeedPage(null, { topicId: "f".repeat(24) }))).toBe("NOT_FOUND");
    expect(await errorCodeOf(getFeedPage(null, { cursor: "garbage!" }))).toBe("VALIDATION");
  });

  async function channelsOf(items: { id: string }[]) {
    const rows = await prisma.video.findMany({ where: { id: { in: items.map((item) => item.id) } }, select: { id: true, channelId: true } });
    const channelOf = new Map(rows.map((row) => [row.id, row.channelId]));
    return items.map((item) => channelOf.get(item.id)!);
  }

  const createChannels = (count: number, topicId: string) => Promise.all(Array.from({ length: count }, () => createChannel(prisma, [topicId])));

  it("avoids runs of one channel when others are available", async () => {
    const { id } = await createPublishedTopic(prisma);
    const channels = await createChannels(2, id);
    for (let index = 0; index < 8; index += 1) await video(channels[index % 2]!.id, { feedKey: index < 4 ? index : index + 100 });

    const { items } = await getFeedPage(null, { cursor: encodeFeedCursor({ s: 0, n: 0, o: {}, r: [] }) }, 8);
    const channelIds = await channelsOf(items);
    for (let index = 1; index < channelIds.length; index += 1) expect(channelIds[index]).not.toBe(channelIds[index - 1]);
  });

  it("keeps a channel with most of the videos from dominating, across pages, and still shows everything once", async () => {
    const { id } = await createPublishedTopic(prisma);
    const channels = await createChannels(8, id);
    const expected = new Set<string>();
    // One channel has 40 videos with neighbouring feed keys, and seven others have 4 each.
    for (let index = 0; index < 40; index += 1) expected.add((await video(channels[0]!.id, { feedKey: index })).id);
    for (const channel of channels.slice(1)) for (let index = 0; index < 4; index += 1) expected.add((await video(channel.id, { feedKey: 1000 + index })).id);

    const pages = await readWholeFeed(null, { cursor: encodeFeedCursor({ s: 0, n: 0, o: {}, r: [] }) });
    const ids = idsIn(pages);
    expect(new Set(ids)).toEqual(expected);
    expect(ids).toHaveLength(expected.size);

    // While others remain, it stays spaced: the first 24 can't include a repeat within 6.
    const channelIds = await channelsOf(ids.slice(0, 24).map((item) => ({ id: item })));
    for (let index = 0; index < channelIds.length; index += 1) expect(channelIds.slice(Math.max(0, index - 6), index)).not.toContain(channelIds[index]);
  });

  it("answers what happened this visit, on the next page", async () => {
    const [liked, other, skipped] = [await createPublishedTopic(prisma), await createPublishedTopic(prisma), await createPublishedTopic(prisma)];
    for (const row of [liked, other, skipped]) {
      const channels = await createChannels(7, row.id);
      for (let index = 0; index < 14; index += 1) await video(channels[index % 7]!.id);
    }

    const { items } = await getFeedPage(null, { session: { topics: { [liked.id]: 3, [skipped.id]: -3 }, channels: {} } }, 8);
    // Its share is limited, so a burst of activity can't turn the feed into one topic.
    expect(countInTopic(items, liked.id)).toBe(6);
    expect(countInTopic(items, skipped.id)).toBeLessThanOrEqual(1);
  });

  it("shows stored likes and comment counts, costing nothing to read", async () => {
    const { channelId } = await topic("أ");
    await video(channelId, { stats: { likeCount: 1200n, commentCount: 34n, fetchedAt: new Date() } });
    const { items } = await getFeedPage(null, {});
    expect(items[0]).toMatchObject({ likeCount: 1200, commentCount: 34 });
  });

  it("rejects bad session hints and limits large ones", async () => {
    const { id, channelId } = await topic("أ");
    await video(channelId);
    expect(await errorCodeOf(getFeedPage(null, { session: { topics: { nope: 1 }, channels: {} } }))).toBe("VALIDATION");
    expect(await errorCodeOf(getFeedPage(null, { session: { topics: {}, channels: { [channelId]: Number.NaN } } }))).toBe("VALIDATION");
    expect(await errorCodeOf(getFeedPage(null, { session: { topics: { [id]: 1e308 }, channels: {} } }))).toBeUndefined();
  });

  it("starts a new round rather than let a very long session's cursor outgrow a URL", async () => {
    const { channelId } = await topic("أ");
    await video(channelId);
    await video(channelId);
    const huge = Object.fromEntries(Array.from({ length: 450 }, (_, index) => [index.toString(16).padStart(16, "0"), 1]));
    const { nextCursor } = await getFeedPage(null, { cursor: encodeFeedCursor({ s: 0, n: 0, o: huge, r: [] }) }, 1);
    expect(nextCursor!.length).toBeLessThan(8000);
  });
});

describe("video cards", () => {
  it("show stored data, including stored statistics, and invent nothing", async () => {
    const row = await topic("فقه");
    const stored = await video(row.channelId, {
      title: "العنوان الأصلي",
      channelTitle: "قناة",
      thumbnails: [{ quality: "high", url: "https://i.ytimg.com/h.jpg" }],
      stats: { viewCount: 99n, fetchedAt: new Date() },
    });
    expect(await getPublicVideo(stored.id)).toMatchObject({ title: "العنوان الأصلي", channelTitle: "قناة", thumbnailUrl: "https://i.ytimg.com/h.jpg", viewCount: 99, topics: [{ id: row.id, title: "فقه" }], cta: null });

    const withoutStats = await video(row.channelId);
    expect(await getPublicVideo(withoutStats.id)).toMatchObject({ viewCount: null, likeCount: null, commentCount: null });
  });

  it("include only published topics of the video's channel, in display order", async () => {
    const second = await prisma.topic.create({ data: { title: "ثان", slug: "second", status: "PUBLISHED", displayOrder: 2 } });
    const first = await prisma.topic.create({ data: { title: "أول", slug: "first", status: "PUBLISHED", displayOrder: 1 } });
    const draft = await prisma.topic.create({ data: { title: "مسودة", slug: "d" } });
    const archived = await prisma.topic.create({ data: { title: "مؤرشف", slug: "a", status: "PUBLISHED", isArchived: true } });
    const stored = await video((await createChannel(prisma, [second.id, first.id, draft.id, archived.id])).id);
    expect((await getPublicVideo(stored.id))?.topics).toEqual([
      { id: first.id, title: "أول", slug: "first" },
      { id: second.id, title: "ثان", slug: "second" },
    ]);
  });

  describe("CTAs", () => {
    it("link to a full video only when it's public", async () => {
      const { channelId } = await topic("فقه");
      const full = await video(channelId, { kind: "LONG_FORM" });
      const withCta = await video(channelId, { cta: { type: "FULL_VIDEO", targetId: full.id, label: "المحاضرة" } });
      expect((await getPublicVideo(withCta.id))?.cta).toEqual({ type: "FULL_VIDEO", label: "المحاضرة", href: `/videos/${full.id}`, isExternal: false });

      await prisma.video.update({ where: { id: full.id }, data: { status: "DRAFT" } });
      expect((await getPublicVideo(withCta.id))?.cta).toBeNull();
    });

    it("open external resources, but never an unsafe link", async () => {
      const { channelId } = await topic("فقه");
      const safe = await video(channelId, { cta: { type: "EXTERNAL_RESOURCE", externalUrl: "https://example.org/a" } });
      expect((await getPublicVideo(safe.id))?.cta).toMatchObject({ href: "https://example.org/a", isExternal: true });

      const unsafe = await video(channelId, { cta: { type: "EXTERNAL_RESOURCE", externalUrl: "javascript:alert(1)" } });
      expect((await getPublicVideo(unsafe.id))?.cta).toBeNull();
    });

    it("stay hidden while the playlist they lead to isn't public", async () => {
      const { channelId } = await topic("فقه");
      const playlist = await prisma.playlist.create({ data: { type: "CURATED", title: "x", slug: "x", sourceKey: "cur:x" } });
      const row = await video(channelId, { cta: { type: "CURATED_PLAYLIST", targetId: playlist.id } });
      expect((await getPublicVideo(row.id))?.cta).toBeNull();
    });
  });

  it("aren't available for a hidden video or a bad ID", async () => {
    const { channelId } = await topic("فقه");
    expect(await getPublicVideo((await video(channelId, { status: "DRAFT" })).id)).toBeNull();
    expect(await getPublicVideo("nope")).toBeNull();
    expect(await getPublicVideo("f".repeat(24))).toBeNull();
  });
});

describe("publishing a video", () => {
  it("is a separate, audited permission from editing", async () => {
    const { channelId } = await topic("فقه");
    const row = await video(channelId, { status: "DRAFT" });
    const editor = await createActor(prisma, "EDITOR");
    const admin = await createActor(prisma, "ADMIN");

    await assignVideo(editor, row.id, { kind: "SHORT" });
    expect(await errorCodeOf(setVideoPublished(editor, row.id, true))).toBe("FORBIDDEN");
    expect(await errorCodeOf(setVideoPublished(null, row.id, true))).toBe("UNAUTHENTICATED");

    expect((await setVideoPublished(admin, row.id, true)).status).toBe("PUBLISHED");
    expect(await prisma.auditLog.count({ where: { action: "video.publish", actorId: admin.id } })).toBe(1);
  });

  it("counts a person pressing publish as the review, since nothing publishes by itself (§7.2)", async () => {
    const { channelId } = await topic("فقه");
    const row = await video(channelId, { status: "DRAFT", reviewedAt: null });
    const admin = await createActor(prisma, "ADMIN");

    const published = await setVideoPublished(admin, row.id, true);
    expect(published.status).toBe("PUBLISHED");
    expect(published.reviewedAt).toBeInstanceOf(Date);
    expect(await prisma.auditLog.count({ where: { action: "video.publish", entityId: row.id } })).toBe(1);
  });

  it("keeps an earlier review's date", async () => {
    const { channelId } = await topic("فقه");
    const reviewedAt = new Date("2026-01-01T00:00:00.000Z");
    const row = await video(channelId, { status: "DRAFT", reviewedAt });
    const admin = await createActor(prisma, "ADMIN");
    expect((await setVideoPublished(admin, row.id, true)).reviewedAt).toEqual(reviewedAt);
  });

  it("publishes a Short with no channel, and the feed shows it with no topics", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const row = await video(null, { status: "DRAFT", reviewedAt: null });
    expect((await setVideoPublished(admin, row.id, true)).status).toBe("PUBLISHED");

    const page = await getFeedPage(null, {});
    expect(page.items.map((item) => item.id)).toContain(row.id);
    expect(page.items.find((item) => item.id === row.id)?.topics).toEqual([]);
  });

  it("serves Shorts with no topic alongside ones with a topic, with no repeats across pages", async () => {
    const { channelId } = await topic("فقه");
    const noTopic = await createChannel(prisma);
    const ids: string[] = [];
    for (let index = 0; index < 12; index += 1) ids.push((await video(index % 2 ? channelId : index % 4 ? null : noTopic.id)).id);

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

  it("keeps Shorts with no topic out of a chosen topic's feed", async () => {
    const { id, channelId } = await topic("فقه");
    const inside = await video(channelId);
    await video(null);
    await video((await createChannel(prisma)).id);
    expect((await getFeedPage(null, { topicId: id })).items.map((item) => item.id)).toEqual([inside.id]);
  });

  it("still refuses a video that can't play, or one that's archived", async () => {
    const admin = await createActor(prisma, "ADMIN");
    const archived = await video(null, { status: "DRAFT", isArchived: true });
    expect(await errorCodeOf(setVideoPublished(admin, archived.id, true))).toBe("CONFLICT");

    const { channelId } = await topic("فقه");
    const blocked = await video(channelId, { status: "DRAFT", reviewedAt: new Date(), availability: "NOT_EMBEDDABLE" });
    expect(await errorCodeOf(setVideoPublished(admin, blocked.id, true))).toBe("CONFLICT");
  });

  it("validates assignments", async () => {
    const row = await video((await topic("فقه")).channelId);
    const admin = await createActor(prisma, "ADMIN");
    expect(await errorCodeOf(assignVideo(admin, row.id, { kind: "OTHER" }))).toBe("VALIDATION");
    // A video's topics come from its channel, so an assignment can't name any.
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
    const cat = await topic("فقه");
    const row = await video(cat.channelId);
    const actor = await createActor(prisma, "USER");
    return { cat, row, actor };
  }
  const interestOf = (userId: string, topicId: string) => prisma.userInterest.findUnique({ where: { userId_topicId: { userId, topicId } } });

  it("raises a topic a little for a completion, and records it with an expiry", async () => {
    const { cat, row, actor } = await setup();
    await recordVideoSignal(actor, { videoId: row.id, signal: "completion" });

    expect((await interestOf(actor.id, cat.id))?.behaviourScore).toBe(DEFAULT_SCORING_CONFIG.signalWeights.completion);
    const activity = await prisma.userActivity.findFirstOrThrow({ where: { userId: actor.id } });
    expect(activity).toMatchObject({ action: "COMPLETE", entityType: "VIDEO", entityId: row.id, channelId: cat.channelId });
    expect(activity.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("lowers it for an early skip", async () => {
    const { cat, row, actor } = await setup();
    await recordVideoSignal(actor, { videoId: row.id, signal: "earlySkip" });
    expect((await interestOf(actor.id, cat.id))?.behaviourScore).toBe(DEFAULT_SCORING_CONFIG.signalWeights.earlySkip);
  });

  it("applies to every published topic of the video's channel, and no other", async () => {
    const [first, second] = [await createPublishedTopic(prisma), await createPublishedTopic(prisma)];
    const draft = await createPublishedTopic(prisma, { status: "DRAFT" });
    const archived = await createPublishedTopic(prisma, { isArchived: true });
    const unrelated = await createPublishedTopic(prisma);
    const row = await video((await createChannel(prisma, [first.id, second.id, draft.id, archived.id])).id);
    const actor = await createActor(prisma, "USER");

    await recordVideoSignal(actor, { videoId: row.id, signal: "completion" });

    const { completion } = DEFAULT_SCORING_CONFIG.signalWeights;
    expect((await interestOf(actor.id, first.id))?.behaviourScore).toBe(completion);
    expect((await interestOf(actor.id, second.id))?.behaviourScore).toBe(completion);
    for (const left of [draft, archived, unrelated]) expect(await interestOf(actor.id, left.id)).toBeNull();
  });

  it("records the activity of a video with no topics, and learns nothing from it", async () => {
    const row = await video(null);
    const actor = await createActor(prisma, "USER");
    await recordVideoSignal(actor, { videoId: row.id, signal: "completion" });
    expect(await prisma.userActivity.count({ where: { userId: actor.id } })).toBe(1);
    expect(await prisma.userInterest.count({ where: { userId: actor.id } })).toBe(0);
  });

  it("recognises repeated engagement with a channel, without any single watch counting much", async () => {
    const { cat, actor } = await setup();
    const now = new Date();
    for (let index = 0; index < 3; index += 1) {
      const row = await video(cat.channelId);
      await recordVideoSignal(actor, { videoId: row.id, signal: "completion" }, now);
    }
    const { completion, repeatedEngagement } = DEFAULT_SCORING_CONFIG.signalWeights;
    expect((await interestOf(actor.id, cat.id))?.behaviourScore).toBeCloseTo(completion * 3 + repeatedEngagement);
  });

  it("counts repeated engagement per channel, not across a topic's channels", async () => {
    const { cat, actor } = await setup();
    const [second, third] = [await createChannel(prisma, [cat.id]), await createChannel(prisma, [cat.id])];
    const now = new Date();
    for (const channelId of [cat.channelId, second.id, third.id]) await recordVideoSignal(actor, { videoId: (await video(channelId)).id, signal: "completion" }, now);
    expect((await interestOf(actor.id, cat.id))?.behaviourScore).toBeCloseTo(DEFAULT_SCORING_CONFIG.signalWeights.completion * 3);
  });

  it("doesn't change a person's explicit selection", async () => {
    const { cat, row, actor } = await setup();
    await saveInterests(actor, { topicIds: [cat.id], channelChoices: {} });
    await recordVideoSignal(actor, { videoId: row.id, signal: "earlySkip" });
    expect(await interestOf(actor.id, cat.id)).toMatchObject({ isSelected: true, explicitWeight: 1 });
  });

  it("needs a signed-in person and a public video, and rejects anything else", async () => {
    const { row, actor } = await setup();
    const other = await createActor(prisma, "USER");
    const draft = await video(row.channelId, { status: "DRAFT" });

    expect(await errorCodeOf(recordVideoSignal(null, { videoId: row.id, signal: "completion" }))).toBe("UNAUTHENTICATED");
    expect(await errorCodeOf(recordVideoSignal(actor, { videoId: draft.id, signal: "completion" }))).toBe("NOT_FOUND");
    expect(await errorCodeOf(recordVideoSignal(actor, { videoId: row.id, signal: "save" }))).toBe("VALIDATION");
    expect(await errorCodeOf(recordVideoSignal(actor, { videoId: row.id, signal: "completion", userId: other.id }))).toBe("VALIDATION");
    expect(await prisma.userActivity.count({ where: { userId: other.id } })).toBe(0);
  });

  it("moves a guest's browser-held signals into the account once, bounded", async () => {
    const { cat, actor } = await setup();
    const merge = (score: number) => mergeGuestPreferences(actor, { version: 2, selectedTopicIds: [], channelChoices: {}, onboarding: "pending", behaviour: { [cat.id]: score } });

    await merge(99999);
    expect((await interestOf(actor.id, cat.id))?.behaviourScore).toBe(DEFAULT_SCORING_CONFIG.maxBehaviourScore);

    await merge(1);
    expect((await interestOf(actor.id, cat.id))?.behaviourScore).toBe(DEFAULT_SCORING_CONFIG.maxBehaviourScore);
  });
});

describe("saving videos", () => {
  it("is safe to repeat, counts as one signal, and can be undone", async () => {
    const row = await video((await topic("فقه")).channelId);
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
    const row = await video((await topic("فقه")).channelId);
    const actor = await createActor(prisma, "USER");
    await Promise.all(Array.from({ length: 4 }, () => setVideoSaved(actor, { videoId: row.id, isSaved: true })));
    expect(await prisma.favorite.count({ where: { userId: actor.id } })).toBe(1);
  });

  it("keeps each person's saves separate, and takes no user ID from input", async () => {
    const row = await video((await topic("فقه")).channelId);
    const owner = await createActor(prisma, "USER");
    const other = await createActor(prisma, "USER");
    await setVideoSaved(owner, { videoId: row.id, isSaved: true });

    expect(await getSavedVideoIds(other, [row.id])).toEqual([]);
    await setVideoSaved(other, { videoId: row.id, isSaved: false });
    expect(await getSavedVideoIds(owner, [row.id])).toEqual([row.id]);
    expect(await errorCodeOf(setVideoSaved(other, { videoId: row.id, isSaved: true, userId: owner.id }))).toBe("VALIDATION");
  });

  it("needs sign-in and a public video", async () => {
    const draft = await video((await topic("فقه")).channelId, { status: "DRAFT" });
    const actor = await createActor(prisma, "USER");
    expect(await errorCodeOf(setVideoSaved(null, { videoId: draft.id, isSaved: true }))).toBe("UNAUTHENTICATED");
    expect(await errorCodeOf(setVideoSaved(actor, { videoId: draft.id, isSaved: true }))).toBe("NOT_FOUND");
    expect(await errorCodeOf(getSavedVideoIds(null, []))).toBe("UNAUTHENTICATED");
    expect(await errorCodeOf(getSavedVideoIds(actor, Array(51).fill(draft.id)))).toBe("VALIDATION");
  });
});
