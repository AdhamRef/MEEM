"use client";

import { Activity, BookOpen, Clapperboard, ExternalLink, Inbox, LayoutDashboard, ListVideo, Menu, Network, ScrollText, Settings, Tv, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { strings } from "@/config/strings.ar";
import { cn } from "@/lib/utils";
import { AdminSignOut } from "./admin-sign-out";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: keyof typeof strings.adminNav.groups;
}

const ITEMS = {
  overview: { href: "/admin", label: strings.admin.overview, icon: LayoutDashboard, group: "main" },
  structure: { href: "/admin/structure", label: strings.structure.navLabel, icon: Network, group: "content" },
  articles: { href: "/admin/articles", label: strings.admin.articles, icon: BookOpen, group: "content" },
  playlists: { href: "/admin/playlists", label: strings.admin.playlists, icon: ListVideo, group: "content" },
  shorts: { href: "/admin/shorts", label: strings.admin.shorts, icon: Clapperboard, group: "content" },
  resources: { href: "/admin/resources", label: strings.admin.resources, icon: ExternalLink, group: "content" },
  sources: { href: "/admin/sources", label: strings.sources.title, icon: Tv, group: "sources" },
  sourceDrafts: { href: "/admin/sources/drafts", label: strings.sourceDrafts.navLabel, icon: Inbox, group: "sources" },
  youtubeStatus: { href: "/admin/youtube-status", label: strings.admin.youtubeStatus, icon: Activity, group: "sources" },
  users: { href: "/admin/users", label: strings.admin.users, icon: Users, group: "system" },
  auditLogs: { href: "/admin/audit-logs", label: strings.admin.auditLogs, icon: ScrollText, group: "system" },
  settings: { href: "/admin/settings", label: strings.admin.settings, icon: Settings, group: "system" },
} as const satisfies Record<string, NavItem>;

export type AdminNavKey = keyof typeof ITEMS;

const GROUP_ORDER = ["main", "content", "sources", "system"] as const;

/** Old addresses that now open inside another section, so that section stays marked. */
const ALIASES: Partial<Record<AdminNavKey, string[]>> = { structure: ["/admin/topics", "/admin/libraries", "/admin/collections"] };

function isCurrent(key: AdminNavKey, pathname: string): boolean {
  const { href } = ITEMS[key];
  if (key === "overview") return pathname === href;
  // The queue lives under Sources, so Sources is current only when the queue isn't.
  if (key === "sources" && pathname.startsWith("/admin/sources/drafts")) return false;
  return [href, ...(ALIASES[key] ?? [])].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function NavList({ sections, onNavigate }: { sections: AdminNavKey[]; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-5">
      {GROUP_ORDER.map((group) => {
        const keys = sections.filter((key) => ITEMS[key].group === group);
        if (!keys.length) return null;
        return (
          <div key={group} className="flex flex-col gap-0.5">
            {group !== "main" ? <p className="px-3 pb-1 text-[11px] font-semibold tracking-normal text-subtle">{strings.adminNav.groups[group]}</p> : null}
            {keys.map((key) => {
              const { href, label, icon: Icon } = ITEMS[key];
              const current = isCurrent(key, pathname);
              return (
                <Link
                  key={key}
                  href={href}
                  onClick={onNavigate}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "group/nav relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                    current ? "bg-brand/12 font-semibold text-text-primary" : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary",
                  )}
                  data-testid={`admin-nav-${key}`}
                >
                  {current ? <span aria-hidden className="absolute inset-y-2 start-0 w-1 rounded-full bg-brand" /> : null}
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors", current ? "bg-brand text-primary-foreground" : "bg-surface-elevated text-text-secondary group-hover/nav:text-text-primary")}>
                    <Icon aria-hidden className="size-4" />
                  </span>
                  {label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** The shell decides which sections this person sees. The services check again on every action. */
export function AdminNav({ sections }: { sections: AdminNavKey[] }) {
  return (
    <nav aria-label={strings.admin.navigationLabel}>
      <NavList sections={sections} />
    </nav>
  );
}

export function AdminMobileNav({ sections }: { sections: AdminNavKey[] }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={strings.adminNav.openMenu} data-testid="admin-menu">
          <Menu aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent dir="rtl" closeLabel={strings.feed.close} className="overflow-y-auto">
        <SheetTitle className="pe-12 text-base font-semibold">{strings.adminNav.menuTitle}</SheetTitle>
        <nav aria-label={strings.admin.navigationLabel}>
          <NavList sections={sections} onNavigate={() => setIsOpen(false)} />
        </nav>
        <div className="border-t pt-3">
          <AdminSignOut />
        </div>
      </SheetContent>
    </Sheet>
  );
}
