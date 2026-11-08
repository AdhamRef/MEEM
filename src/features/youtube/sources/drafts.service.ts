import type { Prisma, SourceDraftKind, SourceDraftStatus } from "@prisma/client";
import { z } from "zod";
import { strings } from "@/config/strings.ar";
import { recordAudit } from "@/features/admin/audit";
import { parseId, parseOptionalCursor, toCursorPage } from "@/features/content/common";
import { AppError, isUniqueConstraintError } from "@/lib/errors";
import { assertPermission, hasPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { getQuotaUsage, YOUTUBE_DAILY_QUOTA } from "@/lib/youtube/quota";
import { getYouTubeSettings } from "../settings.service";
import { addResultHref, describeAddResult } from "./describe";
import { detectSourceInput, type SourceInput } from "./detect";
import { addSource } from "./sources.service";

const t = strings.sourceDrafts;
const PAGE_SIZE = 30;
/** Longer than adding one source can take, so a stopped attempt frees the draft soon after. */
const LEASE_MS = 120_000;
/** Each run adds a few, because adding a channel only follows it. Its videos come in later checks. */
const AUTO_PER_RUN = 10;

/** The same permissions as adding a source, since a queued one is added the same way. */
function assertCanQueue(actor: Actor | null): asserts actor is Actor {
  assertPermission(actor, "youtube.import");
  assertPermission(actor, "content.publish");
}

/** What a link points at, as a key, so one source can't be queued twice under different spellings. */
export function draftKey(detected: SourceInput): { key: string; kind: SourceDraftKind } | null {
  switch (detected.kind) {
    case "channel":
      return { key: `channel:${detected.reference.kind}:${detected.reference.value.toLowerCase()}`, kind: "CHANNEL" };
    case "playlist":
      return { key: `playlist:${detected.youtubePlaylistId}`, kind: "PLAYLIST" };
    case "videos":
      return { key: `videos:${[...detected.youtubeVideoIds].sort().join(",")}`, kind: "VIDEOS" };
    default:
      return null;
  }
}

/** Checked against stored data only, so saving a draft never spends quota. */
async function isAlreadyStored(detected: SourceInput): Promise<boolean> {
  if (detected.kind === "playlist") return (await prisma.playlist.count({ where: { youtubePlaylistId: detected.youtubePlaylistId } })) > 0;
  if (detected.kind === "videos") return (await prisma.video.count({ where: { youtubeVideoId: { in: detected.youtubeVideoIds } } })) === detected.youtubeVideoIds.length;
  if (detected.kind !== "channel") return false;
  const { reference } = detected;
  // An old username can only be resolved by YouTube, so it's never known to be stored.
  if (reference.kind === "username") return false;
  // A handle can move between channels, so only a followed channel with it counts as stored.
  const where: Prisma.YouTubeChannelWhereInput = reference.kind === "id" ? { youtubeChannelId: reference.value, isFollowed: true } : { handle: { equals: reference.value, mode: "insensitive" }, isFollowed: true };
  return (await prisma.youTubeChannel.count({ where })) > 0;
}

const createSchema = z.strictObject({
  input: z.string().trim().min(1).max(5000),
  label: z.string().trim().max(120).optional(),
  note: z.string().trim().max(1000).optional(),
  autoAdd: z.boolean().default(true),
});

export async function createSourceDraft(actor: Actor | null, rawInput: unknown) {
  assertCanQueue(actor);
  const parsed = createSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION", t.invalid);
  const { input, label, note, autoAdd } = parsed.data;

  const detected = detectSourceInput(input);
  if (detected.kind === "legacyChannel") throw new AppError("VALIDATION", strings.sources.legacyChannel);
  const identity = draftKey(detected);
  if (!identity) throw new AppError("VALIDATION", strings.sources.invalidInput);
  if (await isAlreadyStored(detected)) throw new AppError("CONFLICT", t.alreadyStored);

  try {
    return await withTransaction(async (tx) => {
      const draft = await tx.sourceDraft.create({
        data: { key: identity.key, input, kind: identity.kind, label: label || null, note: note || null, autoAdd, createdById: actor.id },
        select: { id: true, kind: true },
      });
      await recordAudit(tx, actor, { action: "source_draft.create", entityType: "SourceDraft", entityId: draft.id, metadata: { kind: draft.kind, autoAdd } });
      return draft;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new AppError("CONFLICT", t.alreadyQueued);
    throw error;
  }
}

const listSchema = z.strictObject({ status: z.enum(["WAITING", "ADDED", "FAILED"]).optional(), cursor: z.string().optional() });

export async function listSourceDrafts(actor: Actor | null, rawInput: unknown = {}) {
  assertPermission(actor, "youtube.import");
  const parsed = listSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { status, cursor } = parsed.data;
  const validCursor = parseOptionalCursor(cursor);
  // Waiting includes one being added right now, which is still on its way.
  const statusWhere: Prisma.SourceDraftWhereInput = status === "WAITING" ? { status: { in: ["WAITING", "PROCESSING"] } } : status ? { status } : {};

  const [rows, counts] = await Promise.all([
    prisma.sourceDraft.findMany({ where: statusWhere, orderBy: { id: "desc" }, take: PAGE_SIZE + 1, ...(validCursor ? { cursor: { id: validCursor }, skip: 1 } : {}) }),
    prisma.sourceDraft.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const page = toCursorPage(rows, PAGE_SIZE);
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(page.items.map((row) => row.createdById))] } }, select: { id: true, name: true, email: true } });
  const byId = new Map(people.map((person) => [person.id, person.name || person.email]));
  const count = (...statuses: SourceDraftStatus[]) => counts.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);

  return {
    ...page,
    items: page.items.map((row) => ({ ...row, createdByName: byId.get(row.createdById) ?? null })),
    counts: { all: count("WAITING", "PROCESSING", "ADDED", "FAILED"), waiting: count("WAITING", "PROCESSING"), added: count("ADDED"), failed: count("FAILED") },
  };
}

