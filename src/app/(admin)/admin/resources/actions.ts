"use server";

import { createResource, deleteResource, setResourceArchived, setResourcePublished, updateResource } from "@/features/resources/resources.service";
import { runAction } from "@/lib/http/action";

export async function createResourceAction(input: unknown) {
  return runAction("createResource", async (actor) => ({ id: (await createResource(actor, input)).id }));
}

export async function updateResourceAction(id: string, input: unknown) {
  return runAction("updateResource", async (actor) => ({ id: (await updateResource(actor, id, input)).id }));
}

export async function setResourcePublishedAction(id: string, isPublished: boolean) {
  return runAction("setResourcePublished", async (actor) => {
    await setResourcePublished(actor, id, isPublished);
    return undefined;
  });
}

export async function setResourceArchivedAction(id: string, isArchived: boolean) {
  return runAction("setResourceArchived", async (actor) => {
    await setResourceArchived(actor, id, isArchived);
    return undefined;
  });
}

export async function deleteResourceAction(id: string) {
  return runAction("deleteResource", async (actor) => {
    await deleteResource(actor, id);
    return undefined;
  });
}
