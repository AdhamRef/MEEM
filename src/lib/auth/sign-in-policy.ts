export interface SignInAttempt {
  provider: string | undefined;
  /** What the provider returned, which NextAuth types as an open-ended object. */
  profile: object | undefined;
  user: object;
}

/**
 * Accounts are matched by email, so an unverified Google address must not be accepted.
 * A deactivated person is refused here as well as at every session read.
 */
export function isSignInAllowed({ provider, profile, user }: SignInAttempt): boolean {
  const isEmailVerified = (profile as { email_verified?: unknown } | undefined)?.email_verified === true;
  const isDeactivated = (user as { isDeactivated?: unknown }).isDeactivated === true;
  return provider === "google" && isEmailVerified && !isDeactivated;
}
