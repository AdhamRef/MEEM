"use client";

import { FileText, Heart, LayoutDashboard, LogIn, LogOut, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { strings } from "@/config/strings.ar";
import { signInHref } from "@/lib/auth/callback-url";

const ITEM_CLASS = "min-h-11";

/** Signing in is offered here and never pushed, because it's optional (§8). */
export function AccountMenu() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const user = session?.user;
  const initial = user?.name?.trim().charAt(0);

  return (
    // Not modal: the modal mode hides the rest of the page from assistive technology and
    // locks scrolling, neither of which a small account menu needs.
    <DropdownMenu dir="rtl" modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={strings.auth.account} data-testid="account-menu" className="rounded-full">
          {initial ? (
            <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-surface-elevated text-sm font-semibold">
              {initial}
            </span>
          ) : (
            <UserRound aria-hidden className="size-5" strokeWidth={1.75} />
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-60">
        {user ? (
          <>
            <DropdownMenuLabel className="space-y-0.5 font-normal">
              {user.name ? <span className="block truncate font-medium text-text-primary">{user.name}</span> : null}
              <bdi className="block truncate text-xs text-text-secondary">{user.email}</bdi>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : null}

        {user ? (
          <DropdownMenuItem asChild className={ITEM_CLASS}>
            <Link href="/account">
              <UserRound aria-hidden />
              {strings.account.title}
            </Link>
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuItem asChild className={ITEM_CLASS}>
          <Link href="/interests">
            <Heart aria-hidden />
            {strings.interests.pageTitle}
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild className={ITEM_CLASS}>
          <Link href="/privacy">
            <ShieldCheck aria-hidden />
            {strings.legal.footer.privacy}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={ITEM_CLASS}>
          <Link href="/terms">
            <FileText aria-hidden />
            {strings.legal.footer.terms}
          </Link>
        </DropdownMenuItem>

        {user?.hasAdminAccess ? (
          <DropdownMenuItem asChild className={ITEM_CLASS}>
            <Link href="/admin">
              <LayoutDashboard aria-hidden />
              {strings.auth.dashboard}
            </Link>
          </DropdownMenuItem>
        ) : null}

        {status === "unauthenticated" ? (
          <DropdownMenuItem asChild className={ITEM_CLASS}>
            <Link href={signInHref(pathname)}>
              <LogIn aria-hidden className="rtl:rotate-180" />
              {strings.auth.signIn}
            </Link>
          </DropdownMenuItem>
        ) : null}

        {user ? (
          <DropdownMenuItem className={ITEM_CLASS} onSelect={() => void signOut({ callbackUrl: "/" })}>
            <LogOut aria-hidden className="rtl:rotate-180" />
            {strings.auth.signOut}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
