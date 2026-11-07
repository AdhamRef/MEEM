import type { Prisma, TopicRelationType } from "@prisma/client";
import { z } from "zod";
import { strings } from "@/config/strings.ar";
import { recordAudit } from "@/features/admin/audit";
import { objectIdSchema } from "@/features/topics/schemas";
import { AppError, isUniqueConstraintError } from "@/lib/errors";
import { assertPermission, hasPermission, type Actor, type Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { canonicalPair } from "./content-relations";
import { channelPickerLabel, videoPickerLabel, type PickerItem, type PickerType } from "./picker.service";
import { pullFromVideoArray } from "./references";

/**
 * Links are added and removed one at a time, rather than saved as a whole list with the form.
 * A library can hold thousands of videos, which a form can't carry, and two editors working on
 * the same item can't overwrite each other this way. Video.libraryIds is a copy for fast
 * filtering, and this file is the only place that changes it with the join.
 */

export const LINK_KINDS = [
  "topic.channel",
  "topic.article",
  "topic.playlist",
  "topic.resource",
  "topic.library",
  "topic.related",
  "topic.complementary",
  "library.video",
  "library.article",
  "library.playlist",
  "library.resource",
  "library.topic",
  "library.related",
  "playlist.topic",
  "playlist.library",
  "playlist.article",
  "channel.topic",
  "video.library",
  "video.article",
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

const linkInputSchema = z.strictObject({ kind: z.enum(LINK_KINDS), ownerId: objectIdSchema, targetId: objectIdSchema });
const listInputSchema = z.strictObject({ kind: z.enum(LINK_KINDS), ownerId: objectIdSchema, cursor: objectIdSchema.optional() });

const LIST_PAGE_SIZE = 30;
type Tx = Prisma.TransactionClient;

export interface LinkRow extends PickerItem {
  linkId: string;
  isFeatured?: boolean;
}

interface LinkHandler {
  permission: Permission;
  targetType: PickerType;
  ownerExists(tx: Tx, id: string): Promise<boolean>;
  targetExists(tx: Tx, id: string): Promise<boolean>;
  add(tx: Tx, ownerId: string, targetId: string): Promise<void>;
  remove(tx: Tx, ownerId: string, targetId: string): Promise<void>;
  list(ownerId: string, cursor: string | undefined): Promise<LinkRow[]>;
}

const cursorOf = (cursor: string | undefined): { cursor?: { id: string }; skip?: number } => (cursor ? { cursor: { id: cursor }, skip: 1 } : {});
const page = { take: LIST_PAGE_SIZE + 1, orderBy: { id: "desc" as const } };
const draftFlag = (status: string) => status === "DRAFT";

const topicExists = async (tx: Tx, id: string) => (await tx.topic.count({ where: { id } })) > 0;
const channelExists = async (tx: Tx, id: string) => (await tx.youTubeChannel.count({ where: { id } })) > 0;
const libraryExists = async (tx: Tx, id: string) => (await tx.library.count({ where: { id } })) > 0;
const videoExists = async (tx: Tx, id: string) => (await tx.video.count({ where: { id } })) > 0;
const articleExists = async (tx: Tx, id: string) => (await tx.article.count({ where: { id } })) > 0;
const playlistExists = async (tx: Tx, id: string) => (await tx.playlist.count({ where: { id } })) > 0;
const resourceExists = async (tx: Tx, id: string) => (await tx.externalResource.count({ where: { id } })) > 0;

function topicRelationHandler(type: TopicRelationType): LinkHandler {
  return {
    permission: "relationships.manage",
    targetType: "TOPIC",
    ownerExists: topicExists,
    targetExists: topicExists,
    add: async (tx, ownerId, targetId) => {
      if (ownerId === targetId) throw new AppError("VALIDATION");
      const [fromTopicId, toTopicId] = canonicalPair(ownerId, targetId);
      await tx.topicRelation.create({ data: { fromTopicId, toTopicId, type } });
    },
    remove: async (tx, ownerId, targetId) => {
      const [fromTopicId, toTopicId] = canonicalPair(ownerId, targetId);
      await tx.topicRelation.deleteMany({ where: { fromTopicId, toTopicId, type } });
    },
    list: async (ownerId, cursor) => {
      const rows = await prisma.topicRelation.findMany({
        ...page,
        ...cursorOf(cursor),
        where: { type, OR: [{ fromTopicId: ownerId }, { toTopicId: ownerId }] },
        select: { id: true, fromTopicId: true, fromTopic: { select: { id: true, title: true, status: true } }, toTopic: { select: { id: true, title: true, status: true } } },
      });
      return rows.map((row) => {
        const other = row.fromTopicId === ownerId ? row.toTopic : row.fromTopic;
        return { linkId: row.id, id: other.id, type: "TOPIC", label: other.title, isDraft: draftFlag(other.status) };
      });
    },
  };
}

/** The same link as from the other side, so the join and its feed copy stay together in one place. */
function fromVideo(kind: "library.video", targetExists: LinkHandler["targetExists"], targetType: PickerType, list: LinkHandler["list"]): () => LinkHandler {
  return () => ({
    permission: "content.editAny",
    targetType,
    ownerExists: videoExists,
    targetExists,
    add: (tx, videoId, targetId) => HANDLERS[kind].add(tx, targetId, videoId),
    remove: (tx, videoId, targetId) => HANDLERS[kind].remove(tx, targetId, videoId),
    list,
  });
}

const videoLibraryHandler = fromVideo("library.video", libraryExists, "LIBRARY", async (videoId, cursor) => {
  const rows = await prisma.videoLibrary.findMany({ ...page, ...cursorOf(cursor), where: { videoId }, select: { id: true, library: { select: { id: true, name: true, status: true } } } });
  return rows.map(({ id, library }) => ({ linkId: id, id: library.id, type: "LIBRARY", label: library.name, isDraft: draftFlag(library.status) }));
});

const HANDLERS: Record<LinkKind, LinkHandler> = {
  "channel.topic": {
    permission: "topics.manage",
    targetType: "TOPIC",
    ownerExists: channelExists,
    targetExists: topicExists,
    add: async (tx, channelId, topicId) => void (await tx.channelTopic.create({ data: { channelId, topicId } })),
    remove: async (tx, channelId, topicId) => void (await tx.channelTopic.deleteMany({ where: { channelId, topicId } })),
    list: async (channelId, cursor) => {
      const rows = await prisma.channelTopic.findMany({ ...page, ...cursorOf(cursor), where: { channelId }, select: { id: true, topic: { select: { id: true, title: true, status: true } } } });
      return rows.map(({ id, topic }) => ({ linkId: id, id: topic.id, type: "TOPIC", label: topic.title, isDraft: draftFlag(topic.status) }));
    },
  },
  get "video.library"() {
    return videoLibraryHandler();
  },
  "video.article": {
    permission: "content.editAny",
    targetType: "ARTICLE",
    ownerExists: videoExists,
    targetExists: articleExists,
    add: async (tx, videoId, articleId) => void (await tx.articleVideo.create({ data: { articleId, videoId } })),
    remove: async (tx, videoId, articleId) => void (await tx.articleVideo.deleteMany({ where: { articleId, videoId } })),
    list: async (videoId, cursor) => {
      const rows = await prisma.articleVideo.findMany({ ...page, ...cursorOf(cursor), where: { videoId }, select: { id: true, article: { select: { id: true, title: true, status: true } } } });
      return rows.map(({ id, article }) => ({ linkId: id, id: article.id, type: "ARTICLE", label: article.title, isDraft: draftFlag(article.status) }));
    },
  },
  "topic.channel": {
    permission: "topics.manage",
    targetType: "CHANNEL",
    ownerExists: topicExists,
    targetExists: channelExists,
    add: async (tx, topicId, channelId) => void (await tx.channelTopic.create({ data: { channelId, topicId } })),
    remove: async (tx, topicId, channelId) => void (await tx.channelTopic.deleteMany({ where: { channelId, topicId } })),
    list: async (topicId, cursor) => {
      const rows = await prisma.channelTopic.findMany({ ...page, ...cursorOf(cursor), where: { topicId }, select: { id: true, channel: { select: { id: true, title: true, handle: true } } } });
      return rows.map(({ id, channel }) => ({ linkId: id, id: channel.id, type: "CHANNEL", label: channel.title || strings.importer.channelWithdrawn, hint: channelPickerLabel(channel) }));
    },
  },
  "topic.article": {
    permission: "topics.manage",
    targetType: "ARTICLE",
    ownerExists: topicExists,
    targetExists: articleExists,
    add: async (tx, topicId, articleId) => void (await tx.articleTopic.create({ data: { articleId, topicId } })),
    remove: async (tx, topicId, articleId) => void (await tx.articleTopic.deleteMany({ where: { articleId, topicId } })),
    list: async (topicId, cursor) => {
      const rows = await prisma.articleTopic.findMany({ ...page, ...cursorOf(cursor), where: { topicId }, select: { id: true, article: { select: { id: true, title: true, status: true } } } });
      return rows.map(({ id, article }) => ({ linkId: id, id: article.id, type: "ARTICLE", label: article.title, isDraft: draftFlag(article.status) }));
    },
  },
  "topic.playlist": {
    permission: "topics.manage",
    targetType: "PLAYLIST",
    ownerExists: topicExists,
    targetExists: playlistExists,
    add: async (tx, topicId, playlistId) => void (await tx.playlistTopic.create({ data: { playlistId, topicId } })),
    remove: async (tx, topicId, playlistId) => void (await tx.playlistTopic.deleteMany({ where: { playlistId, topicId } })),
    list: async (topicId, cursor) => {
      const rows = await prisma.playlistTopic.findMany({ ...page, ...cursorOf(cursor), where: { topicId }, select: { id: true, playlist: { select: { id: true, title: true, status: true } } } });
      return rows.map(({ id, playlist }) => ({ linkId: id, id: playlist.id, type: "PLAYLIST", label: playlist.title, isDraft: draftFlag(playlist.status) }));
    },
  },
  "topic.resource": {
    permission: "topics.manage",
    targetType: "RESOURCE",
    ownerExists: topicExists,
    targetExists: resourceExists,
    add: async (tx, topicId, resourceId) => void (await tx.resourceTopic.create({ data: { resourceId, topicId } })),
    remove: async (tx, topicId, resourceId) => void (await tx.resourceTopic.deleteMany({ where: { resourceId, topicId } })),
    list: async (topicId, cursor) => {
      const rows = await prisma.resourceTopic.findMany({ ...page, ...cursorOf(cursor), where: { topicId }, select: { id: true, resource: { select: { id: true, title: true, sourceName: true, status: true } } } });
      return rows.map(({ id, resource }) => ({ linkId: id, id: resource.id, type: "RESOURCE", label: resource.title, hint: resource.sourceName, isDraft: draftFlag(resource.status) }));
    },
  },
  "topic.library": {
    permission: "topics.manage",
    targetType: "LIBRARY",
    ownerExists: topicExists,
    targetExists: libraryExists,
    add: async (tx, topicId, libraryId) => void (await tx.libraryTopic.create({ data: { libraryId, topicId } })),
    remove: async (tx, topicId, libraryId) => void (await tx.libraryTopic.deleteMany({ where: { libraryId, topicId } })),
    list: async (topicId, cursor) => {
      const rows = await prisma.libraryTopic.findMany({ ...page, ...cursorOf(cursor), where: { topicId }, select: { id: true, library: { select: { id: true, name: true, status: true } } } });
      return rows.map(({ id, library }) => ({ linkId: id, id: library.id, type: "LIBRARY", label: library.name, isDraft: draftFlag(library.status) }));
    },
  },
  "topic.related": topicRelationHandler("RELATED"),
  "topic.complementary": topicRelationHandler("COMPLEMENTARY"),

  "library.video": {
    permission: "libraries.manage",
    targetType: "VIDEO",
    ownerExists: libraryExists,
    targetExists: videoExists,
    add: async (tx, libraryId, videoId) => {
      await tx.videoLibrary.create({ data: { videoId, libraryId } });
      await tx.video.update({ where: { id: videoId }, data: { libraryIds: { push: libraryId } } });
    },
    remove: async (tx, libraryId, videoId) => {
      await tx.videoLibrary.deleteMany({ where: { videoId, libraryId } });
      await pullFromVideoArray(tx, "libraryIds", libraryId, [videoId]);
    },
    list: async (libraryId, cursor) => {
      const rows = await prisma.videoLibrary.findMany({ ...page, ...cursorOf(cursor), where: { libraryId }, select: { id: true, isFeatured: true, video: { select: { id: true, title: true, kind: true, channelTitle: true, status: true } } } });
      return rows.map(({ id, isFeatured, video }) => ({ linkId: id, id: video.id, type: "VIDEO", label: video.title, hint: videoPickerLabel(video), isDraft: draftFlag(video.status), isFeatured }));
    },
  },
  "library.article": {
    permission: "libraries.manage",
    targetType: "ARTICLE",
    ownerExists: libraryExists,
    targetExists: articleExists,
    add: async (tx, libraryId, articleId) => void (await tx.articleLibrary.create({ data: { articleId, libraryId } })),
    remove: async (tx, libraryId, articleId) => void (await tx.articleLibrary.deleteMany({ where: { articleId, libraryId } })),
    list: async (libraryId, cursor) => {
      const rows = await prisma.articleLibrary.findMany({ ...page, ...cursorOf(cursor), where: { libraryId }, select: { id: true, isFeatured: true, article: { select: { id: true, title: true, status: true } } } });
      return rows.map(({ id, isFeatured, article }) => ({ linkId: id, id: article.id, type: "ARTICLE", label: article.title, isDraft: draftFlag(article.status), isFeatured }));
    },
  },
  "library.playlist": {
    permission: "libraries.manage",
    targetType: "PLAYLIST",
    ownerExists: libraryExists,
    targetExists: playlistExists,
    add: async (tx, libraryId, playlistId) => void (await tx.playlistLibrary.create({ data: { playlistId, libraryId } })),
    remove: async (tx, libraryId, playlistId) => void (await tx.playlistLibrary.deleteMany({ where: { playlistId, libraryId } })),
    list: async (libraryId, cursor) => {
      const rows = await prisma.playlistLibrary.findMany({ ...page, ...cursorOf(cursor), where: { libraryId }, select: { id: true, playlist: { select: { id: true, title: true, status: true } } } });
      return rows.map(({ id, playlist }) => ({ linkId: id, id: playlist.id, type: "PLAYLIST", label: playlist.title, isDraft: draftFlag(playlist.status) }));
    },
  },
  "library.resource": {
    permission: "libraries.manage",
    targetType: "RESOURCE",
    ownerExists: libraryExists,
    targetExists: resourceExists,
    add: async (tx, libraryId, resourceId) => void (await tx.resourceLibrary.create({ data: { resourceId, libraryId } })),
    remove: async (tx, libraryId, resourceId) => void (await tx.resourceLibrary.deleteMany({ where: { resourceId, libraryId } })),
    list: async (libraryId, cursor) => {
      const rows = await prisma.resourceLibrary.findMany({ ...page, ...cursorOf(cursor), where: { libraryId }, select: { id: true, resource: { select: { id: true, title: true, sourceName: true, status: true } } } });
      return rows.map(({ id, resource }) => ({ linkId: id, id: resource.id, type: "RESOURCE", label: resource.title, hint: resource.sourceName, isDraft: draftFlag(resource.status) }));
    },
  },
  "library.topic": {
    permission: "libraries.manage",
    targetType: "TOPIC",
    ownerExists: libraryExists,
    targetExists: topicExists,
    add: async (tx, libraryId, topicId) => void (await tx.libraryTopic.create({ data: { libraryId, topicId } })),
    remove: async (tx, libraryId, topicId) => void (await tx.libraryTopic.deleteMany({ where: { libraryId, topicId } })),
    list: async (libraryId, cursor) => {
      const rows = await prisma.libraryTopic.findMany({ ...page, ...cursorOf(cursor), where: { libraryId }, select: { id: true, topic: { select: { id: true, title: true, status: true } } } });
      return rows.map(({ id, topic }) => ({ linkId: id, id: topic.id, type: "TOPIC", label: topic.title, isDraft: draftFlag(topic.status) }));
    },
  },
  "playlist.topic": {
    permission: "playlists.manage",
    targetType: "TOPIC",
    ownerExists: playlistExists,
    targetExists: topicExists,
    add: async (tx, playlistId, topicId) => void (await tx.playlistTopic.create({ data: { playlistId, topicId } })),
    remove: async (tx, playlistId, topicId) => void (await tx.playlistTopic.deleteMany({ where: { playlistId, topicId } })),
    list: async (playlistId, cursor) => {
      const rows = await prisma.playlistTopic.findMany({ ...page, ...cursorOf(cursor), where: { playlistId }, select: { id: true, topic: { select: { id: true, title: true, status: true } } } });
      return rows.map(({ id, topic }) => ({ linkId: id, id: topic.id, type: "TOPIC", label: topic.title, isDraft: draftFlag(topic.status) }));
    },
  },
  "playlist.library": {
    permission: "playlists.manage",
    targetType: "LIBRARY",
    ownerExists: playlistExists,
    targetExists: libraryExists,
    add: async (tx, playlistId, libraryId) => void (await tx.playlistLibrary.create({ data: { playlistId, libraryId } })),
    remove: async (tx, playlistId, libraryId) => void (await tx.playlistLibrary.deleteMany({ where: { playlistId, libraryId } })),
    list: async (playlistId, cursor) => {
      const rows = await prisma.playlistLibrary.findMany({ ...page, ...cursorOf(cursor), where: { playlistId }, select: { id: true, library: { select: { id: true, name: true, status: true } } } });
      return rows.map(({ id, library }) => ({ linkId: id, id: library.id, type: "LIBRARY", label: library.name, isDraft: draftFlag(library.status) }));
    },
  },
  "playlist.article": {
    permission: "playlists.manage",
    targetType: "ARTICLE",
    ownerExists: playlistExists,
    targetExists: articleExists,
    add: async (tx, playlistId, articleId) => void (await tx.articlePlaylist.create({ data: { articleId, playlistId } })),
    remove: async (tx, playlistId, articleId) => void (await tx.articlePlaylist.deleteMany({ where: { articleId, playlistId } })),
    list: async (playlistId, cursor) => {
      const rows = await prisma.articlePlaylist.findMany({ ...page, ...cursorOf(cursor), where: { playlistId }, select: { id: true, article: { select: { id: true, title: true, status: true } } } });
      return rows.map(({ id, article }) => ({ linkId: id, id: article.id, type: "ARTICLE", label: article.title, isDraft: draftFlag(article.status) }));
    },
  },
  "library.related": {
    permission: "relationships.manage",
    targetType: "LIBRARY",
    ownerExists: libraryExists,
    targetExists: libraryExists,
    add: async (tx, ownerId, targetId) => {
      if (ownerId === targetId) throw new AppError("VALIDATION");
      const [fromLibraryId, toLibraryId] = canonicalPair(ownerId, targetId);
      await tx.libraryRelation.create({ data: { fromLibraryId, toLibraryId } });
    },
    remove: async (tx, ownerId, targetId) => {
      const [fromLibraryId, toLibraryId] = canonicalPair(ownerId, targetId);
      await tx.libraryRelation.deleteMany({ where: { fromLibraryId, toLibraryId } });
    },
    list: async (ownerId, cursor) => {
      const rows = await prisma.libraryRelation.findMany({
        ...page,
        ...cursorOf(cursor),
        where: { OR: [{ fromLibraryId: ownerId }, { toLibraryId: ownerId }] },
        select: { id: true, fromLibraryId: true, fromLibrary: { select: { id: true, name: true, status: true } }, toLibrary: { select: { id: true, name: true, status: true } } },
      });
      return rows.map((row) => {
        const other = row.fromLibraryId === ownerId ? row.toLibrary : row.fromLibrary;
        return { linkId: row.id, id: other.id, type: "LIBRARY", label: other.name, isDraft: draftFlag(other.status) };
      });
    },
  },
};

export function linkTargetType(kind: LinkKind): PickerType {
  return HANDLERS[kind].targetType;
}

export function canManageLink(actor: Actor, kind: LinkKind): boolean {
  return hasPermission(actor, HANDLERS[kind].permission);
}

const auditEntity = (kind: LinkKind) => (kind.startsWith("topic.") ? "Topic" : kind.startsWith("library.") ? "Library" : kind.startsWith("video.") ? "Video" : kind.startsWith("channel.") ? "YouTubeChannel" : "Playlist");

/** Adding something already linked is treated as done. */
export async function addLink(actor: Actor | null, rawInput: unknown): Promise<void> {
  if (!actor) throw new AppError("UNAUTHENTICATED");
  const parsed = linkInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { kind, ownerId, targetId } = parsed.data;
  const handler = HANDLERS[kind];
  assertPermission(actor, handler.permission);

  try {
    await withTransaction(async (tx) => {
      if (!(await handler.ownerExists(tx, ownerId))) throw new AppError("NOT_FOUND");
      if (!(await handler.targetExists(tx, targetId))) throw new AppError("VALIDATION");
      await handler.add(tx, ownerId, targetId);
      await recordAudit(tx, actor, { action: "link.add", entityType: auditEntity(kind), entityId: ownerId, metadata: { kind, targetId } });
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }
}

export async function removeLink(actor: Actor | null, rawInput: unknown): Promise<void> {
  if (!actor) throw new AppError("UNAUTHENTICATED");
  const parsed = linkInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { kind, ownerId, targetId } = parsed.data;
  const handler = HANDLERS[kind];
  assertPermission(actor, handler.permission);

  await withTransaction(async (tx) => {
    await handler.remove(tx, ownerId, targetId);
    await recordAudit(tx, actor, { action: "link.remove", entityType: auditEntity(kind), entityId: ownerId, metadata: { kind, targetId } });
  });
}

export async function listLinks(actor: Actor | null, rawInput: unknown): Promise<{ items: LinkRow[]; nextCursor: string | null }> {
  assertPermission(actor, "admin.access");
  const parsed = listInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { kind, ownerId, cursor } = parsed.data;

  const rows = await HANDLERS[kind].list(ownerId, cursor);
  const hasMore = rows.length > LIST_PAGE_SIZE;
  const items = hasMore ? rows.slice(0, LIST_PAGE_SIZE) : rows;
  return { items, nextCursor: hasMore ? items.at(-1)!.linkId : null };
}

const featureInputSchema = z.strictObject({ kind: z.enum(["library.article", "library.video"]), ownerId: objectIdSchema, targetId: objectIdSchema, isFeatured: z.boolean() });

/** A library's landing page leads with what its editors pick (§14). */
export async function setLibraryItemFeatured(actor: Actor | null, rawInput: unknown): Promise<void> {
  assertPermission(actor, "libraries.manage");
  const parsed = featureInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { kind, ownerId, targetId, isFeatured } = parsed.data;

  await withTransaction(async (tx) => {
    const result =
      kind === "library.article"
        ? await tx.articleLibrary.updateMany({ where: { libraryId: ownerId, articleId: targetId }, data: { isFeatured } })
        : await tx.videoLibrary.updateMany({ where: { libraryId: ownerId, videoId: targetId }, data: { isFeatured } });
    if (result.count === 0) throw new AppError("NOT_FOUND");
    await recordAudit(tx, actor, { action: "link.feature", entityType: "Library", entityId: ownerId, metadata: { kind, targetId, isFeatured } });
  });
}
