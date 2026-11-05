import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { PreferencesProvider } from "@/components/preferences/preferences-provider";
import { AuthSessionProvider } from "@/components/providers/auth-session-provider";

/** The modal slot shows a Short over the page that linked to it, so readers keep their place (§12.6). */
export default function PublicLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <AuthSessionProvider>
      <PreferencesProvider>
        <AppShell>{children}</AppShell>
        {modal}
      </PreferencesProvider>
    </AuthSessionProvider>
  );
}
