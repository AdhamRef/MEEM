"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { strings } from "@/config/strings.ar";

const f = strings.legal.footer;

/** Not on the feed, which fills the screen and scrolls within itself. The account menu has these too. */
export function SiteFooter() {
  const pathname = usePathname();
  if (pathname === "/" || pathname.startsWith("/shorts/")) return null;

  return (
    <footer className="mt-auto border-t px-4 py-6 text-sm text-text-secondary md:px-8" data-testid="site-footer">
      <nav aria-label={f.label} className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2">
        <Link href="/privacy" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
          {f.privacy}
        </Link>
        <Link href="/terms" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
          {f.terms}
        </Link>
        <span>{f.source}</span>
      </nav>
    </footer>
  );
}
