import { z } from "zod";
import { objectIdSchema, slugSchema } from "@/features/topics/schemas";
import { isSafeHref, isSafeImageSrc } from "@/lib/content/document";
import { AppError, isUniqueConstraintError } from "@/lib/errors";
import { slugify } from "@/lib/slug";

/** Every public query uses this, so draft or archived content can never appear by accident. */
export const publicContentFilter = { status: "PUBLISHED", isArchived: false } as const;

export const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
export const imageUrlSchema = z.string().trim().refine(isSafeImageSrc);
export const optionalSlugSchema = slugSchema.nullable().optional();
export const idListSchema = z.array(objectIdSchema).max(50).default([]);

export const externalUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => isSafeHref(value) && /^https?:/i.test(value));

export function parseId(rawId: unknown): string {
  const parsed = objectIdSchema.safeParse(rawId);
  if (!parsed.success) throw new AppError("VALIDATION");
  return parsed.data;
}

/** A malformed cursor from a URL just means starting from the beginning. */
export function parseOptionalCursor(rawCursor: unknown): string | undefined {
  const parsed = objectIdSchema.safeParse(rawCursor);
  return parsed.success ? parsed.data : undefined;
}

export function conflictOnDuplicate(error: unknown): unknown {
  return isUniqueConstraintError(error) ? new AppError("CONFLICT") : error;
}

/**
 * A slug typed by a person must be free, so they find out about a clash. One made from a
 * title gets a number instead, so two articles sharing a title never block saving a draft.
 */
export async function resolveSlug(title: string, explicit: string | null | undefined, isTaken: (slug: string) => Promise<boolean>): Promise<string> {
  if (explicit) return explicit;
  const base = slugify(title);
  if (!base) throw new AppError("VALIDATION");

  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new AppError("CONFLICT");
}

export interface CursorPage<Item> {
  items: Item[];
  nextCursor: string | null;
}

/** Callers fetch limit + 1 rows, and the extra row reveals whether more exist. */
export function toCursorPage<Item extends { id: string }>(rows: Item[], limit: number): CursorPage<Item> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
}

export function cursorArgs(cursor: string | undefined): { cursor?: { id: string }; skip?: number } {
  return cursor ? { cursor: { id: cursor }, skip: 1 } : {};
}
