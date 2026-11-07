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
import { createActor, createChannel, createPublishedTopic } from "./phase3-helpers";

let prisma: PrismaClient;
let person: Actor;
let topicIds: string[];

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
  topicIds = [];
  for (let index = 0; index < 3; index += 1) topicIds.push((await createPublishedTopic(prisma)).id);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const [A, B, C] = [0, 1, 2];
const sorted = (ids: string[]) => [...ids].sort();
const save = (actor: Actor | null, ids: (string | undefined)[], channelChoices: Record<string, boolean> = {}) => saveInterests(actor, { topicIds: ids, channelChoices });

describe("guests", () => {
  it("can't use any account preference operation", async () => {
    expect(await errorCodeOf(getPreferences(null))).toBe("UNAUTHENTICATED");
    expect(await errorCodeOf(save(null, []))).toBe("UNAUTHENTICATED");
    expect(await errorCodeOf(setOnboardingOutcome(null, { outcome: "skipped" }))).toBe("UNAUTHENTICATED");
    expect(await errorCodeOf(resetInterests(null))).toBe("UNAUTHENTICATED");
    expect(await errorCodeOf(mergeGuestPreferences(null, { version: 2, selectedTopicIds: [], channelChoices: {}, onboarding: "pending" }))).toBe("UNAUTHENTICATED");
  });
});

describe("saveInterests", () => {
  it("starts empty and stores the selection", async () => {
    expect(await getPreferences(person)).toEqual({ selectedTopicIds: [], channelChoices: {}, onboarding: "pending" });

    const view = await save(person, [topicIds[A], topicIds[B]]);
    expect(sorted(view.selectedTopicIds)).toEqual(sorted([topicIds[A]!, topicIds[B]!]));
  });

  it("removing a topic clears what was learned about it (§9.3)", async () => {
    await save(person, [topicIds[A]]);
    await prisma.userInterest.updateMany({ where: { userId: person.id }, data: { behaviourScore: 5, lastSignalAt: new Date() } });

    await save(person, [topicIds[B]]);

    const removed = await prisma.userInterest.findFirstOrThrow({ where: { userId: person.id, topicId: topicIds[A] } });
    expect(removed).toMatchObject({ isSelected: false, explicitWeight: 0, behaviourScore: 0, lastSignalAt: null });
  });

  it("keeps what was learned about topics never selected", async () => {
    await prisma.userInterest.create({ data: { userId: person.id, topicId: topicIds[C]!, behaviourScore: 2 } });
    await save(person, [topicIds[A]]);
    const untouched = await prisma.userInterest.findFirstOrThrow({ where: { userId: person.id, topicId: topicIds[C] } });
    expect(untouched.behaviourScore).toBe(2);
  });

  it("keeps what was learned about a topic that stays selected", async () => {
    await save(person, [topicIds[A]]);
    await prisma.userInterest.updateMany({ where: { userId: person.id }, data: { behaviourScore: 3 } });
    await save(person, [topicIds[A], topicIds[B]]);
    const kept = await prisma.userInterest.findFirstOrThrow({ where: { userId: person.id, topicId: topicIds[A] } });
    expect(kept.behaviourScore).toBe(3);
  });

  it("refuses an unknown, draft, or archived topic and changes nothing", async () => {
    await save(person, [topicIds[A]]);

    expect(await errorCodeOf(save(person, ["f".repeat(24)]))).toBe("VALIDATION");

    await prisma.topic.update({ where: { id: topicIds[B] }, data: { status: "DRAFT" } });
    expect(await errorCodeOf(save(person, [topicIds[B]]))).toBe("VALIDATION");

    await prisma.topic.update({ where: { id: topicIds[C] }, data: { isArchived: true } });
    expect(await errorCodeOf(save(person, [topicIds[C]]))).toBe("VALIDATION");

    expect((await getPreferences(person)).selectedTopicIds).toEqual([topicIds[A]]);
  });

  it("ignores duplicates in the request", async () => {
    const view = await save(person, [topicIds[A], topicIds[A]]);
    expect(view.selectedTopicIds).toEqual([topicIds[A]]);
  });

  it("refuses a request naming another user, or leaving out the channel choices", async () => {
    const other = await createActor(prisma, "USER");
    expect(await errorCodeOf(saveInterests(person, { topicIds: [topicIds[A]], channelChoices: {}, userId: other.id }))).toBe("VALIDATION");
    expect(await errorCodeOf(saveInterests(person, { topicIds: [topicIds[A]] }))).toBe("VALIDATION");
    expect((await getPreferences(other)).selectedTopicIds).toEqual([]);
    expect((await getPreferences(person)).selectedTopicIds).toEqual([]);
  });

  it("only ever changes the person's own data", async () => {
    const other = await createActor(prisma, "USER");
    const channel = await createChannel(prisma);
    await save(other, [topicIds[C]], { [channel.id]: true });
    await save(person, [topicIds[A]], { [channel.id]: false });
    await resetInterests(person);
    expect(await getPreferences(other)).toMatchObject({ selectedTopicIds: [topicIds[C]], channelChoices: { [channel.id]: true } });
  });

  it("handles simultaneous saves without error or duplicates", async () => {
    await Promise.all([save(person, [topicIds[A]]), save(person, [topicIds[A]]), save(person, [topicIds[A]])]);
    expect(await prisma.userInterest.count({ where: { userId: person.id } })).toBe(1);
  });
});

