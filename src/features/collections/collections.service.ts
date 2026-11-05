import type { ContentType, Prisma } from "@prisma/client";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { strings } from "@/config/strings.ar";
import { recordAudit } from "@/features/admin/audit";
import { objectIdSchema } from "@/features/categories/schemas";
import { conflictOnDuplicate, cursorArgs, optionalText, parseId, parseOptionalCursor, publicContentFilter, resolveSlug, toCursorPage } from "@/features/content/common";
import { resolveInOrder, type ResolvedContent } from "@/features/content/resolve";
import { videoPickerLabel, type PickerItem, type PickerType } from "@/features/relationships/picker.service";
import { AppError, isUniqueConstraintError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";

/** Explore should show what editors chose, without becoming a long list of unrelated cards (§16). */
export const MAX_COLLECTION_ITEMS = 12;
export const MAX_EXPLORE_COLLECTIONS = 6;
const ADMIN_PAGE_SIZE = 25;

export const COLLECTION_ITEM_TYPES = ["TOPIC", "ARTICLE", "VIDEO", "PLAYLIST", "LIBRARY", "RESOURCE"] as const;

export const collectionInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  description: optionalText(500),
  displayOrder: z.number().int().min(0).max(100_000).default(0),
});

function parseInput(rawInput: unknown) {
  const parsed = collectionInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  return parsed.data;
}

const notFoundIfMissing = async <Row>(row: Promise<Row | null>): Promise<Row> => {
  const found = await row;
  if (!found) throw new AppError("NOT_FOUND");
  return found;
};

export async function createCollection(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "topics.manage");
  const input = parseInput(rawInput);

  try {
    return await withTransaction(async (tx) => {
      const slug = await resolveSlug(input.title, null, async (candidate) => (await tx.collection.count({ where: { slug: candidate } })) > 0).catch((error: unknown) => {
        // Titles with no letters or digits make no slug. Nobody sees this one, since collections have no page.
        if (error instanceof AppError && error.code === "VALIDATION") return `collection-${randomInt(1_000_000)}`;
        throw error;
      });
      const collection = await tx.collection.create({ data: { ...input, slug, status: "DRAFT" } });
      await recordAudit(tx, actor, { action: "collection.create", entityType: "Collection", entityId: collection.id, metadata: { title: collection.title } });
      return collection;
    });
  } catch (error) {
    throw conflictOnDuplicate(error);
  }
}

export async function updateCollection(actor: Actor | null, rawId: unknown, rawInput: unknown) {
  assertPermission(actor, "topics.manage");
  const id = parseId(rawId);
  const input = parseInput(rawInput);

  return withTransaction(async (tx) => {
    await notFoundIfMissing(tx.collection.findUnique({ where: { id }, select: { id: true } }));
    const collection = await tx.collection.update({ where: { id }, data: input });
    await recordAudit(tx, actor, { action: "collection.update", entityType: "Collection", entityId: id, metadata: { title: collection.title } });
    return collection;
  });
}

export async function setCollectionPublished(actor: Actor | null, rawId: unknown, isPublished: boolean) {
  assertPermission(actor, "content.publish");
  const id = parseId(rawId);

  await withTransaction(async (tx) => {
    const existing = await notFoundIfMissing(tx.collection.findUnique({ where: { id }, select: { isArchived: true } }));
    if (existing.isArchived && isPublished) throw new AppError("CONFLICT", strings.content.archivedCantPublish);
    await tx.collection.update({ where: { id }, data: { status: isPublished ? "PUBLISHED" : "DRAFT" } });
    await recordAudit(tx, actor, { action: isPublished ? "collection.publish" : "collection.unpublish", entityType: "Collection", entityId: id });
  });
}

export async function setCollectionArchived(actor: Actor | null, rawId: unknown, isArchived: boolean) {
  assertPermission(actor, "content.archive");
  const id = parseId(rawId);

  await withTransaction(async (tx) => {
    await notFoundIfMissing(tx.collection.findUnique({ where: { id }, select: { id: true } }));
    await tx.collection.update({ where: { id }, data: { isArchived } });
    await recordAudit(tx, actor, { action: isArchived ? "collection.archive" : "collection.restore", entityType: "Collection", entityId: id });
  });
}

