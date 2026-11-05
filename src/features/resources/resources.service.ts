import { z } from "zod";
import { strings } from "@/config/strings.ar";
import { recordAudit } from "@/features/admin/audit";
import { libraryCardSelect, topicCardSelect } from "@/features/content/cards";
import {
  conflictOnDuplicate,
  cursorArgs,
  externalUrlSchema,
  imageUrlSchema,
  optionalSlugSchema,
  optionalText,
  parseId,
  parseOptionalCursor,
  publicContentFilter,
  resolveSlug,
  toCursorPage,
} from "@/features/content/common";
import { purgeContentReferences } from "@/features/relationships/references";
import { AppError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { buildSearchText, normalizeArabicForSearch } from "@/lib/search/normalize";
import { decodeSlugParam } from "@/lib/slug";

const ADMIN_PAGE_SIZE = 25;

/** Only a description and a link are stored, because external articles are never copied here (§12.4). */
export const resourceInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  slug: optionalSlugSchema,
  description: optionalText(2000),
  sourceName: z.string().trim().min(1).max(120),
  url: externalUrlSchema,
  coverImage: imageUrlSchema.nullable().optional(),
});

function parseInput(rawInput: unknown) {
  const parsed = resourceInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  return parsed.data;
}

function searchFields(input: { title: string; description?: string | null; sourceName: string }) {
  return { titleSearch: normalizeArabicForSearch(input.title), searchText: buildSearchText([input.title, input.description, input.sourceName]) };
}

export async function createResource(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "relationships.manage");
  const input = parseInput(rawInput);

  try {
    return await withTransaction(async (tx) => {
      const slug = await resolveSlug(input.title, input.slug, async (candidate) => (await tx.externalResource.count({ where: { slug: candidate } })) > 0);
      const resource = await tx.externalResource.create({ data: { ...input, slug, status: "DRAFT", ...searchFields(input) } });
      await recordAudit(tx, actor, { action: "resource.create", entityType: "ExternalResource", entityId: resource.id, metadata: { title: resource.title, slug } });
      return resource;
    });
  } catch (error) {
    throw conflictOnDuplicate(error);
  }
}

export async function updateResource(actor: Actor | null, rawId: unknown, rawInput: unknown) {
  assertPermission(actor, "relationships.manage");
  const id = parseId(rawId);
  const input = parseInput(rawInput);

  try {
    return await withTransaction(async (tx) => {
      const existing = await tx.externalResource.findUnique({ where: { id }, select: { status: true, slug: true } });
      if (!existing) throw new AppError("NOT_FOUND");
      const slug = input.slug ?? existing.slug;
      if (existing.status === "PUBLISHED" && slug !== existing.slug) throw new AppError("CONFLICT", strings.content.slugLocked);

      const resource = await tx.externalResource.update({ where: { id }, data: { ...input, slug, ...searchFields(input) } });
      await recordAudit(tx, actor, { action: "resource.update", entityType: "ExternalResource", entityId: id, metadata: { title: resource.title } });
      return resource;
    });
  } catch (error) {
    throw conflictOnDuplicate(error);
  }
}

export async function setResourcePublished(actor: Actor | null, rawId: unknown, isPublished: boolean) {
  assertPermission(actor, "content.publish");
  const id = parseId(rawId);

  return withTransaction(async (tx) => {
    const existing = await tx.externalResource.findUnique({ where: { id }, select: { isArchived: true, publishedAt: true } });
    if (!existing) throw new AppError("NOT_FOUND");
    if (existing.isArchived && isPublished) throw new AppError("CONFLICT", strings.content.archivedCantPublish);

    const resource = await tx.externalResource.update({
      where: { id },
      data: { status: isPublished ? "PUBLISHED" : "DRAFT", publishedAt: isPublished ? (existing.publishedAt ?? new Date()) : existing.publishedAt },
    });
    await recordAudit(tx, actor, { action: isPublished ? "resource.publish" : "resource.unpublish", entityType: "ExternalResource", entityId: id });
    return resource;
  });
}

export async function setResourceArchived(actor: Actor | null, rawId: unknown, isArchived: boolean) {
  assertPermission(actor, "content.archive");
  const id = parseId(rawId);

  return withTransaction(async (tx) => {
    const existing = await tx.externalResource.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError("NOT_FOUND");
    const resource = await tx.externalResource.update({ where: { id }, data: { isArchived, archivedAt: isArchived ? new Date() : null } });
    await recordAudit(tx, actor, { action: isArchived ? "resource.archive" : "resource.restore", entityType: "ExternalResource", entityId: id });
    return resource;
  });
}

export async function deleteResource(actor: Actor | null, rawId: unknown): Promise<void> {
  assertPermission(actor, "content.delete");
  const id = parseId(rawId);

  await withTransaction(async (tx) => {
    const existing = await tx.externalResource.findUnique({ where: { id }, select: { title: true, slug: true } });
    if (!existing) throw new AppError("NOT_FOUND");
    await purgeContentReferences(tx, "RESOURCE", id);
    await tx.externalResource.delete({ where: { id } });
    await recordAudit(tx, actor, { action: "resource.delete", entityType: "ExternalResource", entityId: id, metadata: { title: existing.title, slug: existing.slug } });
  });
}

const adminListSchema = z.strictObject({ query: z.string().max(120).optional(), status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(), cursor: z.string().optional() });

export async function listResourcesForAdmin(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "admin.access");
  const parsed = adminListSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { query, status, cursor } = parsed.data;
  const search = query ? normalizeArabicForSearch(query) : "";

  const rows = await prisma.externalResource.findMany({
    where: { ...(search ? { titleSearch: { contains: search } } : {}), ...(status === "ARCHIVED" ? { isArchived: true } : { isArchived: false, ...(status ? { status } : {}) }) },
    orderBy: { id: "desc" },
    take: ADMIN_PAGE_SIZE + 1,
    ...cursorArgs(parseOptionalCursor(cursor)),
    select: { id: true, title: true, slug: true, sourceName: true, status: true, isArchived: true, updatedAt: true },
  });
  return toCursorPage(rows, ADMIN_PAGE_SIZE);
}

export async function getResourceForEditing(actor: Actor | null, rawId: unknown) {
  assertPermission(actor, "admin.access");
  const resource = await prisma.externalResource.findUnique({ where: { id: parseId(rawId) } });
  if (!resource) throw new AppError("NOT_FOUND");
  return resource;
}

export async function getPublishedResourceBySlug(rawSlug: string) {
  const slug = decodeSlugParam(rawSlug);
  if (!slug) return null;
  const resource = await prisma.externalResource.findFirst({ where: { slug, ...publicContentFilter } });
  if (!resource) return null;

  const [topicLinks, libraryLinks] = await Promise.all([
    prisma.resourceTopic.findMany({ where: { resourceId: resource.id, topic: publicContentFilter }, take: 24, select: { topic: { select: topicCardSelect } } }),
    prisma.resourceLibrary.findMany({ where: { resourceId: resource.id, library: publicContentFilter }, take: 24, select: { library: { select: libraryCardSelect } } }),
  ]);
  return { resource, topics: topicLinks.map((link) => link.topic), libraries: libraryLinks.map((link) => link.library) };
}
