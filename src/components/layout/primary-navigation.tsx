"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isDestinationActive, navigationDestinations, type NavigationDestination } from "@/config/navigation";
import { strings } from "@/config/strings.ar";
import { cn } from "@/lib/utils";

const itemLayout = "flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[0.6875rem] leading-tight font-medium";

function NavigationItem({ destination, pathname }: { destination: NavigationDestination; pathname: string }) {
  const Icon = destination.icon;

  if (!destination.isAvailable) {
    return (
      <span
        aria-disabled="true"
        title={strings.navigation.comingSoon}
        data-nav-item="unavailable"
        className={cn(itemLayout, "h-full text-subtle/80")}
      >
        <Icon aria-hidden className="size-5" strokeWidth={1.75} />
        <span>
          {destination.label}
          <span className="sr-only"> ({strings.navigation.comingSoon})</span>
        </span>
      </span>
    );
  }

  const isActive = isDestinationActive(destination.href, pathname);

  return (
    <Link
      href={destination.href}
      aria-current={isActive ? "page" : undefined}
      data-nav-item="available"
      className={cn(
        itemLayout,
        "h-full transition-colors",
        isActive ? "text-brand" : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary",
      )}
    >
      <Icon aria-hidden className="size-5" strokeWidth={isActive ? 2.25 : 1.75} />
      <span>{destination.label}</span>
    </Link>
  );
}

/** Rendered twice by the shell, for phones and larger screens. CSS shows only one. */
export function PrimaryNavigation({ orientation }: { orientation: "rail" | "bar" }) {
  const pathname = usePathname();

  return (
    <ul className={orientation === "bar" ? "grid h-full grid-cols-5 gap-1 px-2 py-1.5" : "flex flex-col gap-2 px-2"}>
      {navigationDestinations.map((destination) => (
        <li key={destination.key} className={orientation === "rail" ? "h-16" : undefined}>
          <NavigationItem destination={destination} pathname={pathname} />
        </li>
      ))}
    </ul>
  );
}
