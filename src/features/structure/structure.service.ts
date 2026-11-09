import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { strings } from "@/config/strings.ar";
import { recordAudit } from "@/features/admin/audit";
import { createCollection } from "@/features/collections/collections.service";
import { createLibrary } from "@/features/libraries/libraries.service";
import { objectIdSchema } from "@/features/topics/schemas";
import { createTopic } from "@/features/topics/topics.service";
import { AppError } from "@/lib/errors";
import { assertPermission, hasPermission, type Actor, type Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { ORDER_STEP } from "./tree";

/**
 * One place to arrange what visitors browse: the topic tree, the library tree, the rows on
 * Explore, and the playlist list. Order is set by dragging, and stored in each item's displayOrder.
 */
export const STRUCTURE_KINDS = ["topics", "libraries", "collections", "playlists"] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];

const TREE_KINDS: readonly StructureKind[] = ["topics", "libraries"];
export const isTreeKind = (kind: StructureKind) => TREE_KINDS.includes(kind);

const MANAGE_PERMISSION: Record<StructureKind, Permission> = {
  topics: "topics.manage",
  libraries: "libraries.manage",
  collections: "topics.manage",
  playlists: "playlists.manage",
};

/** Far above a realistic taxonomy. Only there so no query is unbounded. */
export const MAX_TREE_NODES = 1000;
/** Channel playlists arrive by the hundred, so the list shows the first ones in order. */
export const MAX_PLAYLIST_NODES = 300;
const MAX_ORDER = 100_000;
const MAX_DEPTH = 32;

export type StructureCountKey = "channels" | "articles" | "playlists" | "libraries" | "resources" | "videos" | "items";

export interface StructureNode {
  id: string;
  parentId: string | null;
  order: number;
  title: string;
  slug: string | null;
  status: "DRAFT" | "PUBLISHED";
  isArchived: boolean;
  isFeatured: boolean;
  counts: Partial<Record<StructureCountKey, number>>;
}

export interface StructureData {
  kind: StructureKind;
  nodes: StructureNode[];
  isTruncated: boolean;
  canManage: boolean;
}

export function canManageStructure(actor: Actor, kind: StructureKind): boolean {
  return hasPermission(actor, MANAGE_PERMISSION[kind]);
}

function countMap<Key extends string>(rows: (Record<Key, string> & { _count: { _all: number } })[], key: Key): Map<string, number> {
  return new Map(rows.map((row) => [row[key], row._count._all]));
}

const ENTITY_TYPE: Record<StructureKind, string> = { topics: "Topic", libraries: "Library", collections: "Collection", playlists: "Playlist" };

async function loadTopics(): Promise<{ nodes: StructureNode[]; isTruncated: boolean }> {
  const rows = await prisma.topic.findMany({
    orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
    take: MAX_TREE_NODES + 1,
    select: { id: true, parentId: true, displayOrder: true, title: true, slug: true, status: true, isArchived: true, isFeatured: true },
  });
  const ids = rows.slice(0, MAX_TREE_NODES).map((row) => row.id);
  const where = { topicId: { in: ids } };
  const [channels, articles, playlists, libraries, resources] = await Promise.all([
    prisma.channelTopic.groupBy({ by: ["topicId"], where, _count: { _all: true } }),
    prisma.articleTopic.groupBy({ by: ["topicId"], where, _count: { _all: true } }),
    prisma.playlistTopic.groupBy({ by: ["topicId"], where, _count: { _all: true } }),
    prisma.libraryTopic.groupBy({ by: ["topicId"], where, _count: { _all: true } }),
    prisma.resourceTopic.groupBy({ by: ["topicId"], where, _count: { _all: true } }),
  ]);
  const byTopic = (list: { topicId: string; _count: { _all: number } }[]) => countMap(list, "topicId");
  const maps = { channels: byTopic(channels), articles: byTopic(articles), playlists: byTopic(playlists), libraries: byTopic(libraries), resources: byTopic(resources) };

  return {
    isTruncated: rows.length > MAX_TREE_NODES,
    nodes: rows.slice(0, MAX_TREE_NODES).map((row) => ({
      id: row.id,
      parentId: row.parentId,
      order: row.displayOrder,
      title: row.title,
      slug: row.slug,
      status: row.status,
      isArchived: row.isArchived,
      isFeatured: row.isFeatured,
      counts: Object.fromEntries(Object.entries(maps).map(([key, map]) => [key, map.get(row.id) ?? 0])),
    })),
  };
}

