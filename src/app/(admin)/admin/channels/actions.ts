"use server";

import { setChannelActive } from "@/features/youtube/channels.service";
import { runAction } from "@/lib/http/action";

export async function setChannelActiveAction(id: string, isActive: boolean) {
  return runAction("setChannelActive", async (actor) => {
    await setChannelActive(actor, id, isActive);
    return undefined;
  });
}
