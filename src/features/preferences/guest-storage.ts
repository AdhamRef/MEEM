import { guestPreferencesSchema, type GuestPreferences } from "./schemas";

export const GUEST_PREFERENCES_KEY = "preferences.v1";

export const EMPTY_GUEST_PREFERENCES: GuestPreferences = { version: 1, selectedCategoryIds: [], onboarding: "pending" };

/** Storage can throw or be empty in private windows, and its content can't be trusted. */
export function readGuestPreferences(storage: Pick<Storage, "getItem">): GuestPreferences {
  try {
    const stored = storage.getItem(GUEST_PREFERENCES_KEY);
    if (!stored) return EMPTY_GUEST_PREFERENCES;
    const parsed = guestPreferencesSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : EMPTY_GUEST_PREFERENCES;
  } catch {
    return EMPTY_GUEST_PREFERENCES;
  }
}

/** Returns whether it saved, so the interface never claims a save that didn't happen. */
export function writeGuestPreferences(storage: Pick<Storage, "setItem">, preferences: GuestPreferences): boolean {
  try {
    storage.setItem(GUEST_PREFERENCES_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function clearGuestPreferences(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(GUEST_PREFERENCES_KEY);
  } catch {
    // Nothing useful to do: the next merge repeats safely, because merging is a union.
  }
}

export function hasGuestPreferences(preferences: GuestPreferences): boolean {
  return preferences.onboarding !== "pending" || preferences.selectedCategoryIds.length > 0;
}
