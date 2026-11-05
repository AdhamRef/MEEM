"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { changeUserRoleAction, setUserDeactivatedAction, setUserGrantsAction } from "@/app/(admin)/admin/users/actions";
import { selectClass } from "@/components/admin/content/list-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { strings } from "@/config/strings.ar";
import type { ActionResult } from "@/lib/http/action";
import { GRANTABLE_PERMISSIONS } from "@/lib/permissions";

const s = strings.system;

const ASSIGNABLE_ROLES = ["USER", "CONTRIBUTOR", "SCIENTIFIC_REVIEWER", "EDITOR", "ADMIN"] as const;

export interface UserView {
  id: string;
  name: string | null;
  email: string;
  role: "USER" | "CONTRIBUTOR" | "SCIENTIFIC_REVIEWER" | "EDITOR" | "ADMIN" | "SUPER_ADMIN";
  permissionGrants: string[];
  isDeactivated: boolean;
}

/** Only for those allowed. The services check again, and refuse any change to the super admin. */
export function UserRow({ user, canManage, isSelf }: { user: UserView; canManage: boolean; isSelf: boolean }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [role, setRole] = useState(user.role);
  const [grants, setGrants] = useState(new Set(user.permissionGrants));
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const isProtected = user.role === "SUPER_ADMIN" || isSelf;

  const run = async (work: () => Promise<ActionResult<undefined>>) => {
    setIsBusy(true);
    setMessage(null);
    const result = await work();
    setIsBusy(false);
    setMessage(result.ok ? { text: strings.adminContent.saved, isError: false } : { text: result.message, isError: true });
    if (result.ok) router.refresh();
  };

  return (
    <li className="space-y-3 p-3" data-testid="user-row" data-email={user.email}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <bdi className="truncate">{user.name ?? user.email}</bdi>
            <Badge variant="secondary" data-testid="user-role">
              {strings.admin.roles[user.role]}
            </Badge>
            {user.isDeactivated ? <Badge variant="destructive">{s.deactivated}</Badge> : null}
          </p>
          <p className="truncate text-xs text-text-secondary">
            <bdi dir="ltr">{user.email}</bdi>
          </p>
        </div>
        {canManage && !isProtected ? (
          <Button type="button" variant="ghost" onClick={() => setIsOpen(!isOpen)} aria-expanded={isOpen} data-testid="user-manage">
            {s.manage}
          </Button>
        ) : null}
        {user.role === "SUPER_ADMIN" ? <span className="text-xs text-text-secondary">{s.superAdminProtected}</span> : null}
      </div>

      {isOpen ? (
        <div className="space-y-4 rounded-lg border p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-48 flex-1 space-y-1.5 text-sm font-medium">
              {s.role}
              <select value={role} onChange={(event) => setRole(event.target.value as UserView["role"])} className={selectClass} data-testid="user-role-select">
                {ASSIGNABLE_ROLES.map((option) => (
                  <option key={option} value={option}>
                    {strings.admin.roles[option]}
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" variant="secondary" disabled={isBusy || role === user.role} onClick={() => run(() => changeUserRoleAction(user.id, role))} data-testid="user-role-save">
              {s.saveRole}
            </Button>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{s.grants}</legend>
            <p className="text-xs text-text-secondary">{s.grantsHint}</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {GRANTABLE_PERMISSIONS.map((permission) => (
                <label key={permission} className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={grants.has(permission)}
                    data-testid={`grant-${permission}`}
                    onChange={(event) => {
                      const next = new Set(grants);
                      if (event.target.checked) next.add(permission);
                      else next.delete(permission);
                      setGrants(next);
                    }}
                  />
                  {s.permissionLabels[permission]}
                </label>
              ))}
            </div>
            <Button type="button" variant="secondary" disabled={isBusy} onClick={() => run(() => setUserGrantsAction(user.id, [...grants]))} data-testid="user-grants-save">
              {s.saveGrants}
            </Button>
          </fieldset>

          <div className="border-t pt-3">
            {user.isDeactivated ? (
              <Button type="button" variant="secondary" disabled={isBusy} onClick={() => run(() => setUserDeactivatedAction(user.id, false))} data-testid="user-reactivate">
                {s.reactivate}
              </Button>
            ) : (
              <Button type="button" variant="destructive" disabled={isBusy} onClick={() => setIsConfirming(true)} data-testid="user-deactivate">
                {s.deactivateUser}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {message ? (
        <p role={message.isError ? "alert" : "status"} className={message.isError ? "text-sm text-destructive" : "text-sm text-text-secondary"} data-testid="user-message">
          {message.text}
        </p>
      ) : null}

      <Dialog open={isConfirming} onOpenChange={setIsConfirming}>
        <DialogContent data-testid="confirm-dialog">
          <DialogTitle className="text-lg font-semibold">{s.deactivateTitle}</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-text-secondary">{s.deactivateDescription}</DialogDescription>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setIsConfirming(false);
                void run(() => setUserDeactivatedAction(user.id, true));
              }}
              data-testid="confirm-yes"
            >
              {strings.adminContent.confirm}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {strings.adminContent.cancel}
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  );
}
