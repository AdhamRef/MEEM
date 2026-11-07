import type { PrismaClient } from "@prisma/client";
import { buildSearchText, normalizeArabicForSearch } from "@/lib/search/normalize";

interface SeedTopic {
  title: string;
  slug: string;
  introduction: string;
}

/**
 * Starting topics, from the list in specification §10. This is data for the first setup only:
 * the application reads topics from the database, and editors change them from there.
 */
export const SEED_TOPICS: SeedTopic[] = [
  { title: "العقيدة", slug: "العقيدة", introduction: "أصول الإيمان ومسائله." },
  { title: "الفقه", slug: "الفقه", introduction: "أحكام العبادات والمعاملات." },
  { title: "القرآن وعلومه", slug: "القرآن-وعلومه", introduction: "تدبر القرآن الكريم وتفسيره وعلومه." },
  { title: "السيرة النبوية", slug: "السيرة-النبوية", introduction: "حياة النبي ﷺ ومواقفها ودروسها." },
  { title: "التاريخ الإسلامي", slug: "التاريخ-الإسلامي", introduction: "أحداث التاريخ الإسلامي وأعلامه." },
  { title: "التزكية", slug: "التزكية", introduction: "إصلاح القلب وتهذيب النفس." },
  { title: "الدفاع عن الإسلام", slug: "الدفاع-عن-الإسلام", introduction: "ردود علمية على ما يُثار حول الإسلام." },
  { title: "الإلحاد والشبهات الفكرية", slug: "الإلحاد-والشبهات-الفكرية", introduction: "نقاش هادئ لأسئلة الإلحاد والشبهات." },
  { title: "مقارنة الأديان", slug: "مقارنة-الأديان", introduction: "دراسة الأديان ومقارنتها بالإسلام." },
  { title: "النبوة", slug: "النبوة", introduction: "دلائل النبوة وحقيقتها." },
  { title: "القضايا المعاصرة", slug: "القضايا-المعاصرة", introduction: "أسئلة الواقع المعاصر من منظور إسلامي." },
  { title: "الآداب الإسلامية", slug: "الآداب-الإسلامية", introduction: "الأخلاق والآداب في الحياة اليومية." },
];

export interface SeedResult {
  created: string[];
  alreadyPresent: number;
}

/**
 * Only adds what's missing, so running it again never overwrites an editor's changes. They start
 * published because a topic only reaches first-visit choices once it has channels, and giving it
 * channels is the part only staff can do.
 */
export async function seedTopics(prisma: PrismaClient): Promise<SeedResult> {
  const existing = await prisma.topic.findMany({ where: { slug: { in: SEED_TOPICS.map((topic) => topic.slug) } }, select: { slug: true } });
  const existingSlugs = new Set(existing.map((topic) => topic.slug));

  const created: string[] = [];
  for (const [index, topic] of SEED_TOPICS.entries()) {
    if (existingSlugs.has(topic.slug)) continue;
    // upsert with no update, so two simultaneous runs can't fail or change an existing record.
    await prisma.topic.upsert({
      where: { slug: topic.slug },
      update: {},
      create: {
        ...topic,
        status: "PUBLISHED",
        publishedAt: new Date(),
        displayOrder: (index + 1) * 10,
        titleSearch: normalizeArabicForSearch(topic.title),
        searchText: buildSearchText([topic.title, topic.introduction]),
      },
    });
    created.push(topic.slug);
  }

  if (created.length > 0) {
    await prisma.auditLog.create({ data: { actorEmail: "system:seed-topics", action: "topic.seed", entityType: "Topic", metadata: { created } } });
  }

  return { created, alreadyPresent: existingSlugs.size };
}