async function loadLibraries(): Promise<{ nodes: StructureNode[]; isTruncated: boolean }> {
  const rows = await prisma.library.findMany({
    orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
    take: MAX_TREE_NODES + 1,
    select: { id: true, parentId: true, displayOrder: true, name: true, slug: true, status: true, isArchived: true, isFeatured: true },
  });
  const ids = rows.slice(0, MAX_TREE_NODES).map((row) => row.id);
  const where = { libraryId: { in: ids } };
  const [articles, videos, playlists, resources] = await Promise.all([
    prisma.articleLibrary.groupBy({ by: ["libraryId"], where, _count: { _all: true } }),
    prisma.videoLibrary.groupBy({ by: ["libraryId"], where, _count: { _all: true } }),
    prisma.playlistLibrary.groupBy({ by: ["libraryId"], where, _count: { _all: true } }),
    prisma.resourceLibrary.groupBy({ by: ["libraryId"], where, _count: { _all: true } }),
  ]);
  const byLibrary = (list: { libraryId: string; _count: { _all: number } }[]) => countMap(list, "libraryId");
  const maps = { articles: byLibrary(articles), videos: byLibrary(videos), playlists: byLibrary(playlists), resources: byLibrary(resources) };

  return {
    isTruncated: rows.length > MAX_TREE_NODES,
    nodes: rows.slice(0, MAX_TREE_NODES).map((row) => ({
      id: row.id,
      parentId: row.parentId,
      order: row.displayOrder,
      title: row.name,
      slug: row.slug,
      status: row.status,
      isArchived: row.isArchived,
      isFeatured: row.isFeatured,
      counts: Object.fromEntries(Object.entries(maps).map(([key, map]) => [key, map.get(row.id) ?? 0])),
    })),
  };
}

async function loadCollections(): Promise<{ nodes: StructureNode[]; isTruncated: boolean }> {
  const rows = await prisma.collection.findMany({
    orderBy: [{ displayOrder: "asc" }, { id: "desc" }],
    take: MAX_TREE_NODES + 1,
    select: { id: true, displayOrder: true, title: true, status: true, isArchived: true },
  });
  const items = await prisma.collectionItem.groupBy({ by: ["collectionId"], where: { collectionId: { in: rows.map((row) => row.id) } }, _count: { _all: true } });
  const itemCounts = countMap(items, "collectionId");
  return {
    isTruncated: rows.length > MAX_TREE_NODES,
    nodes: rows.slice(0, MAX_TREE_NODES).map((row) => ({
      id: row.id,
      parentId: null,
      order: row.displayOrder,
      title: row.title,
      slug: null,
      status: row.status,
      isArchived: row.isArchived,
      isFeatured: false,
      counts: { items: itemCounts.get(row.id) ?? 0 },
    })),
  };
}

async function loadPlaylists(): Promise<{ nodes: StructureNode[]; isTruncated: boolean }> {
  const rows = await prisma.playlist.findMany({
    where: { isArchived: false },
    orderBy: [{ displayOrder: "asc" }, { id: "desc" }],
    take: MAX_PLAYLIST_NODES + 1,
    select: { id: true, displayOrder: true, title: true, slug: true, status: true, isArchived: true, isFeatured: true, itemCount: true },
  });
  return {
    isTruncated: rows.length > MAX_PLAYLIST_NODES,
    nodes: rows.slice(0, MAX_PLAYLIST_NODES).map((row) => ({
      id: row.id,
      parentId: null,
      order: row.displayOrder,
      title: row.title,
      slug: row.slug,
      status: row.status,
      isArchived: row.isArchived,
      isFeatured: row.isFeatured,
      counts: { videos: row.itemCount },
    })),
  };
}

const LOADERS: Record<StructureKind, () => Promise<{ nodes: StructureNode[]; isTruncated: boolean }>> = {
  topics: loadTopics,
  libraries: loadLibraries,
  collections: loadCollections,
  playlists: loadPlaylists,
};

export async function getStructure(actor: Actor | null, rawKind: unknown): Promise<StructureData> {
  assertPermission(actor, "admin.access");
  const parsed = z.enum(STRUCTURE_KINDS).safeParse(rawKind);
  if (!parsed.success) throw new AppError("VALIDATION");
  const kind = parsed.data;
  const { nodes, isTruncated } = await LOADERS[kind]();
  return { kind, nodes, isTruncated, canManage: canManageStructure(actor!, kind) };
}

// ---------------------------------------------------------------------------
// Moving
// ---------------------------------------------------------------------------

const moveSchema = z.strictObject({
  kind: z.enum(STRUCTURE_KINDS),
  id: objectIdSchema,
  parentId: objectIdSchema.nullable(),
  orderedIds: z.array(objectIdSchema).min(1).max(MAX_TREE_NODES),
});

/** A document created without a parent has no such field, and Prisma treats that as different from null. */
const rootFilter = { OR: [{ parentId: null }, { parentId: { isSet: false } }] };

type TreeDelegate = {
  findUnique(args: { where: { id: string }; select: { id: true; parentId: true } }): Promise<{ id: string; parentId: string | null } | null>;
  findMany(args: { where: object; select: { id: true; displayOrder: true } }): Promise<{ id: string; displayOrder: number }[]>;
  update(args: { where: { id: string }; data: { parentId?: string | null; displayOrder?: number } }): Promise<unknown>;
};

function treeDelegate(tx: Prisma.TransactionClient, kind: StructureKind): TreeDelegate {
  return (kind === "topics" ? tx.topic : tx.library) as unknown as TreeDelegate;
}

