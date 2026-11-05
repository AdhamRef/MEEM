"use server";

import {
  addPlaylistItem,
  createCuratedPlaylist,
  deletePlaylist,
  importYouTubePlaylist,
  removePlaylistItem,
  reorderPlaylistItems,
  setPlaylistArchived,
  setPlaylistItemNote,
  setPlaylistPublished,
  syncPlaylistNow,
  updatePlaylist,
} from "@/features/playlists/playlists.service";
import { runAction } from "@/lib/http/action";

export async function createCuratedPlaylistAction(input: unknown) {
  return runAction("createCuratedPlaylist", async (actor) => ({ id: (await createCuratedPlaylist(actor, input)).id }));
}

export async function importYouTubePlaylistAction(input: unknown) {
  return runAction("importYouTubePlaylist", async (actor) => ({ id: (await importYouTubePlaylist(actor, input)).id }));
}

export async function updatePlaylistAction(id: string, input: unknown) {
  return runAction("updatePlaylist", async (actor) => ({ id: (await updatePlaylist(actor, id, input)).id }));
}

export async function syncPlaylistAction(id: string) {
  return runAction("syncPlaylist", (actor) => syncPlaylistNow(actor, id));
}

export async function setPlaylistPublishedAction(id: string, isPublished: boolean) {
  return runAction("setPlaylistPublished", async (actor) => {
    await setPlaylistPublished(actor, id, isPublished);
    return undefined;
  });
}

export async function setPlaylistArchivedAction(id: string, isArchived: boolean) {
  return runAction("setPlaylistArchived", async (actor) => {
    await setPlaylistArchived(actor, id, isArchived);
    return undefined;
  });
}

export async function deletePlaylistAction(id: string) {
  return runAction("deletePlaylist", async (actor) => {
    await deletePlaylist(actor, id);
    return undefined;
  });
}

export async function addPlaylistItemAction(playlistId: string, videoId: string) {
  return runAction("addPlaylistItem", async (actor) => {
    await addPlaylistItem(actor, { playlistId, videoId });
    return undefined;
  });
}

export async function removePlaylistItemAction(playlistId: string, videoId: string) {
  return runAction("removePlaylistItem", async (actor) => {
    await removePlaylistItem(actor, { playlistId, videoId });
    return undefined;
  });
}

export async function reorderPlaylistItemsAction(playlistId: string, videoIds: string[]) {
  return runAction("reorderPlaylistItems", async (actor) => {
    await reorderPlaylistItems(actor, { playlistId, videoIds });
    return undefined;
  });
}

export async function setPlaylistItemNoteAction(playlistId: string, videoId: string, note: string | null) {
  return runAction("setPlaylistItemNote", async (actor) => {
    await setPlaylistItemNote(actor, { playlistId, videoId, note });
    return undefined;
  });
}
