import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/shared/brand-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { hasPermission, type Actor, type Permission } from "@/lib/permissions";
import { AdminNav, type AdminNavKey } from "./admin-nav";
import { AdminSignOut } from "./admin-sign-out";

/** Only sections that exist are listed. Later phases add theirs, each with its own permission. */
export function AdminShell({ actor, children }: { actor: Actor; children: ReactNode }) {
  // Everyone on the team can open the article list, which shows them only what they may see.
  const can = (permission: Permission) => hasPermission(actor, permission);
  const sections: AdminNavKey[] = [
    "overview",
    ...(can("youtube.import") && can("content.publish") ? (["sources", "sourceDrafts"] as const) : []),
    ...(can("content.viewAny") ? (["shorts"] as const) : []),
    "articles",
    ...(can("topics.manage") ? (["topics"] as const) : []),
    ...(can("libraries.manage") ? (["libraries"] as const) : []),
    ...(can("playlists.manage") || can("youtube.import") ? (["playlists"] as const) : []),
    ...(can("relationships.manage") ? (["resources"] as const) : []),
    ...(can("topics.manage") ? (["collections"] as const) : []),
    ...(can("users.view") ? (["users"] as const) : []),
    ...(can("audit.view") ? (["auditLogs"] as const) : []),
    ...(can("settings.manage") ? (["settings"] as const) : []),
    ...(can("youtube.import") ? (["youtubeStatus"] as const) : []),
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#admin-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface-elevated focus:px-4 focus:py-2"
      >
        {strings.navigation.skipToContent}
      </a>

      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-surface px-4 py-2.5">
        <BrandMark className="size-8" />
        <span className="font-semibold">{strings.admin.title}</span>
        <Badge variant="secondary">{strings.admin.roles[actor.role]}</Badge>
        <div className="ms-auto flex items-center gap-1">
          <Button asChild variant="ghost">
            <Link href="/">
              {/* Points right on purpose: in Arabic, "back" is toward the start of the line. */}
              <ArrowRight aria-hidden data-icon="inline-start" />
              {strings.admin.backToSite}
            </Link>
          </Button>
          <AdminSignOut />
        </div>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        <AdminNav sections={sections} />

        <main id="admin-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
