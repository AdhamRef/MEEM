import { Bookmark, Heart, History, LogIn, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DeleteAccount } from "@/components/account/delete-account";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { getOwnAccount } from "@/features/users/account.service";
import { signInHref } from "@/lib/auth/callback-url";
import { getCurrentActor } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils/format";

const a = strings.account;

export const metadata: Metadata = { title: a.title, robots: { index: false, follow: false } };

export default async function AccountPage() {
  const actor = await getCurrentActor();
  if (!actor) {
    return (
      <StateMessage
        icon={UserRound}
        headingLevel="h1"
        title={a.title}
        description={a.guestDescription}
        action={
          <Button asChild>
            <Link href={signInHref("/account")}>
              <LogIn aria-hidden data-icon="inline-start" className="rtl:rotate-180" />
              {strings.auth.signIn}
            </Link>
          </Button>
        }
      />
    );
  }

  const account = await getOwnAccount(actor);
  const links = [
    { href: "/saved", label: strings.library.savedTitle, icon: Bookmark },
    { href: "/history", label: strings.library.historyTitle, icon: History },
    { href: "/interests", label: strings.interests.pageTitle, icon: Heart },
  ];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8" data-testid="account-page">
      <h1 className="text-3xl font-semibold">{a.title}</h1>

      <section aria-labelledby="account-details" className="space-y-1 rounded-xl border bg-surface p-4">
        <h2 id="account-details" className="sr-only">
          {a.details}
        </h2>
        {account.name ? <bdi className="block font-medium">{account.name}</bdi> : null}
        <bdi className="block text-sm text-text-secondary">{account.email}</bdi>
        <p className="text-sm text-text-secondary">
          {a.memberSince} <time dateTime={account.createdAt.toISOString()}>{formatDate(account.createdAt)}</time>
        </p>
      </section>

      <nav aria-label={a.yourData}>
        <ul className="divide-y rounded-xl border bg-surface">
          {links.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link href={href} className="flex min-h-12 items-center gap-3 px-4 outline-none hover:bg-surface-elevated focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset">
                <Icon aria-hidden className="size-4 text-text-secondary" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="delete-account" className="space-y-3 rounded-xl border bg-surface p-4">
        <h2 id="delete-account" className="text-lg font-semibold">
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
    </div>
  );
}
