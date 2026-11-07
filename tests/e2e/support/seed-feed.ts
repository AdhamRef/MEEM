import type { PrismaClient } from "@prisma/client";

export const SEEDED_SHORTS_PER_TOPIC = 5;
export const SEEDED_TOPIC_SLUGS = ["الفقه", "العقيدة", "النبوة", "التزكية"];

/** What a person with no saved choices looks like in the browser, past the first-visit choices. */
export const SKIPPED_FIRST_VISIT = JSON.stringify({ version: 2, selectedTopicIds: [], channelChoices: {}, onboarding: "skipped" });

/** Fixed 11-character IDs, so a reused database stays the same. They exist only in this test database. */
const youtubeId = (group: string, index: number) => `e2e${group}${String(index).padStart(6, "0")}`;

const thumbnails = (id: string) => [{ quality: "high", url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480, height: 360 }];

const fields = (id: string, title: string, channelTitle: string) => ({
  kind: "SHORT" as const,
  classification: "SHORT_CANDIDATE" as const,
  reviewedAt: new Date(),
  status: "PUBLISHED" as const,
  publishedAt: new Date(),
  availability: "AVAILABLE" as const,
  title,
  description: "وصف المقطع للاختبار",
  channelTitle,
  thumbnails: thumbnails(id),
  durationSeconds: 45,
  metadataFetchedAt: new Date(),
});

export const seededChannelTitle = (slug: string) => `قناة ${slug}`;

/** One channel per seeded topic, and every video follows its channel into that topic. */
async function seedChannel(prisma: PrismaClient, slug: string, index: number) {
  const topic = await prisma.topic.findUniqueOrThrow({ where: { slug } });
  const youtubeChannelId = `UCe2e${String(index).padStart(19, "0")}`;
  const data = { title: seededChannelTitle(slug), handle: `@e2e${index}`, metadataFetchedAt: new Date(), isActive: true };
  const channel = await prisma.youTubeChannel.upsert({ where: { youtubeChannelId }, update: data, create: { youtubeChannelId, ...data } });
  await prisma.channelTopic.upsert({
    where: { channelId_topicId: { channelId: channel.id, topicId: topic.id } },
    update: {},
    create: { channelId: channel.id, topicId: topic.id },
  });
  return channel;
}

export async function seedFeed(prisma: PrismaClient): Promise<void> {
  let feedKey = 1000;

  for (const [topicIndex, slug] of SEEDED_TOPIC_SLUGS.entries()) {
    const channel = await seedChannel(prisma, slug, topicIndex);

    for (let index = 0; index < SEEDED_SHORTS_PER_TOPIC; index += 1) {
      const id = youtubeId(`c${topicIndex}`, index);
      feedKey += 1000;
      const data = { ...fields(id, `مقطع ${slug} ${index + 1}`, channel.title), channelId: channel.id, feedKey };
      await prisma.video.upsert({ where: { youtubeVideoId: id }, update: data, create: { youtubeVideoId: id, ...data } });
    }
  }

  const channel = await prisma.youTubeChannel.findFirstOrThrow({ where: { title: seededChannelTitle("الفقه") } });
  const special = async (id: string, title: string, extra: Record<string, unknown>) => {
    feedKey += 1000;
    const data = { ...fields(id, title, channel.title), channelId: channel.id, feedKey, ...extra };
    return prisma.video.upsert({ where: { youtubeVideoId: id }, update: data, create: { youtubeVideoId: id, ...data } });
  };

  // These must never appear in a feed.
  await special("e2eDraft000", "مقطع مسودة مخفي", { status: "DRAFT" });
  await special("e2eArchive0", "مقطع مؤرشف مخفي", { isArchived: true });
  await special("e2eNoEmbed0", "مقطع لا يقبل التضمين مخفي", { availability: "NOT_EMBEDDABLE" });
  await special("e2eGone0000", "مقطع محذوف مخفي", { availability: "UNAVAILABLE" });

  // A long video, reachable through its own page and a CTA, but not in the Shorts feed.
  const longVideo = await special("e2eLong0000", "محاضرة كاملة للاختبار", { kind: "LONG_FORM", classification: "LONG_FORM_CANDIDATE", durationSeconds: 3600 });

  await special("e2eCtaFull0", "مقطع مع رابط محاضرة", { cta: { type: "FULL_VIDEO", targetId: longVideo.id, label: "شاهد المحاضرة" } });
  await special("e2eCtaExt00", "مقطع مع رابط خارجي", { cta: { type: "EXTERNAL_RESOURCE", externalUrl: "https://example.org/read", label: "اقرأ المقال" } });
}
