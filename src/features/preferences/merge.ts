export type OnboardingState = "pending" | "completed" | "skipped";

const ONBOARDING_RANK: Record<OnboardingState, number> = { pending: 0, skipped: 1, completed: 2 };

/** The further state wins, so signing in never brings the onboarding back for no reason. */
export function mergeOnboardingState(account: OnboardingState, guest: OnboardingState): OnboardingState {
  return ONBOARDING_RANK[guest] > ONBOARDING_RANK[account] ? guest : account;
}

/**
 * Keeps both sides, because §8.2 says preferences must not be lost during sign-in. Guest
 * choices are cleared from the browser after a merge, so this only happens once per choice
 * and can't undo a removal made later on another device.
 */
export function mergeSelectedCategories(account: string[], guest: string[], activeCategoryIds: ReadonlySet<string>): string[] {
  return [...new Set([...account, ...guest])].filter((id) => activeCategoryIds.has(id));
}
