import type { PrismaClient } from "@prisma/client";

export const SEEDED_SHORTS_PER_CATEGORY = 5;
export const SEEDED_CATEGORY_SLUGS = ["الفقه", "العقيدة", "النبوة", "التزكية"];

/** Fixed 11-character IDs, so a reused database stays the same. They exist only in this test database. */
const youtubeId = (group: string, index: number) => `e2e${group}${String(index).padStart(6, "0")}`;

const thumbnails = (id: string) => [{ quality: "high", url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480, height: 360 }];

const fields = (id: string, title: string) => ({
  kind: "SHORT" as const,
  classification: "SHORT_CANDIDATE" as const,
  reviewedAt: new Date(),
  status: "PUBLISHED" as const,
  publishedAt: new Date(),
  availability: "AVAILABLE" as const,
  title,
  description: "وصف المقطع للاختبار",
  channelTitle: "قناة الاختبار",
  thumbnails: thumbnails(id),
  durationSeconds: 45,
  metadataFetchedAt: new Date(),
});

export async function seedFeed(prisma: PrismaClient): Promise<void> {
  let feedKey = 1000;

  for (const [categoryIndex, slug] of SEEDED_CATEGORY_SLUGS.entries()) {
    const category = await prisma.category.findUniqueOrThrow({ where: { slug } });

    for (let index = 0; index < SEEDED_SHORTS_PER_CATEGORY; index += 1) {
      const id = youtubeId(`c${categoryIndex}`, index);
      feedKey += 1000;
      const data = { ...fields(id, `مقطع ${slug} ${index + 1}`), categoryId: category.id, feedKey };
      await prisma.video.upsert({ where: { youtubeVideoId: id }, update: data, create: { youtubeVideoId: id, ...data } });
    }
  }

  const category = await prisma.category.findUniqueOrThrow({ where: { slug: "الفقه" } });
  const special = async (id: string, title: string, extra: Record<string, unknown>) => {
    feedKey += 1000;
    const data = { ...fields(id, title), categoryId: category.id, feedKey, ...extra };
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
