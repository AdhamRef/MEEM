import type { Prisma } from "@prisma/client";
import { publicContentFilter } from "@/features/content/common";

/** A YouTube playlist whose data was withdrawn has a blank title, which keeps it off public pages. */
export const publicPlaylistFilter = { ...publicContentFilter, title: { not: "" } } satisfies Prisma.PlaylistWhereInput;

export const playlistCardSelect = {
  id: true,
  type: true,
  title: true,
  slug: true,
  description: true,
  coverImage: true,
  thumbnails: true,
  itemCount: true,
  channelTitle: true,
} satisfies Prisma.PlaylistSelect;

export type PlaylistCardData = Prisma.PlaylistGetPayload<{ select: typeof playlistCardSelect }>;
