import { z } from "zod";
import { objectIdSchema } from "@/features/topics/schemas";

const topicIdsSchema = z.array(objectIdSchema).max(100);

/** Only channels someone switched by hand, so this stays small however many channels exist. */
export const channelChoicesSchema = z.record(objectIdSchema, z.boolean()).refine((choices) => Object.keys(choices).length <= 500);

export const saveInterestsSchema = z.strictObject({ topicIds: topicIdsSchema, channelChoices: channelChoicesSchema });

export const onboardingOutcomeSchema = z.strictObject({ outcome: z.enum(["completed", "skipped"]) });

export const guestPreferencesSchema = z.strictObject({
  version: z.literal(2),
  selectedTopicIds: topicIdsSchema,
  channelChoices: channelChoicesSchema,
  onboarding: z.enum(["pending", "completed", "skipped"]),
});

export type GuestPreferences = z.infer<typeof guestPreferencesSchema>;

/** What's sent when moving a guest's choices into an account, with their browser-held signals. */
export const guestMergeSchema = guestPreferencesSchema.extend({
  behaviour: z.record(objectIdSchema, z.number().finite()).optional(),
});

export interface PreferencesView {
  selectedTopicIds: string[];
  channelChoices: Record<string, boolean>;
  onboarding: "pending" | "completed" | "skipped";
}
