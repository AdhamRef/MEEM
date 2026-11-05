"use server";

import { createCategory, setCategoryActive, updateCategory } from "@/features/categories/categories.service";
import { runAction } from "@/lib/http/action";

export async function createCategoryAction(input: unknown) {
  return runAction("createCategory", async (actor) => {
    await createCategory(actor, input);
    return undefined;
  });
}

export async function updateCategoryAction(id: string, input: unknown) {
  return runAction("updateCategory", async (actor) => {
    await updateCategory(actor, id, input);
    return undefined;
  });
}

export async function setCategoryActiveAction(id: string, isActive: boolean) {
  return runAction("setCategoryActive", async (actor) => {
    await setCategoryActive(actor, id, isActive);
    return undefined;
  });
}