export async function setDraftAutoAdd(actor: Actor | null, rawId: unknown, autoAdd: boolean): Promise<void> {
  assertCanQueue(actor);
  const id = parseId(rawId);
  await withTransaction(async (tx) => {
    if (!(await tx.sourceDraft.count({ where: { id } }))) throw new AppError("NOT_FOUND");
    await tx.sourceDraft.update({ where: { id }, data: { autoAdd } });
    await recordAudit(tx, actor, { action: autoAdd ? "source_draft.auto_on" : "source_draft.auto_off", entityType: "SourceDraft", entityId: id });
  });
}

/** Only the queue entry goes. Anything it already added stays, as the audit log records. */
export async function deleteSourceDraft(actor: Actor | null, rawId: unknown): Promise<void> {
  assertCanQueue(actor);
  const id = parseId(rawId);
  await withTransaction(async (tx) => {
    const draft = await tx.sourceDraft.findUnique({ where: { id }, select: { kind: true, input: true } });
    if (!draft) throw new AppError("NOT_FOUND");
    await tx.sourceDraft.delete({ where: { id } });
    await recordAudit(tx, actor, { action: "source_draft.delete", entityType: "SourceDraft", entityId: id, metadata: { kind: draft.kind } });
  });
}

export type DraftOutcome = { status: "ADDED" | "WAITING" | "FAILED" | "BUSY"; message: string | null };

/**
 * Adds a queued source exactly as the Sources box would. A quota or YouTube failure sends it
 * back to waiting, to try again later. A link that can't work fails, saying why.
 */
