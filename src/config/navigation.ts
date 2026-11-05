import { Bookmark, Compass, House, LayoutGrid, Search, type LucideIcon } from "lucide-react";
import { strings } from "./strings.ar";

export interface NavigationDestination {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * False until the destination's phase ships. It then renders as a disabled item instead of
   * a link, so the navigation never offers a page that doesn't exist (specification §1.5).
   */
  isAvailable: boolean;
}

export const navigationDestinations: NavigationDestination[] = [
  { key: "home", label: strings.navigation.home, href: "/", icon: House, isAvailable: true },
  { key: "explore", label: strings.navigation.explore, href: "/explore", icon: Compass, isAvailable: true },
  { key: "topics", label: strings.navigation.topics, href: "/topics", icon: LayoutGrid, isAvailable: true },
  { key: "library", label: strings.navigation.library, href: "/saved", icon: Bookmark, isAvailable: true },
  { key: "search", label: strings.navigation.search, href: "/search", icon: Search, isAvailable: true },
];

/** Exact match for home. Other destinations also stay active on their nested pages. */
export function isDestinationActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
