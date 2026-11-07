import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mergeGuestPreferences, resetInterests, saveInterests } from "@/features/preferences/preferences.service";
import { addLink, listLinks, removeLink } from "@/features/relationships/links.service";
import { searchPicker } from "@/features/relationships/picker.service";
import { recordVideoSignal } from "@/features/recommendations/signals.service";
import { getFeedPage } from "@/features/shorts/feed.service";
import { getInterestCatalogue, listBrowsableTopics } from "@/features/topics/catalogue.service";
import { deleteTopic, getTopicSections, setTopicPublished } from "@/features/topics/topics.service";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { clearDatabase, createTestClient } from "./helpers";
import { createActor } from "./phase3-helpers";

let prisma: PrismaClient;
let person: Actor;
let editor: Actor;
let counter = 0;

const next = () => {
  counter += 1;
  return counter;
};

async function errorCodeOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : `UNEXPECTED: ${String(error)}`;
  }
}

const topic = (title: string, extra: Record<string, unknown> = {}) =>
  prisma.topic.create({ data: { title, slug: `t-${next()}`, status: "PUBLISHED", displayOrder: counter, ...extra } });

const channel = (title: string, topicIds: string[] = []) =>
  prisma.youTubeChannel.create({
    data: { youtubeChannelId: `UC${next()}`, title, metadataFetchedAt: new Date(), topics: { create: topicIds.map((topicId) => ({ topicId })) } },
  });

const video = (channelId: string | null, extra: Record<string, unknown> = {}) => {
  const number = next();
  return prisma.video.create({
    data: {
      youtubeVideoId: `v${String(number).padStart(10, "0")}`,
      kind: "SHORT",
      classification: "SHORT_CANDIDATE",
      status: "PUBLISHED",
      availability: "AVAILABLE",
      title: `مقطع ${number}`,
      feedKey: number * 1000,
      channelId,
      metadataFetchedAt: new Date(),
      ...extra,
    },
  });
};

