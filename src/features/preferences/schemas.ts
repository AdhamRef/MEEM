import { z } from "zod";
import { objectIdSchema } from "@/features/categories/schemas";

const categoryIdsSchema = z.array(objectIdSchema).max(100);

export const saveInterestsSchema = z.strictObject({ categoryIds: categoryIdsSchema });

export const onboardingOutcomeSchema = z.strictObject({ outcome: z.enum(["completed", "skipped"]) });

export const guestPreferencesSchema = z.strictObject({
  version: z.literal(1),
  selectedCategoryIds: categoryIdsSchema,
  onboarding: z.enum(["pending", "completed", "skipped"]),
});

export type GuestPreferences = z.infer<typeof guestPreferencesSchema>;

/** What's sent when moving a guest's choices into an account, with their browser-held signals. */
export const guestMergeSchema = guestPreferencesSchema.extend({
  behaviour: z.record(objectIdSchema, z.number().finite()).optional(),
});

export interface PreferencesView {
  selectedCategoryIds: string[];
  onboarding: "pending" | "completed" | "skipped";
}
