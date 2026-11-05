"use server";

import {
  addCollectionItem,
  createCollection,
  deleteCollection,
  removeCollectionItem,
  reorderCollectionItems,
  setCollectionArchived,
  setCollectionPublished,
  updateCollection,
} from "@/features/collections/collections.service";
import { runAction } from "@/lib/http/action";

const done = async (work: Promise<unknown>) => {
  await work;
  return undefined;
};

export async function createCollectionAction(input: unknown) {
  return runAction("createCollection", async (actor) => ({ id: (await createCollection(actor, input)).id }));
}

export async function updateCollectionAction(id: string, input: unknown) {
  return runAction("updateCollection", async (actor) => ({ id: (await updateCollection(actor, id, input)).id }));
}

export async function setCollectionPublishedAction(id: string, isPublished: boolean) {
  return runAction("setCollectionPublished", (actor) => done(setCollectionPublished(actor, id, isPublished)));
}

export async function setCollectionArchivedAction(id: string, isArchived: boolean) {
  return runAction("setCollectionArchived", (actor) => done(setCollectionArchived(actor, id, isArchived)));
}

export async function deleteCollectionAction(id: string) {
  return runAction("deleteCollection", (actor) => done(deleteCollection(actor, id)));
}

export async function addCollectionItemAction(input: unknown) {
  return runAction("addCollectionItem", (actor) => done(addCollectionItem(actor, input)));
}

export async function removeCollectionItemAction(collectionId: string, itemId: string) {
  return runAction("removeCollectionItem", (actor) => done(removeCollectionItem(actor, collectionId, itemId)));
}

export async function reorderCollectionItemsAction(collectionId: string, itemIds: string[]) {
  return runAction("reorderCollectionItems", (actor) => done(reorderCollectionItems(actor, collectionId, itemIds)));
}
