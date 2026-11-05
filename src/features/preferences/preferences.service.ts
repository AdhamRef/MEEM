import type { Prisma } from "@prisma/client";
import { getScoringConfig } from "@/features/recommendations/settings.service";
import { AppError } from "@/lib/errors";
import { assertSignedIn, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { mergeOnboardingState, mergeSelectedCategories, type OnboardingState } from "./merge";
import { guestMergeSchema, onboardingOutcomeSchema, saveInterestsSchema, type PreferencesView } from "./schemas";

// Every function uses the signed-in person's own ID and takes no user ID from input, so
// nobody can read or change someone else's preferences.

function onboardingStateOf(preference: { onboardingDoneAt: Date | null; onboardingSkipped: boolean } | null): OnboardingState {
  if (preference?.onboardingDoneAt) return "completed";
  return preference?.onboardingSkipped ? "skipped" : "pending";
}

async function loadView(db: Prisma.TransactionClient, userId: string): Promise<PreferencesView> {
  const interests = await db.userInterest.findMany({ where: { userId, isSelected: true }, select: { categoryId: true } });
  const preference = await db.userPreference.findUnique({ where: { userId } });
  return { selectedCategoryIds: interests.map((interest) => interest.categoryId), onboarding: onboardingStateOf(preference) };
}

export async function getPreferences(actor: Actor | null): Promise<PreferencesView> {
  assertSignedIn(actor);
  return loadView(prisma, actor.id);
}

async function activeCategoryIds(tx: Prisma.TransactionClient, ids: string[]): Promise<Set<string>> {
  const categories = await tx.category.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  return new Set(categories.map((category) => category.id));
}

/**
 * Removing a category also clears what was learned about it, so a manual choice isn't
 * overruled by old behaviour (§9.3). Categories never selected keep their learned score.
 */
async function applySelection(tx: Prisma.TransactionClient, userId: string, categoryIds: string[]): Promise<void> {
  await tx.userInterest.updateMany({
    where: { userId, isSelected: true, categoryId: { notIn: categoryIds } },
    data: { isSelected: false, explicitWeight: 0, behaviourScore: 0, lastSignalAt: null },
  });

  for (const categoryId of categoryIds) {
    await tx.userInterest.upsert({
      where: { userId_categoryId: { userId, categoryId } },
      update: { isSelected: true, explicitWeight: 1 },
      create: { userId, categoryId, isSelected: true, explicitWeight: 1 },
    });
  }
}

async function writeOnboardingState(tx: Prisma.TransactionClient, userId: string, state: OnboardingState): Promise<void> {
  if (state === "pending") return;
  const data = state === "completed" ? { onboardingDoneAt: new Date(), onboardingSkipped: false } : { onboardingSkipped: true };
  await tx.userPreference.upsert({ where: { userId }, update: data, create: { userId, ...data } });
}

export async function saveInterests(actor: Actor | null, rawInput: unknown): Promise<PreferencesView> {
  assertSignedIn(actor);
  const parsed = saveInterestsSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const categoryIds = [...new Set(parsed.data.categoryIds)];

  return withTransaction(async (tx) => {
    const active = await activeCategoryIds(tx, categoryIds);
    if (active.size !== categoryIds.length) throw new AppError("VALIDATION");
    await applySelection(tx, actor.id, categoryIds);
    return loadView(tx, actor.id);
  });
}

export async function setOnboardingOutcome(actor: Actor | null, rawInput: unknown): Promise<PreferencesView> {
  assertSignedIn(actor);
  const parsed = onboardingOutcomeSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");

  return withTransaction(async (tx) => {
    const preference = await tx.userPreference.findUnique({ where: { userId: actor.id } });
    const current = onboardingStateOf(preference);
    const next = mergeOnboardingState(current, parsed.data.outcome);
    if (next !== current) await writeOnboardingState(tx, actor.id, next);
    return loadView(tx, actor.id);
  });
}

/** Clears chosen interests and everything learned from behaviour (§9.3). */
export async function resetInterests(actor: Actor | null): Promise<PreferencesView> {
  assertSignedIn(actor);
  return withTransaction(async (tx) => {
    await tx.userInterest.deleteMany({ where: { userId: actor.id } });
    return loadView(tx, actor.id);
  });
}

/**
 * Moves what a guest chose into their account after sign-in. Unknown or inactive
 * categories are dropped rather than rejected, because browser data can be old (§8.2).
 */
export async function mergeGuestPreferences(actor: Actor | null, rawInput: unknown): Promise<PreferencesView> {
  assertSignedIn(actor);
  const parsed = guestMergeSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const guest = parsed.data;
  const { maxBehaviourScore } = await getScoringConfig();

  return withTransaction(async (tx) => {
    const account = await loadView(tx, actor.id);
    const active = await activeCategoryIds(tx, [...account.selectedCategoryIds, ...guest.selectedCategoryIds]);
    const merged = mergeSelectedCategories(account.selectedCategoryIds, guest.selectedCategoryIds, active);

    await applySelection(tx, actor.id, merged);

    const onboarding = mergeOnboardingState(account.onboarding, guest.onboarding);
    if (onboarding !== account.onboarding) await writeOnboardingState(tx, actor.id, onboarding);

    // Browser data can be edited, so it's bounded. It fills gaps only and never replaces what
    // the account has learned, so repeating a merge changes nothing.
    const behaviour = Object.entries(guest.behaviour ?? {});
    const behaviourCategories = await activeCategoryIds(tx, behaviour.map(([categoryId]) => categoryId));
    for (const [categoryId, score] of behaviour) {
      if (!behaviourCategories.has(categoryId)) continue;
      const existing = await tx.userInterest.findUnique({ where: { userId_categoryId: { userId: actor.id, categoryId } }, select: { lastSignalAt: true } });
      if (existing?.lastSignalAt) continue;

      const learned = { behaviourScore: Math.max(-maxBehaviourScore, Math.min(maxBehaviourScore, score)), lastSignalAt: new Date() };
      await tx.userInterest.upsert({
        where: { userId_categoryId: { userId: actor.id, categoryId } },
        update: learned,
        create: { userId: actor.id, categoryId, ...learned },
      });
    }

    return loadView(tx, actor.id);
  });
}
