import { ShieldX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { checkPageAccess } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: { default: strings.admin.title, template: `%s | ${strings.admin.title}` },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const access = await checkPageAccess("admin.access", "/admin");

  if (!access.allowed) {
    return (
      <main className="flex min-h-dvh flex-col">
        <StateMessage
          icon={ShieldX}
          headingLevel="h1"
          title={strings.admin.deniedTitle}
          description={strings.admin.deniedDescription}
          action={
            <Button asChild>
              <Link href="/">{strings.admin.backToSite}</Link>
            </Button>
          }
        />
      </main>
    );
  }

  return <AdminShell actor={access.actor}>{children}</AdminShell>;
}
