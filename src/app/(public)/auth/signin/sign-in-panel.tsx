"use client";

import { LogIn } from "lucide-react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";

interface SignInPanelProps {
  callbackPath: string;
  isConfigured: boolean;
  errorMessage?: string;
}

export function SignInPanel({ callbackPath, isConfigured, errorMessage }: SignInPanelProps) {
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [failedToStart, setFailedToStart] = useState(false);

  const start = async () => {
    setIsRedirecting(true);
    setFailedToStart(false);
    try {
      await signIn("google", { callbackUrl: callbackPath });
    } catch {
      setIsRedirecting(false);
      setFailedToStart(true);
    }
  };

  const message = failedToStart ? strings.auth.errorGeneric : errorMessage;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-12">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{strings.auth.signInTitle}</h1>
        <p className="text-text-secondary">{strings.auth.signInDescription}</p>
      </div>

      {message ? (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-surface p-3 text-sm">
          {message}
        </p>
      ) : null}

      {isConfigured ? (
        <div className="space-y-3">
          <Button onClick={start} disabled={isRedirecting} className="w-full">
            <LogIn aria-hidden data-icon="inline-start" className="rtl:rotate-180" />
            {isRedirecting ? strings.auth.redirecting : strings.auth.continueWithGoogle}
          </Button>
          <p className="text-sm text-text-secondary">{strings.auth.dataNote}</p>
        </div>
      ) : (
        <p role="status" className="rounded-xl border bg-surface p-3 text-sm text-text-secondary">
          {strings.auth.notConfigured}
        </p>
      )}

      <Button asChild variant="ghost" className="w-full">
        <Link href={callbackPath}>{strings.auth.continueAsGuest}</Link>
      </Button>
    </div>
  );
}
