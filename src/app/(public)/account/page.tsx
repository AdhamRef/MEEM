import { Bookmark, ChevronLeft, FileText, Heart, History, LayoutDashboard, LogIn, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DeleteAccount } from "@/components/account/delete-account";
import { SignOutButton } from "@/components/account/sign-out-button";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { getOwnAccount } from "@/features/users/account.service";
import { signInHref } from "@/lib/auth/callback-url";
import { getCurrentActor } from "@/lib/auth/session";
import { hasPermission } from "@/lib/permissions";
import { formatDate } from "@/lib/utils/format";

const a = strings.account;
const h = strings.accountHub;

export const metadata: Metadata = { title: h.title, robots: { index: false, follow: false } };

interface HubLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

function LinkGroup({ id, title, links }: { id: string; title: string; links: HubLink[] }) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h2 id={id} className="px-1 text-xs font-semibold text-text-secondary">
        {title}
      </h2>
      <ul className="overflow-hidden rounded-2xl border bg-surface">
        {links.map(({ href, label, icon: Icon }) => (
          <li key={href} className="border-b last:border-b-0">
            <Link href={href} className="flex min-h-14 items-center gap-3 px-4 outline-none transition-colors hover:bg-surface-elevated focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset">
              <span aria-hidden className="flex size-9 items-center justify-center rounded-xl bg-surface-elevated text-brand">
                <Icon className="size-4.5" />
              </span>
              <span className="flex-1 font-medium">{label}</span>
              <ChevronLeft aria-hidden className="size-4 text-text-secondary" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Everything personal in one place: the account, the library, and preferences. It works for
 * guests too, who can browse their saved items and history on this device without signing in.
 */
export default async function AccountPage() {
  const actor = await getCurrentActor();
  const account = actor ? await getOwnAccount(actor) : null;
  const canAdmin = actor ? hasPermission(actor, "admin.access") : false;
  const initial = account?.name?.trim().charAt(0) || account?.email.charAt(0).toUpperCase();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6 md:py-10" data-testid="account-page">
      <h1 className="sr-only">{h.title}</h1>

      <section className="relative overflow-hidden rounded-3xl border bg-surface p-5 sm:p-6" data-testid="account-card">
        <span aria-hidden className="pointer-events-none absolute -top-20 -end-20 size-56 rounded-full bg-brand/15 blur-3xl" />
        {account ? (
          <div className="relative flex items-center gap-4">
            <span aria-hidden className="flex size-16 shrink-0 items-center justify-center rounded-full bg-brand/20 text-2xl font-bold text-brand">
              {initial}
            </span>
            <div className="min-w-0 space-y-0.5">
              {account.name ? <bdi className="block truncate text-lg font-bold">{account.name}</bdi> : null}
              <bdi className="block truncate text-sm text-text-secondary">{account.email}</bdi>
              <p className="text-xs text-text-secondary">
                {a.memberSince} <time dateTime={account.createdAt.toISOString()}>{formatDate(account.createdAt)}</time>
              </p>
            </div>
          </div>
        ) : (
          <div className="relative space-y-4">
            <div className="flex items-center gap-4">
              <span aria-hidden className="flex size-16 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-text-secondary">
                <UserRound className="size-7" strokeWidth={1.5} />
              </span>
              <div className="space-y-1">
                <p className="text-lg font-bold">{h.guestTitle}</p>
                <p className="text-sm text-text-secondary">{h.guestDescription}</p>
              </div>
            </div>
            <Button asChild className="min-h-11 w-full rounded-full sm:w-auto">
              <Link href={signInHref("/account")} data-testid="account-sign-in">
                <LogIn aria-hidden data-icon="inline-start" className="rtl:rotate-180" />
                {strings.auth.signIn}
              </Link>
            </Button>
          </div>
        )}
      </section>

      <LinkGroup
        id="account-library"
        title={h.library}
        links={[
          { href: "/saved", label: strings.library.savedTitle, icon: Bookmark },
          { href: "/history", label: strings.library.historyTitle, icon: History },
        ]}
      />

      <LinkGroup
        id="account-preferences"
        title={h.preferences}
        links={[
          { href: "/interests", label: strings.interests.pageTitle, icon: Heart },
          ...(canAdmin ? [{ href: "/admin", label: h.dashboard, icon: LayoutDashboard }] : []),
        ]}
      />

      <LinkGroup
        id="account-more"
        title={h.more}
        links={[
          { href: "/privacy", label: strings.legal.footer.privacy, icon: ShieldCheck },
          { href: "/terms", label: strings.legal.footer.terms, icon: FileText },
        ]}
      />

      {account ? (
        <>
          <SignOutButton label={h.signOut} />
          <section aria-labelledby="delete-account" className="space-y-3 rounded-2xl border border-destructive/30 bg-surface p-4">
            <h2 id="delete-account" className="font-semibold">
              {a.deleteTitle}
            </h2>
            {account.canDelete ? (
              <>
                <p className="text-sm text-text-secondary">{a.deleteDescription}</p>
                <DeleteAccount />
              </>
            ) : (
              <p className="text-sm text-text-secondary" data-testid="account-delete-unavailable">
                {a.superAdminCantDelete}
              </p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
