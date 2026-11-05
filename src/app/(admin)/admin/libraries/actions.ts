"use server";

import { createLibrary, deleteLibrary, setLibraryArchived, setLibraryPublished, updateLibrary } from "@/features/libraries/libraries.service";
import { runAction } from "@/lib/http/action";

export async function createLibraryAction(input: unknown) {
  return runAction("createLibrary", async (actor) => ({ id: (await createLibrary(actor, input)).id }));
}

export async function updateLibraryAction(id: string, input: unknown) {
  return runAction("updateLibrary", async (actor) => ({ id: (await updateLibrary(actor, id, input)).id }));
}

export async function setLibraryPublishedAction(id: string, isPublished: boolean) {
  return runAction("setLibraryPublished", async (actor) => {
    await setLibraryPublished(actor, id, isPublished);
    return undefined;
  });
}

export async function setLibraryArchivedAction(id: string, isArchived: boolean) {
  return runAction("setLibraryArchived", async (actor) => {
    await setLibraryArchived(actor, id, isArchived);
    return undefined;
  });
}

export async function deleteLibraryAction(id: string) {
  return runAction("deleteLibrary", async (actor) => {
    await deleteLibrary(actor, id);
    return undefined;
  });
}