/** Walks up from the new parent. Meeting the moved item means the move would put it inside itself. */
async function assertNoCycle(delegate: TreeDelegate, parentId: string, id: string): Promise<void> {
  let current: string | null = parentId;
  for (let depth = 0; current; depth += 1) {
    if (current === id || depth > MAX_DEPTH) throw new AppError("VALIDATION", strings.structure.cantNestInside);
    const row: { id: string; parentId: string | null } | null = await delegate.findUnique({ where: { id: current }, select: { id: true, parentId: true } });
    if (!row) throw new AppError("CONFLICT", strings.structure.stale);
    current = row.parentId;
  }
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * Puts an item under a parent, at a position. `orderedIds` must name every sibling under that
 * parent, the item included, so a screen that's out of date can't scramble the order.
 */
export async function moveStructureNode(actor: Actor | null, rawInput: unknown): Promise<void> {
  const parsed = moveSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { kind, id, parentId, orderedIds } = parsed.data;
  assertPermission(actor, MANAGE_PERMISSION[kind]);
  if (new Set(orderedIds).size !== orderedIds.length || !orderedIds.includes(id)) throw new AppError("VALIDATION");
  if (parentId && !isTreeKind(kind)) throw new AppError("VALIDATION");

  await withTransaction(async (tx) => {
    let current: { id: string; displayOrder: number }[];
    let write: (siblingId: string, data: { parentId?: string | null; displayOrder?: number }) => Promise<unknown>;

    if (isTreeKind(kind)) {
      const delegate = treeDelegate(tx, kind);
      const moving = await delegate.findUnique({ where: { id }, select: { id: true, parentId: true } });
      if (!moving) throw new AppError("NOT_FOUND");
      if (parentId) await assertNoCycle(delegate, parentId, id);

      const siblings = await delegate.findMany({ where: parentId ? { parentId } : rootFilter, select: { id: true, displayOrder: true } });
      const expected = [...siblings.map((row) => row.id).filter((siblingId) => siblingId !== id), id];
      if (!sameSet(expected, orderedIds)) throw new AppError("CONFLICT", strings.structure.stale);
      if ((moving.parentId ?? null) !== parentId) await delegate.update({ where: { id }, data: { parentId } });
      current = siblings;
      write = (siblingId, data) => delegate.update({ where: { id: siblingId }, data });
    } else if (kind === "collections") {
      current = await tx.collection.findMany({ select: { id: true, displayOrder: true } });
      if (!sameSet(current.map((row) => row.id), orderedIds)) throw new AppError("CONFLICT", strings.structure.stale);
      write = (siblingId, data) => tx.collection.update({ where: { id: siblingId }, data });
    } else {
      // The playlist list may be cut short, so it orders the ones shown and leaves the rest alone.
      current = await tx.playlist.findMany({ where: { id: { in: orderedIds }, isArchived: false }, select: { id: true, displayOrder: true } });
      if (current.length !== orderedIds.length) throw new AppError("CONFLICT", strings.structure.stale);
      write = (siblingId, data) => tx.playlist.update({ where: { id: siblingId }, data });
    }

    const stored = new Map(current.map((row) => [row.id, row.displayOrder]));
    for (const [index, siblingId] of orderedIds.entries()) {
      const displayOrder = Math.min(index * ORDER_STEP, MAX_ORDER);
      if (stored.get(siblingId) !== displayOrder) await write(siblingId, { displayOrder });
    }

    await recordAudit(tx, actor, { action: "structure.move", entityType: ENTITY_TYPE[kind], entityId: id, metadata: { parentId, position: orderedIds.indexOf(id) } });
  });
}

// ---------------------------------------------------------------------------
// Quick creation
// ---------------------------------------------------------------------------

const createSchema = z.strictObject({
  kind: z.enum(["topics", "libraries", "collections"]),
  title: z.string().trim().min(1).max(120),
  parentId: objectIdSchema.nullable().default(null),
});

/** A draft with only a name, placed last among its siblings. Its other fields are filled in afterwards. */
export async function createStructureNode(actor: Actor | null, rawInput: unknown): Promise<{ id: string }> {
  const parsed = createSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { kind, title, parentId } = parsed.data;
  assertPermission(actor, MANAGE_PERMISSION[kind]);
  if (parentId && kind === "collections") throw new AppError("VALIDATION");

  const last =
    kind === "topics"
      ? await prisma.topic.findFirst({ where: parentId ? { parentId } : rootFilter, orderBy: { displayOrder: "desc" }, select: { displayOrder: true } })
      : kind === "libraries"
        ? await prisma.library.findFirst({ where: parentId ? { parentId } : rootFilter, orderBy: { displayOrder: "desc" }, select: { displayOrder: true } })
        : await prisma.collection.findFirst({ orderBy: { displayOrder: "desc" }, select: { displayOrder: true } });
  const displayOrder = Math.min((last ? last.displayOrder : -ORDER_STEP) + ORDER_STEP, MAX_ORDER);

  if (kind === "topics") return { id: (await createTopic(actor, { title, parentId, displayOrder })).id };
  if (kind === "libraries") return { id: (await createLibrary(actor, { name: title, parentId, displayOrder })).id };
  return { id: (await createCollection(actor, { title, displayOrder })).id };
}
