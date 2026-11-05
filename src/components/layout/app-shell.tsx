import Link from "next/link";
import type { ReactNode } from "react";
import { PrivacyNotice } from "@/components/legal/privacy-notice";
import { BrandMark } from "@/components/shared/brand-mark";
import { strings } from "@/config/strings.ar";
import { AccountMenu } from "./account-menu";
import { PrimaryNavigation } from "./primary-navigation";
import { SiteFooter } from "./site-footer";

/** Public layout: a bottom bar on phones, and a compact rail on the start side otherwise. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface-elevated focus:px-4 focus:py-2"
      >
        {strings.navigation.skipToContent}
      </a>

      <nav
        aria-label={strings.navigation.label}
        data-testid="navigation-rail"
        className="fixed inset-y-0 start-0 z-40 hidden w-(--rail-width) flex-col gap-6 border-e bg-surface py-5 md:flex"
      >
        <Link href="/" aria-label={strings.app.name} className="mx-auto rounded-xl">
          <BrandMark className="size-10" />
        </Link>
        <PrimaryNavigation orientation="rail" />
        <div className="mt-auto flex justify-center">
          <AccountMenu />
        </div>
      </nav>

      <header
        data-testid="top-bar"
        className="sticky top-0 z-30 flex h-(--top-bar-height) items-center justify-between border-b bg-surface/95 ps-3 pe-1.5 backdrop-blur-sm md:hidden"
      >
        <Link href="/" aria-label={strings.app.name} className="rounded-xl">
          <BrandMark className="size-8" />
        </Link>
        <AccountMenu />
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="flex min-h-[calc(100dvh-var(--top-bar-height))] flex-col pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom))] outline-none md:ms-(--rail-width) md:min-h-dvh md:pb-0"
      >
        <PrivacyNotice />
        {children}
        <SiteFooter />
      </main>

      <nav
        aria-label={strings.navigation.label}
        data-testid="navigation-bar"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden"
      >
        <div className="h-(--bottom-nav-height)">
          <PrimaryNavigation orientation="bar" />
        </div>
      </nav>
    </>
  );
}
