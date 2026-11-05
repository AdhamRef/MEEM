"use server";

import { updateYouTubeSettings } from "@/features/admin/system.service";
import { updateScoringConfig } from "@/features/recommendations/settings.service";
import { runAction } from "@/lib/http/action";

export async function updateScoringAction(input: unknown) {
  return runAction("updateScoring", async (actor) => {
    await updateScoringConfig(actor, input);
    return undefined;
  });
}

export async function updateYouTubeSettingsAction(input: unknown) {
  return runAction("updateYouTubeSettings", async (actor) => {
    await updateYouTubeSettings(actor, input);
    return undefined;
  });
}
