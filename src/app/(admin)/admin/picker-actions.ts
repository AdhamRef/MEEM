"use server";

import { addLink, listLinks, removeLink, setLibraryItemFeatured } from "@/features/relationships/links.service";
import { searchPicker, type PickerItem } from "@/features/relationships/picker.service";
import { getCurrentActor } from "@/lib/auth/session";
import { toPublicError } from "@/lib/errors";
import { runAction, type ActionResult } from "@/lib/http/action";
import { logger } from "@/lib/logger";

/** Reads, so this skips the write rate limit. It's fired as people type. */
export async function searchPickerAction(input: unknown): Promise<ActionResult<PickerItem[]>> {
  try {
    return { ok: true, data: await searchPicker(await getCurrentActor(), input) };
  } catch (error) {
    const publicError = toPublicError(error);
    if (publicError.status >= 500) logger.error("Picker search failed", { error });
    return { ok: false, message: publicError.message };
  }
}

export async function listLinksAction(input: unknown) {
  return runAction("listLinks", (actor) => listLinks(actor, input));
}

export async function addLinkAction(input: unknown) {
  return runAction("addLink", (actor) => addLink(actor, input));
}

export async function removeLinkAction(input: unknown) {
  return runAction("removeLink", (actor) => removeLink(actor, input));
}

export async function setLibraryItemFeaturedAction(input: unknown) {
  return runAction("setLibraryItemFeatured", (actor) => setLibraryItemFeatured(actor, input));
}
