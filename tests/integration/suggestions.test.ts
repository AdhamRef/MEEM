import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPublicVideo } from "@/features/shorts/feed.service";
import { listVideoSuggestions } from "@/features/shorts/suggestions.service";
import { clearDatabase, createTestClient } from "./helpers";

process.env.APP_URL = "http://localhost:3000";

let prisma: PrismaClient;
let counter = 0;

async function channel(title: string) {
  counter += 1;
  return prisma.youTubeChannel.create({ data: { youtubeChannelId: `UC${String(counter).padStart(22, "0")}`, title, metadataFetchedAt: new Date() } });
}

async function video(channelId: string, options: { kind?: "SHORT" | "LONG_FORM"; status?: "PUBLISHED" | "DRAFT"; daysAgo?: number; feedKey?: number } = {}) {
  counter += 1;
  const kind = options.kind ?? "LONG_FORM";
  return prisma.video.create({
    data: {
      youtubeVideoId: `v${String(counter).padStart(10, "0")}`,
      kind,
      classification: kind === "SHORT" ? "SHORT_CANDIDATE" : "LONG_FORM_CANDIDATE",
      status: options.status ?? "PUBLISHED",
      availability: "AVAILABLE",
      title: `مقطع ${counter}`,
      channelId,
      ytPublishedAt: new Date(Date.now() - (options.daysAgo ?? counter) * 86_400_000),
      metadataFetchedAt: new Date(),
      feedKey: options.feedKey ?? counter * 10,
    },
  });
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

describe("video suggestions", () => {
  it("puts the channel's newest videos first, interleaved with videos from channels sharing a topic", async () => {
    const main = await channel("الرئيسية");
    const related = await channel("ذات صلة");
    const other = await channel("أخرى");
    const topic = await prisma.topic.create({ data: { title: "موضوع", slug: "t", status: "PUBLISHED" } });
    await prisma.channelTopic.createMany({ data: [{ channelId: main.id, topicId: topic.id }, { channelId: related.id, topicId: topic.id }] });

    const current = await video(main.id);
    const newer = await video(main.id, { daysAgo: 1 });
    const older = await video(main.id, { daysAgo: 50 });
    const relatedVideo = await video(related.id);
    const otherVideo = await video(other.id);

    const card = (await getPublicVideo(current.id))!;
    const { upNext } = await listVideoSuggestions(card);
    expect(upNext.map((item) => item.id)).toEqual([newer.id, relatedVideo.id, older.id, otherVideo.id]);
  });

  it("never suggests the video itself, a draft, a Short, or one twice, and lists the channel's Shorts apart", async () => {
    const main = await channel("الرئيسية");
    const current = await video(main.id);
    await video(main.id, { status: "DRAFT" });
    const short = await video(main.id, { kind: "SHORT" });
    const other = await video(main.id);

    const { upNext, shorts } = await listVideoSuggestions((await getPublicVideo(current.id))!);
    expect(upNext.map((item) => item.id)).toEqual([other.id]);
    expect(shorts.map((item) => item.id)).toEqual([short.id]);
  });

  it("fills up from the rest of the library, starting after this video in the feed order and wrapping around", async () => {
    const main = await channel("الرئيسية");
    const elsewhere = await channel("بعيدة");
    const current = await video(main.id, { feedKey: 500 });
    const before = await video(elsewhere.id, { feedKey: 100 });
    const after = await video(elsewhere.id, { feedKey: 900 });

    const { upNext } = await listVideoSuggestions((await getPublicVideo(current.id))!);
    expect(upNext.map((item) => item.id)).toEqual([after.id, before.id]);
  });
});
