import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { strings } from "@/config/strings.ar";
import { safeCallbackPath } from "@/lib/auth/callback-url";
import { isGoogleSignInConfigured } from "@/lib/auth/options";
import { getCurrentActor } from "@/lib/auth/session";
import { SignInPanel } from "./sign-in-panel";

export const metadata: Metadata = {
  title: strings.auth.signInTitle,
  robots: { index: false, follow: false },
};

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: strings.auth.errorDenied,
  OAuthAccountNotLinked: strings.auth.errorNotLinked,
  RateLimited: strings.auth.errorRateLimited,
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const callbackPath = safeCallbackPath(firstValue(params.callbackUrl));

  if (await getCurrentActor()) redirect(callbackPath);

  const errorCode = firstValue(params.error);
  // Only fixed messages are shown. The code in the URL is never displayed, since anyone can write it.
  const errorMessage = errorCode ? (ERROR_MESSAGES[errorCode] ?? strings.auth.errorGeneric) : undefined;

  return <SignInPanel callbackPath={callbackPath} isConfigured={isGoogleSignInConfigured()} errorMessage={errorMessage} />;
}
