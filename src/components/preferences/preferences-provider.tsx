"use client";

import { useSession } from "next-auth/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  clearGuestPreferences,
  hasGuestPreferences,
  readGuestPreferences,
  writeGuestPreferences,
} from "@/features/preferences/guest-storage";
import { mergeOnboardingState, type OnboardingState } from "@/features/preferences/merge";
import type { PreferencesView } from "@/features/preferences/schemas";
import { clearGuestSignals, readGuestBehaviour } from "@/features/recommendations/guest-signals";

type LoadStatus = "loading" | "ready" | "error";

interface PreferencesContextValue {
  status: LoadStatus;
  isGuest: boolean;
  selectedCategoryIds: string[];
  onboarding: OnboardingState;
  /** These reject on failure, so callers only report success when it really happened. */
  saveInterests: (categoryIds: string[]) => Promise<void>;
  completeOnboarding: (categoryIds: string[]) => Promise<void>;
  skipOnboarding: () => Promise<void>;
  resetInterests: () => Promise<void>;
  reload: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used inside PreferencesProvider");
  return value;
}

async function requestPreferences(path: string, method: string, body?: unknown): Promise<PreferencesView> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Preferences request failed with status ${response.status}`);
  return (await response.json()) as PreferencesView;
}

/**
 * The one source of interests for the whole public site. Guests use browser storage, and
 * signed-in people use their account. What a guest chose moves into the account on the
 * first load after sign-in, and only leaves the browser once the server has it (§8.2).
 */
async function loadAccountPreferences(): Promise<PreferencesView> {
  const guest = readGuestPreferences(window.localStorage);
  const behaviour = readGuestBehaviour(window.localStorage, new Date());
  if (!hasGuestPreferences(guest) && Object.keys(behaviour).length === 0) return requestPreferences("/api/preferences", "GET");

  const merged = await requestPreferences("/api/preferences/merge", "POST", { ...guest, behaviour });
  clearGuestPreferences(window.localStorage);
  clearGuestSignals(window.localStorage);
  return merged;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { status: sessionStatus } = useSession();
  const isGuest = sessionStatus !== "authenticated";

  const [status, setStatus] = useState<LoadStatus>("loading");
  const [view, setView] = useState<PreferencesView>({ selectedCategoryIds: [], onboarding: "pending" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (sessionStatus === "loading") return;

    let isCurrent = true;
    const load = sessionStatus === "authenticated" ? loadAccountPreferences() : Promise.resolve(readGuestPreferences(window.localStorage));

    load.then(
      (loaded) => {
        if (!isCurrent) return;
        setView({ selectedCategoryIds: loaded.selectedCategoryIds, onboarding: loaded.onboarding });
        setStatus("ready");
      },
      () => {
        if (isCurrent) setStatus("error");
      },
    );

    return () => {
      isCurrent = false;
    };
  }, [sessionStatus, attempt]);

  const writeGuest = useCallback((next: PreferencesView) => {
    const saved = writeGuestPreferences(window.localStorage, { version: 1, ...next });
    if (!saved) throw new Error("Browser storage is unavailable");
    setView(next);
  }, []);

  const saveInterests = useCallback(
    async (categoryIds: string[]) => {
      if (isGuest) {
        writeGuest({ ...view, selectedCategoryIds: categoryIds });
      } else {
        setView(await requestPreferences("/api/preferences", "PUT", { categoryIds }));
      }
    },
    [isGuest, view, writeGuest],
  );

  // One action rather than a save followed by a finish, because a guest's second write would
  // otherwise start from the state as it was before the first, and undo it.
  const completeOnboarding = useCallback(
    async (categoryIds: string[]) => {
      if (isGuest) {
        writeGuest({ selectedCategoryIds: categoryIds, onboarding: "completed" });
      } else {
        await requestPreferences("/api/preferences", "PUT", { categoryIds });
        setView(await requestPreferences("/api/preferences/onboarding", "POST", { outcome: "completed" }));
      }
    },
    [isGuest, writeGuest],
  );

  const skipOnboarding = useCallback(async () => {
    if (isGuest) {
      writeGuest({ ...view, onboarding: mergeOnboardingState(view.onboarding, "skipped") });
    } else {
      setView(await requestPreferences("/api/preferences/onboarding", "POST", { outcome: "skipped" }));
    }
  }, [isGuest, view, writeGuest]);

  const resetInterests = useCallback(async () => {
    if (isGuest) {
      writeGuest({ ...view, selectedCategoryIds: [] });
    } else {
      setView(await requestPreferences("/api/preferences", "DELETE"));
    }
  }, [isGuest, view, writeGuest]);

  const reload = useCallback(() => {
    setStatus("loading");
    setAttempt((current) => current + 1);
  }, []);

  const value = useMemo(
    () => ({ status, isGuest, ...view, saveInterests, completeOnboarding, skipOnboarding, resetInterests, reload }),
    [status, isGuest, view, saveInterests, completeOnboarding, skipOnboarding, resetInterests, reload],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
