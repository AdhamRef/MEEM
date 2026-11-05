import { z } from "zod";
import { recordAudit } from "@/features/admin/audit";
import { objectIdSchema } from "@/features/categories/schemas";
import { AppError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/permissions";
import { withTransaction } from "@/lib/prisma/transaction";

const httpUrlSchema = z.url({ protocol: /^https?$/ });
const ctaLabelSchema = z.string().trim().min(1).max(60).nullable().optional();

/** A CTA is optional and set by staff (§5.3). Types whose pages don't exist yet are stored but not shown. */
const ctaSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("EXTERNAL_RESOURCE"), label: ctaLabelSchema, externalUrl: httpUrlSchema }),
  z.strictObject({
    type: z.enum(["FULL_VIDEO", "INTERNAL_ARTICLE", "CURATED_PLAYLIST", "YOUTUBE_PLAYLIST", "TOPIC"]),
    label: ctaLabelSchema,
    targetId: objectIdSchema,
  }),
]);

const assignmentSchema = z.strictObject({
  kind: z.enum(["SHORT", "LONG_FORM"]).optional(),
  categoryId: objectIdSchema.nullable().optional(),
  cta: ctaSchema.nullable().optional(),
});

function parseVideoId(rawId: unknown): string {
  const parsed = objectIdSchema.safeParse(rawId);
  if (!parsed.success) throw new AppError("VALIDATION");
  return parsed.data;
}

/** Assigning a kind is the human review that detection can't replace (§7.2). */
export async function assignVideo(actor: Actor | null, rawId: unknown, rawInput: unknown) {
  assertPermission(actor, "content.editAny");
  const id = parseVideoId(rawId);
  const parsed = assignmentSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const input = parsed.data;

  return withTransaction(async (tx) => {
    const existing = await tx.video.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError("NOT_FOUND");

    if (input.categoryId) {
      const category = await tx.category.findUnique({ where: { id: input.categoryId }, select: { id: true } });
      if (!category) throw new AppError("VALIDATION");
    }

    const video = await tx.video.update({
      where: { id },
      data: { ...input, ...(input.kind ? { reviewedAt: new Date() } : {}) },
    });
    await recordAudit(tx, actor, { action: "video.assign", entityType: "Video", entityId: id, metadata: { changedFields: Object.keys(input) } });
    return video;
  });
}

export async function setVideoPublished(actor: Actor | null, rawId: unknown, isPublished: boolean) {
  assertPermission(actor, "content.publish");
  const id = parseVideoId(rawId);

  return withTransaction(async (tx) => {
    const existing = await tx.video.findUnique({
      where: { id },
      select: { kind: true, categoryId: true, reviewedAt: true, availability: true, isArchived: true, publishedAt: true },
    });
    if (!existing) throw new AppError("NOT_FOUND");

    // Only what would truly fail is refused. A category is optional and can come later, and a
    // person pressing publish is the review that detection can't replace (§7.2).
    if (isPublished && (existing.availability !== "AVAILABLE" || existing.isArchived)) throw new AppError("CONFLICT");

    const video = await tx.video.update({
      where: { id },
      data: {
        status: isPublished ? "PUBLISHED" : "DRAFT",
        publishedAt: isPublished ? (existing.publishedAt ?? new Date()) : existing.publishedAt,
        reviewedAt: isPublished ? (existing.reviewedAt ?? new Date()) : existing.reviewedAt,
      },
    });
    await recordAudit(tx, actor, { action: isPublished ? "video.publish" : "video.unpublish", entityType: "Video", entityId: id });
    return video;
  });
}