describe("channel choices", () => {
  it("stores only the channels switched by hand, and replaces them on each save", async () => {
    const [first, second] = [await createChannel(prisma), await createChannel(prisma)];
    await createChannel(prisma);

    const view = await save(person, [topicIds[A]], { [first.id]: true, [second.id]: false });
    expect(view.channelChoices).toEqual({ [first.id]: true, [second.id]: false });
    expect(await prisma.userChannelChoice.count({ where: { userId: person.id } })).toBe(2);

    expect((await save(person, [topicIds[A]], { [second.id]: true })).channelChoices).toEqual({ [second.id]: true });
    expect(await prisma.userChannelChoice.count({ where: { userId: person.id } })).toBe(1);
  });

  it("refuses an unknown channel or a bad value and changes nothing", async () => {
    const channel = await createChannel(prisma);
    await save(person, [topicIds[A]], { [channel.id]: true });

    expect(await errorCodeOf(save(person, [topicIds[B]], { ["f".repeat(24)]: true }))).toBe("VALIDATION");
    expect(await errorCodeOf(saveInterests(person, { topicIds: [topicIds[B]], channelChoices: { nope: true } }))).toBe("VALIDATION");
    expect(await errorCodeOf(saveInterests(person, { topicIds: [topicIds[B]], channelChoices: { [channel.id]: "yes" } }))).toBe("VALIDATION");

    expect(await getPreferences(person)).toMatchObject({ selectedTopicIds: [topicIds[A]], channelChoices: { [channel.id]: true } });
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
  it("clears selections, switched channels, and learned scores, and keeps the onboarding state", async () => {
    const channel = await createChannel(prisma);
    await save(person, [topicIds[A]], { [channel.id]: false });
    await setOnboardingOutcome(person, { outcome: "completed" });
    await prisma.userInterest.create({ data: { userId: person.id, topicId: topicIds[B]!, behaviourScore: 4 } });

    const view = await resetInterests(person);

    expect(view).toEqual({ selectedTopicIds: [], channelChoices: {}, onboarding: "completed" });
    expect(await prisma.userInterest.count({ where: { userId: person.id } })).toBe(0);
    expect(await prisma.userChannelChoice.count({ where: { userId: person.id } })).toBe(0);
  });
});

describe("merging guest preferences at sign-in (§8.2)", () => {
  const guest = (selectedTopicIds: string[], onboarding: "pending" | "completed" | "skipped" = "completed", channelChoices: Record<string, boolean> = {}) => ({
    version: 2,
    selectedTopicIds,
    channelChoices,
    onboarding,
  });

  it("moves a guest's choices into a new account", async () => {
    const channel = await createChannel(prisma);
    const view = await mergeGuestPreferences(person, guest([topicIds[A]!, topicIds[B]!], "completed", { [channel.id]: false }));
    expect(sorted(view.selectedTopicIds)).toEqual(sorted([topicIds[A]!, topicIds[B]!]));
    expect(view.channelChoices).toEqual({ [channel.id]: false });
    expect(view.onboarding).toBe("completed");
  });

  it("keeps what the account already had", async () => {
    await save(person, [topicIds[C]]);
    const view = await mergeGuestPreferences(person, guest([topicIds[A]!]));
    expect(sorted(view.selectedTopicIds)).toEqual(sorted([topicIds[A]!, topicIds[C]!]));
  });

  it("fills only channels the account hasn't decided, so signing in never undoes a choice", async () => {
    const [decided, undecided] = [await createChannel(prisma), await createChannel(prisma)];
    await save(person, [], { [decided.id]: false });
    const view = await mergeGuestPreferences(person, guest([], "completed", { [decided.id]: true, [undecided.id]: true }));
    expect(view.channelChoices).toEqual({ [decided.id]: false, [undecided.id]: true });
  });

  it("keeps learned scores on the account's existing selections", async () => {
    await save(person, [topicIds[C]]);
    await prisma.userInterest.updateMany({ where: { userId: person.id }, data: { behaviourScore: 3 } });

    await mergeGuestPreferences(person, guest([topicIds[A]!]));

    const kept = await prisma.userInterest.findFirstOrThrow({ where: { userId: person.id, topicId: topicIds[C] } });
    expect(kept.behaviourScore).toBe(3);
  });

  it("drops topics and channels that are gone or unpublished rather than failing", async () => {
    await prisma.topic.update({ where: { id: topicIds[B] }, data: { status: "DRAFT" } });
    const view = await mergeGuestPreferences(person, guest([topicIds[A]!, topicIds[B]!, "f".repeat(24)], "completed", { ["f".repeat(24)]: true }));
    expect(view.selectedTopicIds).toEqual([topicIds[A]]);
    expect(view.channelChoices).toEqual({});
  });

  it("gives the same result when repeated, so a retry after a lost response is safe", async () => {
    const input = guest([topicIds[A]!]);
    await mergeGuestPreferences(person, input);
    const again = await mergeGuestPreferences(person, input);
    expect(again.selectedTopicIds).toEqual([topicIds[A]]);
    expect(await prisma.userInterest.count({ where: { userId: person.id } })).toBe(1);
  });

  it("carries over a skip, and doesn't downgrade a finished onboarding", async () => {
    expect((await mergeGuestPreferences(person, guest([], "skipped"))).onboarding).toBe("skipped");
    await setOnboardingOutcome(person, { outcome: "completed" });
    expect((await mergeGuestPreferences(person, guest([], "skipped"))).onboarding).toBe("completed");
  });

  it("rejects malformed browser data, including the old format", async () => {
    expect(await errorCodeOf(mergeGuestPreferences(person, { version: 9 }))).toBe("VALIDATION");
    expect(await errorCodeOf(mergeGuestPreferences(person, { version: 1, selectedTopicIds: [], channelChoices: {}, onboarding: "pending" }))).toBe("VALIDATION");
    expect(await errorCodeOf(mergeGuestPreferences(person, { ...guest([]), role: "ADMIN" }))).toBe("VALIDATION");
  });
});
