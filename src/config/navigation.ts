import { Compass, House, LayoutGrid, Search, UserRound, type LucideIcon } from "lucide-react";
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
  /** Other pages that belong to this destination, so it stays marked while they're open. */
  includes?: string[];
}

export const navigationDestinations: NavigationDestination[] = [
  { key: "home", label: strings.navigation.home, href: "/", icon: House, isAvailable: true },
  { key: "explore", label: strings.navigation.explore, href: "/explore", icon: Compass, isAvailable: true },
  { key: "topics", label: strings.navigation.topics, href: "/topics", icon: LayoutGrid, isAvailable: true },
  // The account and the library together, in place of a separate account button (owner's request, 2026-11-08).
  { key: "account", label: strings.navigation.account, href: "/account", icon: UserRound, isAvailable: true, includes: ["/saved", "/history", "/interests"] },
  { key: "search", label: strings.navigation.search, href: "/search", icon: Search, isAvailable: true },
];

/** Exact match for home. Other destinations also stay active on their nested pages. */
export function isDestinationActive(href: string, pathname: string, includes: string[] = []): boolean {
  if (href === "/") return pathname === "/";
  return [href, ...includes].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
