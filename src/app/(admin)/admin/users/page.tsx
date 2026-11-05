import { ShieldX, Users } from "lucide-react";
import Link from "next/link";
import { selectClass } from "@/components/admin/content/list-frame";
import { UserRow } from "@/components/admin/system/user-row";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { strings } from "@/config/strings.ar";
import { listUsers } from "@/features/admin/system.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";

export const metadata = { title: strings.admin.users };

const ROLES = ["USER", "CONTRIBUTOR", "SCIENTIFIC_REVIEWER", "EDITOR", "ADMIN", "SUPER_ADMIN"] as const;

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ query?: string; role?: string; cursor?: string }> }) {
  const access = await checkPageAccess("admin.access", "/admin/users");
  if (!access.allowed) return null;
  const { actor } = access;
  if (!hasPermission(actor, "users.view")) return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;

  const { query, role, cursor } = await searchParams;
  const validRole = ROLES.find((option) => option === role);
  const page = await listUsers(actor, { query: query || undefined, role: validRole, cursor });
  const canManage = hasPermission(actor, "users.manage");

  const nextParams = new URLSearchParams();
  if (query) nextParams.set("query", query);
  if (validRole) nextParams.set("role", validRole);
  if (page.nextCursor) nextParams.set("cursor", page.nextCursor);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8">
      <h1 className="text-2xl font-semibold">{strings.admin.users}</h1>
      {canManage ? null : <p className="text-sm text-text-secondary">{strings.system.viewOnly}</p>}

      <form method="get" role="search" className="flex flex-col gap-2 sm:flex-row">
        <Input name="query" type="search" defaultValue={query} placeholder={strings.system.searchUsers} aria-label={strings.system.searchUsers} className="sm:flex-1" />
        <select name="role" defaultValue={validRole ?? ""} aria-label={strings.system.role} className={`${selectClass} sm:w-48`}>
          <option value="">{strings.system.allRoles}</option>
          {ROLES.map((option) => (
            <option key={option} value={option}>
              {strings.admin.roles[option]}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          {strings.adminContent.searchAction}
        </Button>
      </form>

      {page.items.length === 0 ? (
        <StateMessage icon={Users} title={strings.adminContent.noResults} />
      ) : (
        <ul className="divide-y rounded-xl border bg-surface" data-testid="user-list">
          {page.items.map((user) => (
            <UserRow key={user.id} user={user} canManage={canManage} isSelf={user.id === actor.id} />
          ))}
        </ul>
      )}

      {page.nextCursor ? (
        <Link href={`/admin/users?${nextParams}`} className="text-sm text-brand underline-offset-4 hover:underline">
          {strings.adminContent.nextPage}
        </Link>
      ) : null}
    </div>
  );
}
