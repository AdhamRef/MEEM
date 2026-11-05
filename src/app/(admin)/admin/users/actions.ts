"use server";

import { changeUserRole, setUserDeactivated, setUserPermissionGrants } from "@/features/users/user-admin.service";
import { runAction } from "@/lib/http/action";

export async function changeUserRoleAction(id: string, role: string) {
  return runAction("changeUserRole", async (actor) => {
    await changeUserRole(actor, id, role);
    return undefined;
  });
}

export async function setUserGrantsAction(id: string, grants: string[]) {
  return runAction("setUserGrants", async (actor) => {
    await setUserPermissionGrants(actor, id, grants);
    return undefined;
  });
}

export async function setUserDeactivatedAction(id: string, isDeactivated: boolean) {
  return runAction("setUserDeactivated", async (actor) => {
    await setUserDeactivated(actor, id, isDeactivated);
    return undefined;
  });
}
