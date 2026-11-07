import type { Prisma } from "@prisma/client";
import { getScoringConfig } from "@/features/recommendations/settings.service";
import { AppError } from "@/lib/errors";
import { assertSignedIn, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { mergeChannelChoices, type ChannelChoices } from "./channel-choices";
import { mergeOnboardingState, mergeSelectedTopics, type OnboardingState } from "./merge";
import { guestMergeSchema, onboardingOutcomeSchema, saveInterestsSchema, type PreferencesView } from "./schemas";

// Every function uses the signed-in person's own ID and takes no user ID from input, so
// nobody can read or change someone else's preferences.

function onboardingStateOf(preference: { onboardingDoneAt: Date | null; onboardingSkipped: boolean } | null): OnboardingState {
  if (preference?.onboardingDoneAt) return "completed";
  return preference?.onboardingSkipped ? "skipped" : "pending";
}

async function loadView(db: Prisma.TransactionClient, userId: string): Promise<PreferencesView> {
  const [interests, choices, preference] = await Promise.all([
    db.userInterest.findMany({ where: { userId, isSelected: true }, select: { topicId: true } }),
    db.userChannelChoice.findMany({ where: { userId }, select: { channelId: true, isEnabled: true } }),
    db.userPreference.findUnique({ where: { userId } }),
  ]);
  return {
    selectedTopicIds: interests.map((interest) => interest.topicId),
    channelChoices: Object.fromEntries(choices.map((choice) => [choice.channelId, choice.isEnabled])),
    onboarding: onboardingStateOf(preference),
  };
}

export async function getPreferences(actor: Actor | null): Promise<PreferencesView> {
  assertSignedIn(actor);
  return loadView(prisma, actor.id);
}

async function publicTopicIds(tx: Prisma.TransactionClient, ids: string[]): Promise<Set<string>> {
  const topics = await tx.topic.findMany({ where: { id: { in: ids }, status: "PUBLISHED", isArchived: false }, select: { id: true } });
  return new Set(topics.map((topic) => topic.id));
}

async function existingChannelIds(tx: Prisma.TransactionClient, ids: string[]): Promise<Set<string>> {
  const channels = await tx.youTubeChannel.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return new Set(channels.map((channel) => channel.id));
}

/**
 * Removing a topic also clears what was learned about it, so a manual choice isn't
 * overruled by old behaviour (§9.3). Topics never selected keep their learned score.
 */
async function applySelection(tx: Prisma.TransactionClient, userId: string, topicIds: string[]): Promise<void> {
  await tx.userInterest.updateMany({
    where: { userId, isSelected: true, topicId: { notIn: topicIds } },
    data: { isSelected: false, explicitWeight: 0, behaviourScore: 0, lastSignalAt: null },
  });

  for (const topicId of topicIds) {
    await tx.userInterest.upsert({
      where: { userId_topicId: { userId, topicId } },
      update: { isSelected: true, explicitWeight: 1 },
      create: { userId, topicId, isSelected: true, explicitWeight: 1 },
    });
  }
}

async function replaceChannelChoices(tx: Prisma.TransactionClient, userId: string, choices: ChannelChoices): Promise<void> {
  await tx.userChannelChoice.deleteMany({ where: { userId } });
  const data = Object.entries(choices).map(([channelId, isEnabled]) => ({ userId, channelId, isEnabled }));
  if (data.length) await tx.userChannelChoice.createMany({ data });
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
  const topicIds = [...new Set(parsed.data.topicIds)];
  const { channelChoices } = parsed.data;
  const channelIds = Object.keys(channelChoices);

  return withTransaction(async (tx) => {
    const [topics, channels] = await Promise.all([publicTopicIds(tx, topicIds), existingChannelIds(tx, channelIds)]);
    if (topics.size !== topicIds.length || channels.size !== channelIds.length) throw new AppError("VALIDATION");
    await applySelection(tx, actor.id, topicIds);
    await replaceChannelChoices(tx, actor.id, channelChoices);
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

/** Clears chosen topics, switched channels, and everything learned from behaviour (§9.3). */
export async function resetInterests(actor: Actor | null): Promise<PreferencesView> {
  assertSignedIn(actor);
  return withTransaction(async (tx) => {
    await tx.userInterest.deleteMany({ where: { userId: actor.id } });
    await tx.userChannelChoice.deleteMany({ where: { userId: actor.id } });
    return loadView(tx, actor.id);
  });
}

/**
 * Moves what a guest chose into their account after sign-in. Unknown or unpublished
 * topics and channels are dropped rather than rejected, because browser data can be old (§8.2).
 */
export async function mergeGuestPreferences(actor: Actor | null, rawInput: unknown): Promise<PreferencesView> {
  assertSignedIn(actor);
  const parsed = guestMergeSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError("VALIDATION");
  const guest = parsed.data;
  const { maxBehaviourScore } = await getScoringConfig();

  return withTransaction(async (tx) => {
    const account = await loadView(tx, actor.id);
    const active = await publicTopicIds(tx, [...account.selectedTopicIds, ...guest.selectedTopicIds]);
    await applySelection(tx, actor.id, mergeSelectedTopics(account.selectedTopicIds, guest.selectedTopicIds, active));

    const known = await existingChannelIds(tx, [...Object.keys(account.channelChoices), ...Object.keys(guest.channelChoices)]);
    await replaceChannelChoices(tx, actor.id, mergeChannelChoices(account.channelChoices, guest.channelChoices, known));

    const onboarding = mergeOnboardingState(account.onboarding, guest.onboarding);
    if (onboarding !== account.onboarding) await writeOnboardingState(tx, actor.id, onboarding);

    // Browser data can be edited, so it's bounded. It fills gaps only and never replaces what
    // the account has learned, so repeating a merge changes nothing.
    const behaviour = Object.entries(guest.behaviour ?? {});
    const behaviourTopics = await publicTopicIds(tx, behaviour.map(([topicId]) => topicId));
    for (const [topicId, score] of behaviour) {
      if (!behaviourTopics.has(topicId)) continue;
      const existing = await tx.userInterest.findUnique({ where: { userId_topicId: { userId: actor.id, topicId } }, select: { lastSignalAt: true } });
      if (existing?.lastSignalAt) continue;

      const learned = { behaviourScore: Math.max(-maxBehaviourScore, Math.min(maxBehaviourScore, score)), lastSignalAt: new Date() };
      await tx.userInterest.upsert({
        where: { userId_topicId: { userId: actor.id, topicId } },
        update: learned,
        create: { userId: actor.id, topicId, ...learned },
      });
    }

    return loadView(tx, actor.id);
  });
}
