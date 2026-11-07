import type { ContentRelationType, ContentType } from "@prisma/client";
import { z } from "zod";
import { objectIdSchema } from "@/features/topics/schemas";
import { optionalText } from "@/features/content/common";

/** The §13.2 relationships, and what each one can point at. */
export const RELATION_TARGETS: Record<ContentRelationType, ContentType[]> = {
  RELATED_ARTICLE: ["ARTICLE"],
  COMPLEMENTARY_TOPIC: ["TOPIC"],
  FURTHER_READING: ["ARTICLE", "RESOURCE"],
  RESPONSE_TO_OBJECTION: ["ARTICLE"],
  PREREQUISITE: ["ARTICLE", "TOPIC"],
  RELATED_RESOURCE: ["RESOURCE"],
};

export const contentRelationInputSchema = z
  .strictObject({
    targetType: z.enum(["ARTICLE", "TOPIC", "RESOURCE"]),
    targetId: objectIdSchema,
    relationType: z.enum(["RELATED_ARTICLE", "COMPLEMENTARY_TOPIC", "FURTHER_READING", "RESPONSE_TO_OBJECTION", "PREREQUISITE", "RELATED_RESOURCE"]),
    note: optionalText(300),
  })
  .refine((relation) => RELATION_TARGETS[relation.relationType].includes(relation.targetType));

export type ContentRelationInput = z.infer<typeof contentRelationInputSchema>;

/** Self-links are meaningless, and repeats would break the unique index. Returns null on a self-link. */
export function normalizeRelations(sourceType: ContentType, sourceId: string, relations: ContentRelationInput[]): ContentRelationInput[] | null {
  const seen = new Set<string>();
  const unique: ContentRelationInput[] = [];
  for (const relation of relations) {
    if (relation.targetType === sourceType && relation.targetId === sourceId) return null;
    const key = `${relation.relationType}:${relation.targetType}:${relation.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(relation);
  }
  return unique;
}

/** Symmetric pairs have one stored form, so A-B and B-A can't both exist. */
export function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}
