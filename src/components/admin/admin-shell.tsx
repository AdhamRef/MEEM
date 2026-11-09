import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/shared/brand-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { hasPermission, type Actor, type Permission } from "@/lib/permissions";
import { AdminMobileNav, AdminNav, type AdminNavKey } from "./admin-nav";
import { AdminSignOut } from "./admin-sign-out";

function Identity({ actor }: { actor: Actor }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <BrandMark className="size-9 shrink-0" />
      <div className="min-w-0">
        <p className="truncate font-semibold leading-tight">{strings.admin.title}</p>
        <Badge variant="secondary" className="mt-1">
          {strings.admin.roles[actor.role]}
        </Badge>
      </div>
    </div>
  );
}

/** Only sections this person can use are listed. Each service checks the permission again. */
export function AdminShell({ actor, children }: { actor: Actor; children: ReactNode }) {
  // Everyone on the team can open the article list and the structure, which show what they may see.
  const can = (permission: Permission) => hasPermission(actor, permission);
  const sections: AdminNavKey[] = [
    "overview",
    "structure",
    "articles",
    ...(can("playlists.manage") || can("youtube.import") ? (["playlists"] as const) : []),
    ...(can("content.viewAny") ? (["shorts"] as const) : []),
    ...(can("relationships.manage") ? (["resources"] as const) : []),
    ...(can("youtube.import") && can("content.publish") ? (["sources", "sourceDrafts"] as const) : []),
    ...(can("youtube.import") ? (["youtubeStatus"] as const) : []),
    ...(can("users.view") ? (["users"] as const) : []),
    ...(can("audit.view") ? (["auditLogs"] as const) : []),
    ...(can("settings.manage") ? (["settings"] as const) : []),
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <a
        href="#admin-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface-elevated focus:px-4 focus:py-2"
      >
        {strings.navigation.skipToContent}
      </a>

      {/* Phones: a slim bar, with the sections in a sheet. */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-surface/90 px-3 py-2 backdrop-blur md:hidden">
        <AdminMobileNav sections={sections} />
        <Identity actor={actor} />
        <Button asChild variant="ghost" size="icon" className="ms-auto" aria-label={strings.admin.backToSite}>
          <Link href="/">
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </header>

      {/* Wider screens: a fixed sidebar, grouped by what the sections are for. */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 border-e bg-surface px-3 py-5 md:flex">
        <div className="px-2">
          <Identity actor={actor} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AdminNav sections={sections} />
        </div>
        <div className="flex flex-col gap-1 border-t pt-3">
          <Button asChild variant="ghost" className="justify-start">
            <Link href="/">
              {/* Points right on purpose: in Arabic, "back" is toward the start of the line. */}
              <ArrowRight aria-hidden data-icon="inline-start" />
              {strings.admin.backToSite}
            </Link>
          </Button>
          <div className="[&>button]:w-full [&>button]:justify-start">
            <AdminSignOut />
          </div>
        </div>
      </aside>

      <main id="admin-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
        {children}
      </main>
    </div>
  );
}
