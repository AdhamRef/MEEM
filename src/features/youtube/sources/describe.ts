import { strings } from "@/config/strings.ar";

const t = strings.sources;

/** The outcome of adding a source. Kept apart from the service, so the browser can import it. */
export type AddSourceResult =
  | { kind: "channel"; id: string; title: string; wasFollowed: boolean }
  | { kind: "playlist"; id: string; title: string; isPublished: boolean; importedVideos: number }
  | { kind: "videos"; imported: number; duplicates: number; notFound: number };

export function describeAddResult(result: AddSourceResult): string {
  switch (result.kind) {
    case "channel":
      return result.wasFollowed ? t.alreadyFollowed(result.title) : t.addedChannel(result.title);
    case "playlist":
      return result.isPublished ? t.addedPlaylist(result.title, result.importedVideos) : t.addedPlaylistDraft(result.title);
    case "videos":
      return t.addedVideos(result.imported, result.duplicates, result.notFound);
  }
}

/** Where to look at what was added, in the dashboard. */
export function addResultHref(result: AddSourceResult): string {
  if (result.kind === "channel") return `/admin/sources/channels/${result.id}`;
  if (result.kind === "playlist") return `/admin/playlists/${result.id}`;
  return "/admin/sources";
}
