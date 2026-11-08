"use server";

import { addSourceDraftNow, createSourceDraft, deleteSourceDraft, setDraftAutoAdd } from "@/features/youtube/sources/drafts.service";
import { runAction } from "@/lib/http/action";

export async function createSourceDraftAction(input: { input: string; label?: string; note?: string; autoAdd: boolean }) {
  return runAction("createSourceDraft", (actor) => createSourceDraft(actor, input));
}

export async function addSourceDraftNowAction(id: string) {
  return runAction("addSourceDraftNow", (actor) => addSourceDraftNow(actor, id));
}

export async function setDraftAutoAddAction(id: string, autoAdd: boolean) {
  return runAction("setDraftAutoAdd", async (actor) => {
    await setDraftAutoAdd(actor, id, autoAdd);
    return undefined;
  });
}

export async function deleteSourceDraftAction(id: string) {
  return runAction("deleteSourceDraft", async (actor) => {
    await deleteSourceDraft(actor, id);
    return undefined;
  });
}