/** Removes the grouping only. The content inside stays where it is. */
export async function deleteCollection(actor: Actor | null, rawId: unknown): Promise<void> {
  assertPermission(actor, "content.delete");
  const id = parseId(rawId);

  await withTransaction(async (tx) => {
    const existing = await notFoundIfMissing(tx.collection.findUnique({ where: { id }, select: { title: true } }));
    await tx.collectionItem.deleteMany({ where: { collectionId: id } });
    await tx.collection.delete({ where: { id } });
    await recordAudit(tx, actor, { action: "collection.delete", entityType: "Collection", entityId: id, metadata: { title: existing.title } });
  });
}

const addItemSchema = z.strictObject({ collectionId: objectIdSchema, entityType: z.enum(COLLECTION_ITEM_TYPES), entityId: objectIdSchema });

async function itemExists(tx: Prisma.TransactionClient, entityType: ContentType, id: string): Promise<boolean> {
  const where = { id };
  switch (entityType) {
    case "TOPIC":
      return (await tx.topic.count({ where })) > 0;
    case "ARTICLE":
      return (await tx.article.count({ where })) > 0;
    case "VIDEO":
      return (await tx.video.count({ where })) > 0;
    case "PLAYLIST":
      return (await tx.playlist.count({ where })) > 0;
    case "LIBRARY":
      return (await tx.library.count({ where })) > 0;
    case "RESOURCE":
      return (await tx.externalResource.count({ where })) > 0;
  }
}

