import { ScrollText, ShieldX } from "lucide-react";
import Link from "next/link";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { strings } from "@/config/strings.ar";
import { listAuditLogs } from "@/features/admin/system.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";

export const metadata = { title: strings.admin.auditLogs };

const dateTime = new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<{ action?: string; actor?: string; cursor?: string }> }) {
  const access = await checkPageAccess("admin.access", "/admin/audit-logs");
  if (!access.allowed) return null;
  if (!hasPermission(access.actor, "audit.view")) return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;

  const { action, actor: actorQuery, cursor } = await searchParams;
  const page = await listAuditLogs(access.actor, { action: action || undefined, actor: actorQuery || undefined, cursor });

  const nextParams = new URLSearchParams();
  if (action) nextParams.set("action", action);
  if (actorQuery) nextParams.set("actor", actorQuery);
  if (page.nextCursor) nextParams.set("cursor", page.nextCursor);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">{strings.admin.auditLogs}</h1>
        <p className="text-sm text-text-secondary">{strings.system.auditHint}</p>
      </div>

      <form method="get" role="search" className="flex flex-col gap-2 sm:flex-row">
        <Input name="action" dir="ltr" defaultValue={action} placeholder={strings.system.auditAction} aria-label={strings.system.auditAction} className="sm:flex-1" />
        <Input name="actor" dir="ltr" type="search" defaultValue={actorQuery} placeholder={strings.system.auditActor} aria-label={strings.system.auditActor} className="sm:flex-1" />
        <Button type="submit" variant="secondary">
          {strings.adminContent.searchAction}
        </Button>
      </form>

      {page.items.length === 0 ? (
        <StateMessage icon={ScrollText} title={action || actorQuery ? strings.adminContent.noResults : strings.system.auditEmpty} />
      ) : (
        <ul className="divide-y rounded-xl border bg-surface text-sm" data-testid="audit-list">
          {page.items.map((entry) => (
            <li key={entry.id} className="space-y-1 p-3" data-testid="audit-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <code dir="ltr" className="font-medium">
                  {entry.action}
                </code>
                <time dateTime={entry.createdAt.toISOString()} className="text-xs text-text-secondary">
                  {dateTime.format(entry.createdAt)} UTC
                </time>
              </div>
              <p className="text-xs text-text-secondary">
                <bdi dir="ltr">{entry.actorEmail ?? strings.system.auditSystem}</bdi>
                {entry.actorRole ? ` · ${strings.admin.roles[entry.actorRole]}` : ""} · <bdi dir="ltr">{entry.entityType}</bdi>
                {entry.entityId ? (
                  <>
                    {" "}
                    · <bdi dir="ltr">{entry.entityId}</bdi>
                  </>
                ) : null}
              </p>
              {entry.metadata ? (
                <details className="text-xs">
                  <summary className="min-h-6 cursor-pointer text-text-secondary">{strings.system.auditDetails}</summary>
                  <pre dir="ltr" className="mt-1 overflow-x-auto rounded-md bg-surface-elevated p-2 text-start">
                    {JSON.stringify(entry.metadata, null, 2)}
                  </pre>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {page.nextCursor ? (
        <Link href={`/admin/audit-logs?${nextParams}`} className="text-sm text-brand underline-offset-4 hover:underline">
          {strings.adminContent.nextPage}
        </Link>
      ) : null}
    </div>
  );
}
