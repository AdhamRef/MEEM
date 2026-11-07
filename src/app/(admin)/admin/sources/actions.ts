"use server";

import { addSource, checkChannelNow, setChannelFollowed } from "@/features/youtube/sources/sources.service";
import { runAction } from "@/lib/http/action";

export async function addSourceAction(input: string) {
  return runAction("addSource", (actor) => addSource(actor, { input }));
}

export async function checkChannelNowAction(id: string) {
  return runAction("checkChannelNow", (actor) => checkChannelNow(actor, id));
}

export async function setChannelFollowedAction(id: string, isFollowed: boolean) {
  return runAction("setChannelFollowed", async (actor) => {
    await setChannelFollowed(actor, id, isFollowed);
    return undefined;
  });
}
