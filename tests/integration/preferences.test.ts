import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  getPreferences,
  mergeGuestPreferences,
  resetInterests,
  saveInterests,
  setOnboardingOutcome,
} from "@/features/preferences/preferences.service";
import { AppError } from "@/lib/errors";
import type { Actor } from "@/lib/permissions";
import { clearDatabase, createTestClient } from "./helpers";
import { createActor } from "./phase3-helpers";

let prisma: PrismaClient;
let person: Actor;
let categoryIds: string[];

async function errorCodeOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : `UNEXPECTED: ${String(error)}`;
  }
}

beforeAll(() => {
  prisma = createTestClient();
});

beforeEach(async () => {
  await clearDatabase(prisma);
  person = await createActor(prisma, "USER");
  categoryIds = [];
  for (const [index, title] of ["أ", "ب", "ج"].entries()) {
    const category = await prisma.category.create({ data: { title, slug: `c-${index}` } });
    categoryIds.push(category.id);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

const [A, B, C] = [0, 1, 2];
const sorted = (ids: string[]) => [...ids].sort();

describe("guests", () => {
  it("can't use any account preference operation", async () => {
    expect(await errorCodeOf(getPreferences(null))).toBe("UNAUTHENTICATED");
    expect(await errorCodeOf(saveInterests(null, { categoryIds: [] }))).toBe("UNAUTHENTICATED");
    expect(await errorCodeOf(setOnboardingOutcome(null, { outcome: "skipped" }))).toBe("UNAUTHENTICATED");
    expect(await errorCodeOf(resetInterests(null))).toBe("UNAUTHENTICATED");
    expect(await errorCodeOf(mergeGuestPreferences(null, { version: 1, selectedCategoryIds: [], onboarding: "pending" }))).toBe("UNAUTHENTICATED");
  });
});

describe("saveInterests", () => {
  it("starts empty and stores the selection", async () => {
    expect(await getPreferences(person)).toEqual({ selectedCategoryIds: [], onboarding: "pending" });

    const view = await saveInterests(person, { categoryIds: [categoryIds[A], categoryIds[B]] });
    expect(sorted(view.selectedCategoryIds)).toEqual(sorted([categoryIds[A]!, categoryIds[B]!]));
  });

  it("removing a category clears what was learned about it (§9.3)", async () => {
    await saveInterests(person, { categoryIds: [categoryIds[A]] });
    await prisma.userInterest.updateMany({ where: { userId: person.id }, data: { behaviourScore: 5, lastSignalAt: new Date() } });

    await saveInterests(person, { categoryIds: [categoryIds[B]] });

    const removed = await prisma.userInterest.findFirstOrThrow({ where: { userId: person.id, categoryId: categoryIds[A] } });
    expect(removed).toMatchObject({ isSelected: false, explicitWeight: 0, behaviourScore: 0, lastSignalAt: null });
  });

  it("keeps what was learned about categories never selected", async () => {
    await prisma.userInterest.create({ data: { userId: person.id, categoryId: categoryIds[C]!, behaviourScore: 2 } });
    await saveInterests(person, { categoryIds: [categoryIds[A]] });
    const untouched = await prisma.userInterest.findFirstOrThrow({ where: { userId: person.id, categoryId: categoryIds[C] } });
    expect(untouched.behaviourScore).toBe(2);
  });

  it("keeps what was learned about a category that stays selected", async () => {
    await saveInterests(person, { categoryIds: [categoryIds[A]] });
    await prisma.userInterest.updateMany({ where: { userId: person.id }, data: { behaviourScore: 3 } });
    await saveInterests(person, { categoryIds: [categoryIds[A], categoryIds[B]] });
    const kept = await prisma.userInterest.findFirstOrThrow({ where: { userId: person.id, categoryId: categoryIds[A] } });
    expect(kept.behaviourScore).toBe(3);
  });

  it("refuses an unknown or inactive category and changes nothing", async () => {
    await saveInterests(person, { categoryIds: [categoryIds[A]] });

    expect(await errorCodeOf(saveInterests(person, { categoryIds: ["f".repeat(24)] }))).toBe("VALIDATION");

    await prisma.category.update({ where: { id: categoryIds[B] }, data: { isActive: false } });
    expect(await errorCodeOf(saveInterests(person, { categoryIds: [categoryIds[B]] }))).toBe("VALIDATION");

    expect((await getPreferences(person)).selectedCategoryIds).toEqual([categoryIds[A]]);
  });

  it("ignores duplicates in the request", async () => {
    const view = await saveInterests(person, { categoryIds: [categoryIds[A], categoryIds[A]] });
    expect(view.selectedCategoryIds).toEqual([categoryIds[A]]);
  });

  it("refuses a request naming another user", async () => {
    const other = await createActor(prisma, "USER");
    expect(await errorCodeOf(saveInterests(person, { categoryIds: [categoryIds[A]], userId: other.id }))).toBe("VALIDATION");
    expect((await getPreferences(other)).selectedCategoryIds).toEqual([]);
  });

  it("only ever changes the person's own data", async () => {
    const other = await createActor(prisma, "USER");
    await saveInterests(other, { categoryIds: [categoryIds[C]] });
    await saveInterests(person, { categoryIds: [categoryIds[A]] });
    await resetInterests(person);
    expect((await getPreferences(other)).selectedCategoryIds).toEqual([categoryIds[C]]);
  });

  it("handles simultaneous saves without error or duplicates", async () => {
    await Promise.all([
      saveInterests(person, { categoryIds: [categoryIds[A]] }),
      saveInterests(person, { categoryIds: [categoryIds[A]] }),
      saveInterests(person, { categoryIds: [categoryIds[A]] }),
    ]);
    expect(await prisma.userInterest.count({ where: { userId: person.id } })).toBe(1);
  });
});

describe("onboarding", () => {
  it("records completing and skipping", async () => {
    expect((await setOnboardingOutcome(person, { outcome: "skipped" })).onboarding).toBe("skipped");
    expect((await setOnboardingOutcome(person, { outcome: "completed" })).onboarding).toBe("completed");
  });

  it("doesn't go backwards from completed to skipped", async () => {
    await setOnboardingOutcome(person, { outcome: "completed" });
    expect((await setOnboardingOutcome(person, { outcome: "skipped" })).onboarding).toBe("completed");
  });

  it("rejects other values", async () => {
    expect(await errorCodeOf(setOnboardingOutcome(person, { outcome: "pending" }))).toBe("VALIDATION");
  });
});

describe("resetInterests", () => {
  it("clears selections and learned scores, and keeps the onboarding state", async () => {
    await saveInterests(person, { categoryIds: [categoryIds[A]] });
    await setOnboardingOutcome(person, { outcome: "completed" });
    await prisma.userInterest.create({ data: { userId: person.id, categoryId: categoryIds[B]!, behaviourScore: 4 } });

    const view = await resetInterests(person);

    expect(view).toEqual({ selectedCategoryIds: [], onboarding: "completed" });
    expect(await prisma.userInterest.count({ where: { userId: person.id } })).toBe(0);
  });
});

describe("merging guest preferences at sign-in (§8.2)", () => {
  const guest = (selectedCategoryIds: string[], onboarding: "pending" | "completed" | "skipped" = "completed") => ({
    version: 1,
    selectedCategoryIds,
    onboarding,
  });

  it("moves a guest's choices into a new account", async () => {
    const view = await mergeGuestPreferences(person, guest([categoryIds[A]!, categoryIds[B]!]));
    expect(sorted(view.selectedCategoryIds)).toEqual(sorted([categoryIds[A]!, categoryIds[B]!]));
    expect(view.onboarding).toBe("completed");
  });

  it("keeps what the account already had", async () => {
    await saveInterests(person, { categoryIds: [categoryIds[C]] });
    const view = await mergeGuestPreferences(person, guest([categoryIds[A]!]));
    expect(sorted(view.selectedCategoryIds)).toEqual(sorted([categoryIds[A]!, categoryIds[C]!]));
  });

  it("keeps learned scores on the account's existing selections", async () => {
    await saveInterests(person, { categoryIds: [categoryIds[C]] });
    await prisma.userInterest.updateMany({ where: { userId: person.id }, data: { behaviourScore: 3 } });

    await mergeGuestPreferences(person, guest([categoryIds[A]!]));

    const kept = await prisma.userInterest.findFirstOrThrow({ where: { userId: person.id, categoryId: categoryIds[C] } });
    expect(kept.behaviourScore).toBe(3);
  });

  it("drops categories that are gone or inactive rather than failing", async () => {
    await prisma.category.update({ where: { id: categoryIds[B] }, data: { isActive: false } });
    const view = await mergeGuestPreferences(person, guest([categoryIds[A]!, categoryIds[B]!, "f".repeat(24)]));
    expect(view.selectedCategoryIds).toEqual([categoryIds[A]]);
  });

  it("gives the same result when repeated, so a retry after a lost response is safe", async () => {
    const input = guest([categoryIds[A]!]);
    await mergeGuestPreferences(person, input);
    const again = await mergeGuestPreferences(person, input);
    expect(again.selectedCategoryIds).toEqual([categoryIds[A]]);
    expect(await prisma.userInterest.count({ where: { userId: person.id } })).toBe(1);
  });

  it("carries over a skip, and doesn't downgrade a finished onboarding", async () => {
    expect((await mergeGuestPreferences(person, guest([], "skipped"))).onboarding).toBe("skipped");
    await setOnboardingOutcome(person, { outcome: "completed" });
    expect((await mergeGuestPreferences(person, guest([], "skipped"))).onboarding).toBe("completed");
  });

  it("rejects malformed browser data", async () => {
    expect(await errorCodeOf(mergeGuestPreferences(person, { version: 9 }))).toBe("VALIDATION");
    expect(await errorCodeOf(mergeGuestPreferences(person, { ...guest([]), role: "ADMIN" }))).toBe("VALIDATION");
  });
});
