import type { PrismaClient } from "@prisma/client";
import type { CategoryIconName } from "./schemas";

interface SeedCategory {
  title: string;
  slug: string;
  description: string;
  icon: CategoryIconName;
}

/**
 * Starting categories from specification §10. This is data for the first setup only: the
 * application reads categories from the database, and editors change them from there.
 */
export const SEED_CATEGORIES: SeedCategory[] = [
  { title: "العقيدة", slug: "العقيدة", description: "أصول الإيمان ومسائله.", icon: "anchor" },
  { title: "الفقه", slug: "الفقه", description: "أحكام العبادات والمعاملات.", icon: "scale" },
  { title: "القرآن وعلومه", slug: "القرآن-وعلومه", description: "تدبر القرآن الكريم وتفسيره وعلومه.", icon: "book-open" },
  { title: "السيرة النبوية", slug: "السيرة-النبوية", description: "حياة النبي ﷺ ومواقفها ودروسها.", icon: "footprints" },
  { title: "التاريخ الإسلامي", slug: "التاريخ-الإسلامي", description: "أحداث التاريخ الإسلامي وأعلامه.", icon: "landmark" },
  { title: "التزكية", slug: "التزكية", description: "إصلاح القلب وتهذيب النفس.", icon: "heart" },
  { title: "الدفاع عن الإسلام", slug: "الدفاع-عن-الإسلام", description: "ردود علمية على ما يُثار حول الإسلام.", icon: "shield-check" },
  { title: "الإلحاد والشبهات الفكرية", slug: "الإلحاد-والشبهات-الفكرية", description: "نقاش هادئ لأسئلة الإلحاد والشبهات.", icon: "circle-help" },
  { title: "مقارنة الأديان", slug: "مقارنة-الأديان", description: "دراسة الأديان ومقارنتها بالإسلام.", icon: "layers" },
  { title: "النبوة", slug: "النبوة", description: "دلائل النبوة وحقيقتها.", icon: "sunrise" },
  { title: "القضايا المعاصرة", slug: "القضايا-المعاصرة", description: "أسئلة الواقع المعاصر من منظور إسلامي.", icon: "newspaper" },
  { title: "الآداب الإسلامية", slug: "الآداب-الإسلامية", description: "الأخلاق والآداب في الحياة اليومية.", icon: "hand-heart" },
];

export interface SeedResult {
  created: string[];
  alreadyPresent: number;
}

/** Only adds what's missing, so running it again never overwrites an editor's changes. */
export async function seedTaxonomy(prisma: PrismaClient): Promise<SeedResult> {
  const existing = await prisma.category.findMany({
    where: { slug: { in: SEED_CATEGORIES.map((category) => category.slug) } },
    select: { slug: true },
  });
  const existingSlugs = new Set(existing.map((category) => category.slug));

  const created: string[] = [];
  for (const [index, category] of SEED_CATEGORIES.entries()) {
    if (existingSlugs.has(category.slug)) continue;
    // upsert with no update, so two simultaneous runs can't fail or change an existing record.
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: { ...category, displayOrder: (index + 1) * 10 },
    });
    created.push(category.slug);
  }

  if (created.length > 0) {
    await prisma.auditLog.create({
      data: {
        actorEmail: "system:seed-taxonomy",
        action: "category.seed",
        entityType: "Category",
        metadata: { created },
      },
    });
  }

  return { created, alreadyPresent: existingSlugs.size };
}