/** Every video the feed would ever show this request, across all its pages. */
async function feedVideoIds(actor: Actor | null, request: Parameters<typeof getFeedPage>[1] = {}) {
  const ids: string[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < 50; page += 1) {
    const result = await getFeedPage(actor, { ...request, cursor });
    ids.push(...result.items.map((item) => item.id));
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return ids;
}

const guest = (selectedTopicIds: string[], channelChoices: Record<string, boolean> = {}) => ({ guest: { selectedTopicIds, channelChoices, behaviour: {} } });

beforeAll(() => {
  prisma = createTestClient();
});

beforeEach(async () => {
  await clearDatabase(prisma);
  person = await createActor(prisma, "USER");
  editor = await createActor(prisma, "EDITOR");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("a video's topics follow its channel", () => {
  it("a topic page shows every video of its channels, including ones added later", async () => {
    const fiqh = await topic("الفقه");
    const inTopic = await channel("قناة الفقه", [fiqh.id]);
    const other = await channel("قناة أخرى");
    const first = await video(inTopic.id);
    await video(other.id);

    expect((await getTopicSections(fiqh.id, null)).shorts.items.map((item) => item.id)).toEqual([first.id]);

    const later = await video(inTopic.id);
    expect((await getTopicSections(fiqh.id, null)).shorts.items.map((item) => item.id).sort()).toEqual([first.id, later.id].sort());
  });

  it("assigning or removing a channel moves all its videos at once", async () => {
    const fiqh = await topic("الفقه");
    const source = await channel("قناة");
    await video(source.id);
    await video(source.id);
    expect((await getTopicSections(fiqh.id, null)).shorts.items).toHaveLength(0);

    await addLink(editor, { kind: "topic.channel", ownerId: fiqh.id, targetId: source.id });
    expect((await getTopicSections(fiqh.id, null)).shorts.items).toHaveLength(2);

    await removeLink(editor, { kind: "channel.topic", ownerId: source.id, targetId: fiqh.id });
    expect((await getTopicSections(fiqh.id, null)).shorts.items).toHaveLength(0);
  });

  it("the two sides of the link are one record, and adding it twice changes nothing", async () => {
    const fiqh = await topic("الفقه");
    const source = await channel("قناة");
    await addLink(editor, { kind: "channel.topic", ownerId: source.id, targetId: fiqh.id });

    expect((await listLinks(editor, { kind: "topic.channel", ownerId: fiqh.id })).items.map((row) => row.id)).toEqual([source.id]);
    await addLink(editor, { kind: "topic.channel", ownerId: fiqh.id, targetId: source.id });
    expect(await prisma.channelTopic.count()).toBe(1);
  });

  it("only people who manage topics can change the link, and it's audited", async () => {
    const fiqh = await topic("الفقه");
    const source = await channel("قناة");
    const contributor = await createActor(prisma, "CONTRIBUTOR");

    expect(await errorCodeOf(addLink(person, { kind: "channel.topic", ownerId: source.id, targetId: fiqh.id }))).toBe("FORBIDDEN");
    expect(await errorCodeOf(addLink(contributor, { kind: "channel.topic", ownerId: source.id, targetId: fiqh.id }))).toBe("FORBIDDEN");
    expect(await errorCodeOf(addLink(null, { kind: "topic.channel", ownerId: fiqh.id, targetId: source.id }))).toBe("UNAUTHENTICATED");
    expect(await prisma.channelTopic.count()).toBe(0);

    await addLink(editor, { kind: "channel.topic", ownerId: source.id, targetId: fiqh.id });
    expect(await prisma.auditLog.count({ where: { actorId: editor.id, entityType: "YouTubeChannel", entityId: source.id, action: "link.add" } })).toBe(1);
  });

  it("a video card names its channel's published topics only", async () => {
    const shown = await topic("منشور");
    const hidden = await topic("مسودة", { status: "DRAFT" });
    const source = await channel("قناة", [shown.id, hidden.id]);
    await video(source.id);

    const { items } = await getFeedPage(null, {});
    expect(items[0]!.topics.map((item) => item.title)).toEqual(["منشور"]);
  });

  it("deleting a topic leaves channels, videos, and people's other choices alone", async () => {
    const kept = await topic("باق");
    const removed = await topic("محذوف");
    const source = await channel("قناة", [kept.id, removed.id]);
    await video(source.id);
    await saveInterests(person, { topicIds: [kept.id, removed.id], channelChoices: {} });

    const admin = await createActor(prisma, "ADMIN");
    await deleteTopic(admin, removed.id);

    expect(await prisma.channelTopic.count({ where: { topicId: removed.id } })).toBe(0);
    expect(await prisma.channelTopic.count({ where: { topicId: kept.id } })).toBe(1);
    expect(await prisma.userInterest.count({ where: { topicId: removed.id } })).toBe(0);
    expect(await prisma.userInterest.count({ where: { topicId: kept.id } })).toBe(1);
    expect(await prisma.video.count()).toBe(1);
  });

  it("staff can find channels by name, without ones whose YouTube data was withdrawn", async () => {
    await channel("قناة النور");
    await channel("قناة أخرى");
    await prisma.youTubeChannel.create({ data: { youtubeChannelId: "UCgone", title: "" } });

    expect((await searchPicker(editor, { type: "CHANNEL", query: "النور" })).map((row) => row.label)).toEqual(["قناة النور"]);
    expect(await searchPicker(editor, { type: "CHANNEL", query: "" })).toHaveLength(2);
    expect(await errorCodeOf(searchPicker(person, { type: "CHANNEL", query: "" }))).toBe("FORBIDDEN");
  });
});

describe("the catalogue behind first-visit choices", () => {
  it("offers only topics with a channel that has something public to watch", async () => {
    const withVideos = await topic("فيه مقاطع");
    const onlyDrafts = await topic("مسودات فقط");
    await topic("بلا قناة");
    await topic("غير منشور", { status: "DRAFT" });

    await video((await channel("نشطة", [withVideos.id])).id);
    await video((await channel("مسودات", [onlyDrafts.id])).id, { status: "DRAFT" });

    const { topics, channels } = await getInterestCatalogue();
    expect(topics.map((item) => item.title)).toEqual(["فيه مقاطع"]);
    expect(channels.map((item) => item.title)).toEqual(["نشطة"]);
  });

  it("counts a channel's public videos, and offers channels with no topic too", async () => {
    const source = await channel("بلا موضوع");
    await video(source.id);
    await video(source.id);
    await video(source.id, { status: "DRAFT" });
    await video(source.id, { isArchived: true });
    await video(source.id, { availability: "UNAVAILABLE" });

    const { channels } = await getInterestCatalogue();
    expect(channels).toEqual([expect.objectContaining({ id: source.id, videoCount: 2, topicIds: [] })]);
  });

  it("doesn't offer a channel whose YouTube data was withdrawn", async () => {
    const fiqh = await topic("الفقه");
    await video((await channel("", [fiqh.id])).id);
    const { topics, channels } = await getInterestCatalogue();
    expect(topics).toEqual([]);
    expect(channels).toEqual([]);
  });

  it("browsing chips skip topics with no channel", async () => {
    const withChannel = await topic("فيه قناة");
    await topic("بلا قناة");
    await channel("قناة", [withChannel.id]);
    expect((await listBrowsableTopics()).map((item) => item.title)).toEqual(["فيه قناة"]);
  });
});

describe("the feed respects channel choices", () => {
  async function library() {
    const [fiqh, seerah] = [await topic("الفقه"), await topic("السيرة")];
    const [fiqhChannel, seerahChannel, bothChannel, noTopicChannel] = [await channel("فقه", [fiqh.id]), await channel("سيرة", [seerah.id]), await channel("كلاهما", [fiqh.id, seerah.id]), await channel("بلا موضوع")];
    const videos = {
      fiqh: (await video(fiqhChannel.id)).id,
      seerah: (await video(seerahChannel.id)).id,
      both: (await video(bothChannel.id)).id,
      noTopic: (await video(noTopicChannel.id)).id,
      noChannel: (await video(null)).id,
    };
    return { fiqh, seerah, fiqhChannel, seerahChannel, bothChannel, noTopicChannel, videos };
  }

  const sorted = (ids: string[]) => [...ids].sort();

  it("with nothing chosen, everything plays", async () => {
    const { videos } = await library();
    expect(sorted(await feedVideoIds(null))).toEqual(sorted(Object.values(videos)));
    expect(sorted(await feedVideoIds(person))).toEqual(sorted(Object.values(videos)));
  });

  it("a chosen topic turns on its channels only, including one shared with another topic", async () => {
    const { fiqh, videos } = await library();
    expect(sorted(await feedVideoIds(null, guest([fiqh.id])))).toEqual(sorted([videos.fiqh, videos.both]));

    await saveInterests(person, { topicIds: [fiqh.id], channelChoices: {} });
    expect(sorted(await feedVideoIds(person))).toEqual(sorted([videos.fiqh, videos.both]));
  });

  it("switching a channel on or off beats its topics", async () => {
    const { fiqh, fiqhChannel, seerahChannel, videos } = await library();
    const choices = { [fiqhChannel.id]: false, [seerahChannel.id]: true };
    expect(sorted(await feedVideoIds(null, guest([fiqh.id], choices)))).toEqual(sorted([videos.seerah, videos.both]));

    await saveInterests(person, { topicIds: [fiqh.id], channelChoices: choices });
    expect(sorted(await feedVideoIds(person))).toEqual(sorted([videos.seerah, videos.both]));
  });

  it("a channel switched off with nothing chosen stays off", async () => {
    const { fiqhChannel, videos } = await library();
    expect(await feedVideoIds(null, guest([], { [fiqhChannel.id]: false }))).not.toContain(videos.fiqh);
  });

  it("everything off gives an empty feed, not an error", async () => {
    const { fiqh, fiqhChannel, bothChannel } = await library();
    const page = await getFeedPage(null, guest([fiqh.id], { [fiqhChannel.id]: false, [bothChannel.id]: false }));
    expect(page).toEqual({ items: [], nextCursor: null });
  });

  it("exploration can never bring back a channel that's off", async () => {
    const { fiqh, videos } = await library();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const ids = await feedVideoIds(null, guest([fiqh.id]));
      expect(ids).not.toContain(videos.seerah);
      expect(ids).not.toContain(videos.noTopic);
    }
  });

  it("a topic tab shows that topic, without its switched-off channels", async () => {
    const { seerah, seerahChannel, videos } = await library();
    expect(sorted(await feedVideoIds(null, { topicId: seerah.id }))).toEqual(sorted([videos.seerah, videos.both]));
    expect(await feedVideoIds(null, { topicId: seerah.id, ...guest([], { [seerahChannel.id]: false }) })).toEqual([videos.both]);
  });

  it("a video in two topics appears once", async () => {
    const { fiqh, seerah, videos } = await library();
    const ids = await feedVideoIds(null, guest([fiqh.id, seerah.id]));
    expect(ids.filter((id) => id === videos.both)).toHaveLength(1);
  });

  it("a channel added later follows the person's topics with nothing rewritten", async () => {
    const { fiqh, seerah } = await library();
    await saveInterests(person, { topicIds: [fiqh.id], channelChoices: {} });

    const wanted = await video((await channel("جديدة في الفقه", [fiqh.id])).id);
    const unwanted = await video((await channel("جديدة في السيرة", [seerah.id])).id);

    const ids = await feedVideoIds(person);
    expect(ids).toContain(wanted.id);
    expect(ids).not.toContain(unwanted.id);
  });

  it("if every chosen topic is unpublished, nothing stays switched off because of it", async () => {
    const { fiqh, videos } = await library();
    await saveInterests(person, { topicIds: [fiqh.id], channelChoices: {} });
    await setTopicPublished(await createActor(prisma, "ADMIN"), fiqh.id, false);
    expect(await feedVideoIds(person)).toContain(videos.seerah);
  });

  it("someone else's choices don't affect this person", async () => {
    const { fiqh, videos } = await library();
    const other = await createActor(prisma, "USER");
    await saveInterests(other, { topicIds: [fiqh.id], channelChoices: {} });
    expect(sorted(await feedVideoIds(person))).toEqual(sorted(Object.values(videos)));
  });

  it("guest hints are ignored once signed in, so they can't change an account's feed", async () => {
    const { fiqh, videos } = await library();
    await saveInterests(person, { topicIds: [fiqh.id], channelChoices: {} });
    const ids = await feedVideoIds(person, guest([], {}));
    expect(sorted(ids)).toEqual(sorted([videos.fiqh, videos.both]));
  });

  it("rejects malformed guest hints", async () => {
    await library();
    expect(await errorCodeOf(getFeedPage(null, { guest: { selectedTopicIds: ["nope"], channelChoices: {}, behaviour: {} } }))).toBe("VALIDATION");
    expect(await errorCodeOf(getFeedPage(null, { guest: { selectedTopicIds: [], channelChoices: { nope: true }, behaviour: {} } }))).toBe("VALIDATION");
    expect(await errorCodeOf(getFeedPage(null, { topicId: "nope" }))).toBe("VALIDATION");
  });

  it("refuses an unpublished topic's tab", async () => {
    const draft = await topic("مسودة", { status: "DRAFT" });
    expect(await errorCodeOf(getFeedPage(null, { topicId: draft.id }))).toBe("NOT_FOUND");
  });
});

describe("saving choices", () => {
  it("stores only what was switched, and reset clears it all", async () => {
    const fiqh = await topic("الفقه");
    const source = await channel("قناة", [fiqh.id]);

    const saved = await saveInterests(person, { topicIds: [fiqh.id], channelChoices: { [source.id]: false } });
    expect(saved).toEqual({ selectedTopicIds: [fiqh.id], channelChoices: { [source.id]: false }, onboarding: "pending" });

    const cleared = await resetInterests(person);
    expect(cleared).toEqual({ selectedTopicIds: [], channelChoices: {}, onboarding: "pending" });
    expect(await prisma.userChannelChoice.count({ where: { userId: person.id } })).toBe(0);
  });

  it("saving replaces earlier switches rather than piling up", async () => {
    const [a, b] = [await channel("أ"), await channel("ب")];
    await saveInterests(person, { topicIds: [], channelChoices: { [a.id]: false } });
    const saved = await saveInterests(person, { topicIds: [], channelChoices: { [b.id]: false } });
    expect(saved.channelChoices).toEqual({ [b.id]: false });
  });

  it("refuses channels that don't exist and topics that aren't public", async () => {
    const draft = await topic("مسودة", { status: "DRAFT" });
    const ghost = "a".repeat(24);
    expect(await errorCodeOf(saveInterests(person, { topicIds: [draft.id], channelChoices: {} }))).toBe("VALIDATION");
    expect(await errorCodeOf(saveInterests(person, { topicIds: [], channelChoices: { [ghost]: true } }))).toBe("VALIDATION");
    expect(await errorCodeOf(saveInterests(null, { topicIds: [], channelChoices: {} }))).toBe("UNAUTHENTICATED");
  });

  it("one person's save leaves another's alone", async () => {
    const source = await channel("قناة");
    const other = await createActor(prisma, "USER");
    await saveInterests(other, { topicIds: [], channelChoices: { [source.id]: false } });
    await saveInterests(person, { topicIds: [], channelChoices: {} });
    expect(await prisma.userChannelChoice.count({ where: { userId: other.id } })).toBe(1);
  });

  it("a guest's switches join the account, which wins where both decided, and old ones are dropped", async () => {
    const [mine, theirs] = [await channel("أ"), await channel("ب")];
    const gone = "b".repeat(24);
    await saveInterests(person, { topicIds: [], channelChoices: { [mine.id]: true } });

    const merged = await mergeGuestPreferences(person, {
      version: 2,
      selectedTopicIds: [],
      channelChoices: { [mine.id]: false, [theirs.id]: false, [gone]: true },
      onboarding: "completed",
    });
    expect(merged.channelChoices).toEqual({ [mine.id]: true, [theirs.id]: false });
    expect(merged.onboarding).toBe("completed");
  });

  it("merging twice changes nothing", async () => {
    const source = await channel("أ");
    const payload = { version: 2, selectedTopicIds: [], channelChoices: { [source.id]: false }, onboarding: "skipped" };
    const first = await mergeGuestPreferences(person, payload);
    expect(await mergeGuestPreferences(person, payload)).toEqual(first);
    expect(await prisma.userChannelChoice.count({ where: { userId: person.id } })).toBe(1);
  });

  it("deleting an account removes its channel choices", async () => {
    const source = await channel("أ");
    await saveInterests(person, { topicIds: [], channelChoices: { [source.id]: false } });
    await prisma.user.delete({ where: { id: person.id } });
    expect(await prisma.userChannelChoice.count()).toBe(0);
  });
});

describe("signals", () => {
  it("count towards every published topic of the video's channel, and nothing else", async () => {
    const [a, b, draft, other] = [await topic("أ"), await topic("ب"), await topic("مسودة", { status: "DRAFT" }), await topic("أخرى")];
    const source = await video((await channel("قناة", [a.id, b.id, draft.id])).id);

    await recordVideoSignal(person, { videoId: source.id, signal: "completion" });

    const interests = await prisma.userInterest.findMany({ where: { userId: person.id } });
    expect(interests.map((item) => item.topicId).sort()).toEqual([a.id, b.id].sort());
    expect(interests.every((item) => item.behaviourScore > 0)).toBe(true);
    expect(interests.map((item) => item.topicId)).not.toContain(other.id);
  });

  it("from a channel with no topic are recorded but move no score", async () => {
    const source = await video((await channel("قناة")).id);
    await recordVideoSignal(person, { videoId: source.id, signal: "completion" });
    expect(await prisma.userActivity.count({ where: { userId: person.id, channelId: source.channelId! } })).toBe(1);
    expect(await prisma.userInterest.count({ where: { userId: person.id } })).toBe(0);
  });

  it("on repeated completions of a channel add the repeated-engagement bonus", async () => {
    const fiqh = await topic("الفقه");
    const source = await channel("قناة", [fiqh.id]);
    const now = new Date();
    for (let index = 0; index < 2; index += 1) await recordVideoSignal(person, { videoId: (await video(source.id)).id, signal: "completion" }, now);
    const beforeThird = (await prisma.userInterest.findFirstOrThrow({ where: { userId: person.id } })).behaviourScore;

    await recordVideoSignal(person, { videoId: (await video(source.id)).id, signal: "completion" }, now);
    const afterThird = (await prisma.userInterest.findFirstOrThrow({ where: { userId: person.id } })).behaviourScore;

    expect(afterThird - beforeThird).toBeCloseTo(0.75);
  });
});
