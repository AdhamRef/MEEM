import type { ContentType, CtaType, Prisma } from "@prisma/client";

const CTA_TYPES_BY_TARGET: Partial<Record<ContentType, CtaType[]>> = {
  ARTICLE: ["INTERNAL_ARTICLE"],
  TOPIC: ["TOPIC"],
  RESOURCE: ["EXTERNAL_RESOURCE"],
  PLAYLIST: ["CURATED_PLAYLIST", "YOUTUBE_PLAYLIST"],
  VIDEO: ["FULL_VIDEO"],
};

/**
 * Join rows go through Prisma's relations, but these point at content by type and ID, so
 * nothing removes them automatically. Called when content is permanently deleted, in the
 * same transaction, so no reference is left pointing at nothing (§20.3).
 */
export async function purgeContentReferences(tx: Prisma.TransactionClient, type: ContentType, id: string): Promise<void> {
  await tx.contentRelation.deleteMany({ where: { OR: [{ sourceType: type, sourceId: id }, { targetType: type, targetId: id }] } });
  await tx.collectionItem.deleteMany({ where: { entityType: type, entityId: id } });
  await tx.favorite.deleteMany({ where: { entityType: type, entityId: id } });
  await tx.userActivity.deleteMany({ where: { entityType: type, entityId: id } });
  await tx.reviewNote.deleteMany({ where: { entityType: type, entityId: id } });

  const ctaTypes = CTA_TYPES_BY_TARGET[type];
  if (ctaTypes) await tx.video.updateMany({ where: { cta: { is: { targetId: id, type: { in: ctaTypes } } } }, data: { cta: { unset: true } } });
}

/** Prisma can't remove one value from an array across many documents, and this can be thousands. */
export async function pullFromVideoArray(tx: Prisma.TransactionClient, field: "libraryIds", id: string, videoIds?: string[]): Promise<void> {
  const value = { $oid: id };
  const query: Prisma.InputJsonObject = videoIds ? { [field]: value, _id: { $in: videoIds.map((videoId) => ({ $oid: videoId })) } } : { [field]: value };
  await tx.$runCommandRaw({ update: "Video", updates: [{ q: query, u: { $pull: { [field]: value } }, multi: true }] });
}
