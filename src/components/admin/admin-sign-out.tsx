"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";

export function AdminSignOut() {
  return (
    <Button variant="ghost" onClick={() => void signOut({ callbackUrl: "/" })}>
      <LogOut aria-hidden data-icon="inline-start" className="rtl:rotate-180" />
      {strings.auth.signOut}
    </Button>
  );
}