export async function addCollectionItem(actor: Actor | null, rawInput: unknown): Promise<void> {
  assertPermission(actor, "topics.manage");
  const parsed = addItemSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { collectionId, entityType, entityId } = parsed.data;

  try {
    await withTransaction(async (tx) => {
      await notFoundIfMissing(tx.collection.findUnique({ where: { id: collectionId }, select: { id: true } }));
      if (!(await itemExists(tx, entityType, entityId))) throw new AppError("NOT_FOUND");

      const last = await tx.collectionItem.findFirst({ where: { collectionId }, orderBy: { position: "desc" }, select: { position: true } });
      const count = await tx.collectionItem.count({ where: { collectionId } });
      if (count >= MAX_COLLECTION_ITEMS) throw new AppError("CONFLICT", strings.collections.full(MAX_COLLECTION_ITEMS));

      await tx.collectionItem.create({ data: { collectionId, entityType, entityId, position: (last?.position ?? -1) + 1 } });
      await recordAudit(tx, actor, { action: "collection.item.add", entityType: "Collection", entityId: collectionId, metadata: { itemType: entityType, itemId: entityId } });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new AppError("CONFLICT", strings.collections.duplicate);
    throw error;
  }
}

export async function removeCollectionItem(actor: Actor | null, rawCollectionId: unknown, rawItemId: unknown): Promise<void> {
  assertPermission(actor, "topics.manage");
  const collectionId = parseId(rawCollectionId);
  const itemId = parseId(rawItemId);

  await withTransaction(async (tx) => {
    const { count } = await tx.collectionItem.deleteMany({ where: { id: itemId, collectionId } });
    if (count === 0) throw new AppError("NOT_FOUND");
    await recordAudit(tx, actor, { action: "collection.item.remove", entityType: "Collection", entityId: collectionId, metadata: { itemId } });
  });
}

/** Must name exactly the items in the collection, so a stale screen can't lose or invent any. */
export async function reorderCollectionItems(actor: Actor | null, rawCollectionId: unknown, rawItemIds: unknown): Promise<void> {
  assertPermission(actor, "topics.manage");
  const collectionId = parseId(rawCollectionId);
  const parsed = z.array(objectIdSchema).max(MAX_COLLECTION_ITEMS).safeParse(rawItemIds);
  if (!parsed.success) throw new AppError("VALIDATION");
  const itemIds = parsed.data;

  await withTransaction(async (tx) => {
    const existing = await tx.collectionItem.findMany({ where: { collectionId }, select: { id: true } });
    const known = new Set(existing.map((item) => item.id));
    if (itemIds.length !== known.size || new Set(itemIds).size !== itemIds.length || !itemIds.every((id) => known.has(id))) throw new AppError("CONFLICT", strings.collections.stale);

    for (const [position, id] of itemIds.entries()) await tx.collectionItem.update({ where: { id }, data: { position } });
    await recordAudit(tx, actor, { action: "collection.item.reorder", entityType: "Collection", entityId: collectionId });
  });
}

const adminListSchema = z.strictObject({ query: z.string().max(120).optional(), status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(), cursor: z.string().optional() });

export async function listCollectionsForAdmin(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "admin.access");
  const parsed = adminListSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { query, status, cursor } = parsed.data;

  const rows = await prisma.collection.findMany({
    where: { ...(query ? { title: { contains: query, mode: "insensitive" as const } } : {}), ...(status === "ARCHIVED" ? { isArchived: true } : { isArchived: false, ...(status ? { status } : {}) }) },
    orderBy: { id: "desc" },
    take: ADMIN_PAGE_SIZE + 1,
    ...cursorArgs(parseOptionalCursor(cursor)),
    select: { id: true, title: true, status: true, isArchived: true, updatedAt: true },
  });
  return toCursorPage(rows, ADMIN_PAGE_SIZE);
}

export interface ManagedCollectionItem {
  id: string;
  entityType: ContentType;
  label: string;
  hint?: string;
  isDraft: boolean;
}

async function labelsFor(items: { entityType: ContentType; entityId: string }[]): Promise<Map<string, PickerItem>> {
  const idsOf = (type: ContentType) => items.filter((item) => item.entityType === type).map((item) => item.entityId);
  const where = (type: ContentType) => ({ id: { in: idsOf(type) } });
  const select = { id: true, title: true, status: true } as const;

  const [topics, articles, videos, playlists, libraries, resources] = await Promise.all([
    prisma.topic.findMany({ where: where("TOPIC"), select }),
    prisma.article.findMany({ where: where("ARTICLE"), select }),
    prisma.video.findMany({ where: where("VIDEO"), select: { ...select, kind: true, channelTitle: true } }),
    prisma.playlist.findMany({ where: where("PLAYLIST"), select }),
    prisma.library.findMany({ where: where("LIBRARY"), select: { id: true, name: true, status: true } }),
    prisma.externalResource.findMany({ where: where("RESOURCE"), select: { ...select, sourceName: true } }),
  ]);

  const labels = new Map<string, PickerItem>();
  const add = (type: PickerType, id: string, label: string, status: string, hint?: string) => labels.set(`${type}:${id}`, { id, type, label, hint, isDraft: status === "DRAFT" });
  for (const row of topics) add("TOPIC", row.id, row.title, row.status);
  for (const row of articles) add("ARTICLE", row.id, row.title, row.status);
  for (const row of videos) add("VIDEO", row.id, row.title, row.status, videoPickerLabel(row));
  for (const row of playlists) add("PLAYLIST", row.id, row.title, row.status);
  for (const row of libraries) add("LIBRARY", row.id, row.name, row.status);
  for (const row of resources) add("RESOURCE", row.id, row.title, row.status, row.sourceName);
  return labels;
}

export async function getCollectionForEditing(actor: Actor | null, rawId: unknown) {
  assertPermission(actor, "admin.access");
  const collection = await prisma.collection.findUnique({ where: { id: parseId(rawId) }, include: { items: { orderBy: { position: "asc" } } } });
  if (!collection) throw new AppError("NOT_FOUND");

  const labels = await labelsFor(collection.items);
  const items: ManagedCollectionItem[] = collection.items.map((item) => {
    const label = labels.get(`${item.entityType}:${item.entityId}`);
    return { id: item.id, entityType: item.entityType, label: label?.label ?? strings.collections.missingItem, hint: label?.hint, isDraft: label?.isDraft ?? false };
  });
  return { ...collection, items };
}

export interface ExploreCollection {
  id: string;
  title: string;
  description: string | null;
  items: ResolvedContent[];
}

/** Items that aren't public are left out, and a collection with none left isn't shown. */
export async function listExploreCollections(): Promise<ExploreCollection[]> {
  const collections = await prisma.collection.findMany({
    where: publicContentFilter,
    orderBy: [{ displayOrder: "asc" }, { id: "desc" }],
    take: MAX_EXPLORE_COLLECTIONS,
    select: { id: true, title: true, description: true, items: { orderBy: { position: "asc" }, select: { entityType: true, entityId: true } } },
  });
  const resolved = await Promise.all(collections.map(async ({ items, ...collection }) => ({ ...collection, items: await resolveInOrder(items) })));
  return resolved.filter((collection) => collection.items.length > 0);
}
