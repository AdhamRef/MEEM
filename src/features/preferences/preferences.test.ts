import { describe, expect, it, vi } from "vitest";
import {
  clearGuestPreferences,
  EMPTY_GUEST_PREFERENCES,
  GUEST_PREFERENCES_KEY,
  hasGuestPreferences,
  readGuestPreferences,
  writeGuestPreferences,
} from "./guest-storage";
import { mergeOnboardingState, mergeSelectedTopics } from "./merge";
import { guestPreferencesSchema, saveInterestsSchema } from "./schemas";

const ID_A = "a".repeat(24);
const ID_B = "b".repeat(24);

function memoryStorage(initial?: string) {
  const values = new Map<string, string>(initial === undefined ? [] : [[GUEST_PREFERENCES_KEY, initial]]);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("mergeSelectedTopics", () => {
  const active = new Set(["1", "2", "3"]);

  it("keeps choices from both the account and the guest", () => {
    expect(mergeSelectedTopics(["1"], ["2"], active)).toEqual(["1", "2"]);
  });

  it("doesn't duplicate a topic chosen on both sides", () => {
    expect(mergeSelectedTopics(["1", "2"], ["2", "3"], active)).toEqual(["1", "2", "3"]);
  });

  it("drops topics that no longer exist or are unpublished", () => {
    expect(mergeSelectedTopics(["gone"], ["2", "also-gone"], active)).toEqual(["2"]);
  });

  it("gives the same result when repeated, so a retried merge is safe", () => {
    const once = mergeSelectedTopics(["1"], ["2"], active);
    expect(mergeSelectedTopics(once, ["2"], active)).toEqual(once);
  });
});

describe("mergeOnboardingState", () => {
  it.each([
    ["pending", "pending", "pending"],
    ["pending", "skipped", "skipped"],
    ["pending", "completed", "completed"],
    ["skipped", "completed", "completed"],
    ["completed", "skipped", "completed"],
    ["completed", "pending", "completed"],
    ["skipped", "pending", "skipped"],
  ] as const)("account %s with guest %s gives %s", (account, guest, expected) => {
    expect(mergeOnboardingState(account, guest)).toBe(expected);
  });
});

describe("guest storage", () => {
  const preferences = { version: 2 as const, selectedTopicIds: [ID_A], channelChoices: { [ID_B]: false }, onboarding: "completed" as const };

  it("returns what was saved", () => {
    const storage = memoryStorage();
    expect(writeGuestPreferences(storage, preferences)).toBe(true);
    expect(readGuestPreferences(storage)).toEqual(preferences);
  });

  it("starts empty", () => {
    expect(readGuestPreferences(memoryStorage())).toEqual(EMPTY_GUEST_PREFERENCES);
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["a wrong version", JSON.stringify({ ...preferences, version: 1 })],
    ["a bad topic ID", JSON.stringify({ ...preferences, selectedTopicIds: ["<script>"] })],
    ["a role injected by hand", JSON.stringify({ ...preferences, role: "SUPER_ADMIN" })],
  ])("treats %s as empty", (_name, stored) => {
    expect(readGuestPreferences(memoryStorage(stored))).toEqual(EMPTY_GUEST_PREFERENCES);
  });

  it("survives browsers that block storage, and reports the failed save", () => {
    const blocked = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      removeItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };
    expect(readGuestPreferences(blocked)).toEqual(EMPTY_GUEST_PREFERENCES);
    expect(writeGuestPreferences(blocked, preferences)).toBe(false);
    expect(() => clearGuestPreferences(blocked)).not.toThrow();
  });

  it("clears", () => {
    const storage = memoryStorage(JSON.stringify(preferences));
    clearGuestPreferences(storage);
    expect(readGuestPreferences(storage)).toEqual(EMPTY_GUEST_PREFERENCES);
  });

  it("only treats real choices as something to merge", () => {
    expect(hasGuestPreferences(EMPTY_GUEST_PREFERENCES)).toBe(false);
    expect(hasGuestPreferences({ ...EMPTY_GUEST_PREFERENCES, onboarding: "skipped" })).toBe(true);
    expect(hasGuestPreferences({ ...EMPTY_GUEST_PREFERENCES, selectedTopicIds: [ID_B] })).toBe(true);
  });
});

describe("input validation", () => {
  it("rejects fields the client has no business sending", () => {
    expect(saveInterestsSchema.safeParse({ topicIds: [ID_A], channelChoices: {}, userId: ID_B }).success).toBe(false);
    expect(saveInterestsSchema.safeParse({ topicIds: [ID_A], channelChoices: {}, role: "ADMIN" }).success).toBe(false);
    expect(guestPreferencesSchema.safeParse({ ...EMPTY_GUEST_PREFERENCES, userId: ID_B }).success).toBe(false);
  });

  it("rejects malformed and oversized ID lists", () => {
    expect(saveInterestsSchema.safeParse({ topicIds: ["not-an-id"], channelChoices: {} }).success).toBe(false);
    expect(saveInterestsSchema.safeParse({ topicIds: [{ $ne: null }], channelChoices: {} }).success).toBe(false);
    expect(saveInterestsSchema.safeParse({ topicIds: Array(101).fill(ID_A), channelChoices: {} }).success).toBe(false);
  });

  it("rejects bad channel switches", () => {
    expect(saveInterestsSchema.safeParse({ topicIds: [], channelChoices: { "not-an-id": true } }).success).toBe(false);
    expect(saveInterestsSchema.safeParse({ topicIds: [], channelChoices: { [ID_A]: "yes" } }).success).toBe(false);
    const tooMany = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [index.toString(16).padStart(24, "0"), true]));
    expect(saveInterestsSchema.safeParse({ topicIds: [], channelChoices: tooMany }).success).toBe(false);
  });
});
