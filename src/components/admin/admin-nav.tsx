"use client";

import { Activity, BookOpen, Clapperboard, DownloadCloud, Layers, ExternalLink, LayoutDashboard, LayoutGrid, Library, ListVideo, ScrollText, Settings, Tv, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { strings } from "@/config/strings.ar";
import { cn } from "@/lib/utils";

const ITEMS = {
  overview: { href: "/admin", label: strings.admin.overview, icon: LayoutDashboard },
  shorts: { href: "/admin/shorts", label: strings.admin.shorts, icon: Clapperboard },
  importer: { href: "/admin/youtube-importer", label: strings.importer.title, icon: DownloadCloud },
  channels: { href: "/admin/channels", label: strings.admin.channels, icon: Tv },
  articles: { href: "/admin/articles", label: strings.admin.articles, icon: BookOpen },
  topics: { href: "/admin/topics", label: strings.admin.topics, icon: LayoutGrid },
  libraries: { href: "/admin/libraries", label: strings.admin.libraries, icon: Library },
  playlists: { href: "/admin/playlists", label: strings.admin.playlists, icon: ListVideo },
  resources: { href: "/admin/resources", label: strings.admin.resources, icon: ExternalLink },
  collections: { href: "/admin/collections", label: strings.collections.title, icon: Layers },
  users: { href: "/admin/users", label: strings.admin.users, icon: Users },
  auditLogs: { href: "/admin/audit-logs", label: strings.admin.auditLogs, icon: ScrollText },
  settings: { href: "/admin/settings", label: strings.admin.settings, icon: Settings },
  youtubeStatus: { href: "/admin/youtube-status", label: strings.admin.youtubeStatus, icon: Activity },
} as const;

export type AdminNavKey = keyof typeof ITEMS;

/** The shell decides which sections this person sees. The services check again on every action. */
export function AdminNav({ sections }: { sections: AdminNavKey[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label={strings.admin.navigationLabel} className="flex gap-1 overflow-x-auto border-b bg-surface p-2 md:w-56 md:shrink-0 md:flex-col md:border-e md:border-b-0">
      {sections.map((key) => {
        const { href, label, icon: Icon } = ITEMS[key];
        const isCurrent = href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={key}
            href={href}
            aria-current={isCurrent ? "page" : undefined}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              isCurrent ? "bg-surface-elevated font-medium" : "text-text-secondary hover:bg-surface-elevated",
            )}
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
