import type { Prisma } from "@prisma/client";
import { recordAudit } from "@/features/admin/audit";
import { AppError, isUniqueConstraintError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { slugify } from "@/lib/slug";
import { categoryInputSchema, categoryUpdateSchema, objectIdSchema } from "./schemas";

/** Well above any realistic taxonomy. It only exists so a query is never unbounded. */
const MAX_CATEGORIES = 200;

export interface PublicCategory {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  icon: string | null;
  parentId: string | null;
}

export async function listActiveCategories(): Promise<PublicCategory[]> {
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
    take: MAX_CATEGORIES,
    select: { id: true, title: true, slug: true, description: true, icon: true, parentId: true },
  });
}

/** Including inactive ones, for the people who manage them. */
export async function listAllCategories(actor: Actor | null) {
  assertPermission(actor, "categories.manage");
  return prisma.category.findMany({
    orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
    take: MAX_CATEGORIES,
    select: { id: true, title: true, slug: true, description: true, icon: true, displayOrder: true, isActive: true },
  });
}

function parseInput<T>(result: { success: true; data: T } | { success: false }): T {
  if (!result.success) throw new AppError("VALIDATION");
  return result.data;
}

/** Walks up from the proposed parent. Finding the category itself means a cycle. */
async function assertValidParent(tx: Prisma.TransactionClient, parentId: string, categoryId?: string): Promise<void> {
  let currentId: string | null = parentId;
  for (let depth = 0; currentId; depth += 1) {
    if (currentId === categoryId || depth > MAX_CATEGORIES) throw new AppError("VALIDATION");
    const parent: { parentId: string | null } | null = await tx.category.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    if (!parent) throw new AppError("VALIDATION");
    currentId = parent.parentId;
  }
}

function conflictOnDuplicateSlug(error: unknown): unknown {
  return isUniqueConstraintError(error) ? new AppError("CONFLICT") : error;
}

export async function createCategory(actor: Actor | null, rawInput: unknown) {
  assertPermission(actor, "categories.manage");
  const input = parseInput(categoryInputSchema.safeParse(rawInput));
  const slug = input.slug ?? slugify(input.title);
  if (!slug) throw new AppError("VALIDATION");

  try {
    return await withTransaction(async (tx) => {
      if (input.parentId) await assertValidParent(tx, input.parentId);
      const category = await tx.category.create({ data: { ...input, slug } });
      await recordAudit(tx, actor, {
        action: "category.create",
        entityType: "Category",
        entityId: category.id,
        metadata: { title: category.title, slug },
      });
      return category;
    });
  } catch (error) {
    throw conflictOnDuplicateSlug(error);
  }
}

export async function updateCategory(actor: Actor | null, rawId: unknown, rawInput: unknown) {
  assertPermission(actor, "categories.manage");
  const id = parseInput(objectIdSchema.safeParse(rawId));
  const input = parseInput(categoryUpdateSchema.safeParse(rawInput));

  try {
    return await withTransaction(async (tx) => {
      const existing = await tx.category.findUnique({ where: { id }, select: { id: true } });
      if (!existing) throw new AppError("NOT_FOUND");
      if (input.parentId) await assertValidParent(tx, input.parentId, id);

      const category = await tx.category.update({ where: { id }, data: input });
      await recordAudit(tx, actor, {
        action: "category.update",
        entityType: "Category",
        entityId: id,
        metadata: { changedFields: Object.keys(input) },
      });
      return category;
    });
  } catch (error) {
    throw conflictOnDuplicateSlug(error);
  }
}

/** Inactive categories leave public lists but keep their content and references. */
export async function setCategoryActive(actor: Actor | null, rawId: unknown, isActive: boolean) {
  assertPermission(actor, "categories.manage");
  const id = parseInput(objectIdSchema.safeParse(rawId));

  return withTransaction(async (tx) => {
    const existing = await tx.category.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError("NOT_FOUND");

    const category = await tx.category.update({ where: { id }, data: { isActive } });
    await recordAudit(tx, actor, {
      action: isActive ? "category.activate" : "category.deactivate",
      entityType: "Category",
      entityId: id,
    });
    return category;
  });
}
