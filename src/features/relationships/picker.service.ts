import { z } from "zod";
import { strings } from "@/config/strings.ar";
import { AppError } from "@/lib/errors";
import { assertPermission, hasPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { normalizeArabicForSearch } from "@/lib/search/normalize";

export const PICKER_TYPES = ["ARTICLE", "VIDEO", "TOPIC", "LIBRARY", "PLAYLIST", "RESOURCE", "STAFF", "CHANNEL"] as const;
export type PickerType = (typeof PICKER_TYPES)[number];

export interface PickerItem {
  id: string;
  type: PickerType;
  label: string;
  hint?: string;
  isDraft?: boolean;
  /** Where the item lives on the site, for editors linking to it from an article. */
  href?: string;
}

const pickerQuerySchema = z.strictObject({
  type: z.enum(PICKER_TYPES),
  query: z.string().max(120).default(""),
  excludeId: z.string().optional(),
});

const RESULT_LIMIT = 20;
const STAFF_ROLES = ["CONTRIBUTOR", "SCIENTIFIC_REVIEWER", "EDITOR", "ADMIN", "SUPER_ADMIN"] as const;

/** YouTube is credited on each item that shows its content, here too. */
export const videoPickerLabel = (video: { kind: string; channelTitle: string | null }) =>
  [video.kind === "SHORT" ? strings.content.short : strings.content.longVideo, video.channelTitle, strings.feed.source].filter(Boolean).join(" · ");

export const channelPickerLabel = (channel: { handle: string | null }) => [channel.handle, strings.feed.source].filter(Boolean).join(" · ");

/**
 * Searchable selection for editors (§13.3). Staff without content.viewAny see only published
 * items, so a picker can't reveal someone else's unpublished titles.
 */
export async function searchPicker(actor: Actor | null, rawInput: unknown): Promise<PickerItem[]> {
  assertPermission(actor, "admin.access");
  const parsed = pickerQuerySchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { type, query, excludeId } = parsed.data;

  const search = normalizeArabicForSearch(query);
  const matches = search ? { titleSearch: { contains: search } } : {};
  const notSelf = excludeId ? { id: { not: excludeId } } : {};
  const visibility = hasPermission(actor, "content.viewAny") ? {} : { status: "PUBLISHED" as const };
  const where = { ...matches, ...notSelf, ...visibility, isArchived: false };
  const common = { orderBy: { updatedAt: "desc" as const }, take: RESULT_LIMIT };
  const isDraft = (status: string) => status === "DRAFT";

  switch (type) {
    case "ARTICLE":
      return (await prisma.article.findMany({ ...common, where, select: { id: true, title: true, status: true, slug: true } })).map((row) => ({
        id: row.id,
        type,
        label: row.title,
        isDraft: isDraft(row.status),
        href: `/articles/${encodeURIComponent(row.slug)}`,
      }));
    case "TOPIC":
      return (await prisma.topic.findMany({ ...common, where, select: { id: true, title: true, status: true } })).map((row) => ({ id: row.id, type, label: row.title, isDraft: isDraft(row.status) }));
    case "LIBRARY":
      return (await prisma.library.findMany({ ...common, where, select: { id: true, name: true, status: true } })).map((row) => ({ id: row.id, type, label: row.name, isDraft: isDraft(row.status) }));
    case "PLAYLIST":
      return (await prisma.playlist.findMany({ ...common, where: { ...where, title: { not: "" } }, select: { id: true, title: true, status: true } })).map((row) => ({ id: row.id, type, label: row.title, isDraft: isDraft(row.status) }));
    case "RESOURCE":
      return (await prisma.externalResource.findMany({ ...common, where, select: { id: true, title: true, sourceName: true, status: true } })).map((row) => ({
        id: row.id,
        type,
        label: row.title,
        hint: row.sourceName,
        isDraft: isDraft(row.status),
      }));
    case "VIDEO":
      return (await prisma.video.findMany({ ...common, where: { ...where, title: { not: "" } }, select: { id: true, title: true, kind: true, channelTitle: true, status: true } })).map((row) => ({
        id: row.id,
        type,
        label: row.title,
        hint: videoPickerLabel(row),
        isDraft: isDraft(row.status),
      }));
    case "CHANNEL": {
      // A channel whose data was withdrawn has no name to choose it by.
      const channels = await prisma.youTubeChannel.findMany({
        where: { title: query ? { contains: query.trim(), mode: "insensitive" } : { not: "" }, ...notSelf },
        orderBy: { title: "asc" },
        take: RESULT_LIMIT,
        select: { id: true, title: true, handle: true },
      });
      return channels.filter((row) => row.title).map((row) => ({ id: row.id, type, label: row.title, hint: channelPickerLabel(row) }));
    }
    case "STAFF": {
      // Who can be assigned is only useful, and only visible, to people who can assign.
      assertPermission(actor, "content.editAny");
      const staff = await prisma.user.findMany({
        where: {
          role: { in: [...STAFF_ROLES] },
          isDeactivated: false,
          ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }] } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: RESULT_LIMIT,
        select: { id: true, name: true, email: true, role: true },
      });
      return staff.map((row) => ({ id: row.id, type, label: row.name ?? row.email, hint: `${row.email} · ${strings.admin.roles[row.role]}` }));
    }
  }
}
