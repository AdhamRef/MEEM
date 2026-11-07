import { z } from "zod";
import { isSafeImageSrc } from "@/lib/content/document";
import { isValidSlug } from "@/lib/slug";

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);

export const slugSchema = z.string().trim().refine(isValidSlug);

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const topicInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  slug: slugSchema.optional(),
  introduction: optionalText(1000),
  description: optionalText(5000),
  coverImage: z.string().trim().refine(isSafeImageSrc).nullable().optional(),
  parentId: objectIdSchema.nullable().optional(),
  isFeatured: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(100_000).optional(),
});

export const topicUpdateSchema = topicInputSchema.partial();
