"use server";

import { createTopic, deleteTopic, setTopicArchived, setTopicPublished, updateTopic } from "@/features/topics/topics.service";
import { runAction } from "@/lib/http/action";

export async function createTopicAction(input: unknown) {
  return runAction("createTopic", async (actor) => ({ id: (await createTopic(actor, input)).id }));
}

export async function updateTopicAction(id: string, input: unknown) {
  return runAction("updateTopic", async (actor) => ({ id: (await updateTopic(actor, id, input)).id }));
}

export async function setTopicPublishedAction(id: string, isPublished: boolean) {
  return runAction("setTopicPublished", async (actor) => {
    await setTopicPublished(actor, id, isPublished);
    return undefined;
  });
}

export async function setTopicArchivedAction(id: string, isArchived: boolean) {
  return runAction("setTopicArchived", async (actor) => {
    await setTopicArchived(actor, id, isArchived);
    return undefined;
  });
}

export async function deleteTopicAction(id: string) {
  return runAction("deleteTopic", async (actor) => {
    await deleteTopic(actor, id);
    return undefined;
  });
}
