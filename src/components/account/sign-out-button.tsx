"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SignOutButton({ label }: { label: string }) {
  const [isBusy, setIsBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className="min-h-12 w-full rounded-2xl"
      disabled={isBusy}
      onClick={() => {
        setIsBusy(true);
        void signOut({ callbackUrl: "/" });
      }}
      data-testid="account-sign-out"
    >
      <LogOut aria-hidden data-icon="inline-start" className="rtl:rotate-180" />
      {label}
    </Button>
  );
}