async function processDraft(actor: Actor, id: string): Promise<DraftOutcome> {
  const now = new Date();
  const { count } = await prisma.sourceDraft.updateMany({
    // Never set can be null or missing, and those differ in filters.
    where: { id, status: { in: ["WAITING", "FAILED"] }, OR: [{ lockedUntil: null }, { lockedUntil: { isSet: false } }, { lockedUntil: { lt: now } }] },
    data: { status: "PROCESSING", lockedUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
  });
  if (count === 0) return { status: "BUSY", message: t.busy };
  const draft = await prisma.sourceDraft.findUniqueOrThrow({ where: { id }, select: { input: true } });

  let outcome: DraftOutcome & { status: "ADDED" | "WAITING" | "FAILED" };
  let resultHref: string | null = null;
  try {
    const result = await addSource(actor, { input: draft.input });
    outcome = { status: "ADDED", message: describeAddResult(result) };
    resultHref = addResultHref(result);
  } catch (error) {
    if (!(error instanceof AppError)) {
      await prisma.sourceDraft.update({ where: { id }, data: { status: "WAITING", lockedUntil: null } });
      throw error;
    }
    if (error.code === "EXTERNAL_UNAVAILABLE") outcome = { status: "WAITING", message: error.publicMessage };
    else if (error.code === "CONFLICT") outcome = { status: "ADDED", message: error.publicMessage };
    else outcome = { status: "FAILED", message: error.publicMessage };
  }

  await prisma.sourceDraft.update({
    where: { id },
    data: { status: outcome.status, resultMessage: outcome.message, resultHref, lockedUntil: null, ...(outcome.status === "ADDED" ? { processedAt: new Date() } : {}) },
  });
  return outcome;
}

export async function addSourceDraftNow(actor: Actor | null, rawId: unknown): Promise<DraftOutcome> {
  assertCanQueue(actor);
  const id = parseId(rawId);
  if (!(await prisma.sourceDraft.count({ where: { id } }))) throw new AppError("NOT_FOUND");
  return processDraft(actor, id);
}

/**
 * Part of the hourly job: waiting drafts marked for it, oldest first, once there's quota. Each is
 * added as the person who queued it, with their permissions now, so taking someone's role away
 * also stops what they queued.
 */
export async function runAutoDrafts(deadline: Date): Promise<{ added: number; waiting: number; failed: number }> {
  const report = { added: 0, waiting: 0, failed: 0 };
  const settings = await getYouTubeSettings();
  const drafts = await prisma.sourceDraft.findMany({ where: { status: "WAITING", autoAdd: true }, orderBy: { createdAt: "asc" }, take: AUTO_PER_RUN, select: { id: true, createdById: true } });

  for (const draft of drafts) {
    if (Date.now() >= deadline.getTime()) break;
    const quota = await getQuotaUsage();
    if (quota.exhausted || quota.units >= Math.min(settings.autoCheckQuotaCeiling, YOUTUBE_DAILY_QUOTA)) break;

    const user = await prisma.user.findUnique({ where: { id: draft.createdById }, select: { id: true, email: true, role: true, permissionGrants: true } });
    const actor: Actor | null = user ? { id: user.id, email: user.email, role: user.role, permissionGrants: user.permissionGrants } : null;
    if (!actor || !hasPermission(actor, "youtube.import") || !hasPermission(actor, "content.publish")) {
      await prisma.sourceDraft.update({ where: { id: draft.id }, data: { status: "FAILED", resultMessage: t.noLongerAllowed } });
      report.failed += 1;
      continue;
    }

    const outcome = await processDraft(actor, draft.id);
    if (outcome.status === "ADDED") report.added += 1;
    else if (outcome.status === "FAILED") report.failed += 1;
    else if (outcome.status === "WAITING") {
      // Quota or YouTube trouble would stop the rest the same way.
      report.waiting += 1;
      break;
    }
  }
  return report;
}

/** For the badge in the dashboard's menu and the Sources page. */
export async function countWaitingDrafts(actor: Actor | null): Promise<number> {
  if (!actor || !hasPermission(actor, "youtube.import")) return 0;
  return prisma.sourceDraft.count({ where: { status: { in: ["WAITING", "PROCESSING"] } } });
}
