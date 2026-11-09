"use server";

import { createStructureNode, moveStructureNode } from "@/features/structure/structure.service";
import { runAction } from "@/lib/http/action";

export async function moveStructureNodeAction(input: unknown) {
  return runAction("moveStructureNode", async (actor) => {
    await moveStructureNode(actor, input);
    return undefined;
  });
}

export async function createStructureNodeAction(input: unknown) {
  return runAction("createStructureNode", (actor) => createStructureNode(actor, input));
}
