import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export const YOUTUBE_SETTINGS_KEY = "youtube.settings";

/** YouTube's limit for keeping API data without refreshing it. */
export const MAX_DATA_AGE_DAYS = 30;

export const youtubeSettingsSchema = z.strictObject({
  /**
   * OWNER'S DECISION, 2026-11-06, changing decision D6: on, so likes and comment counts show. YouTube
   * limits storing statistics, so this must be reviewed before the API Compliance Audit.
   */
  statisticsEnabled: z.boolean(),
  /** Below the 30-day limit, so a missed run or two still leaves time to refresh. */
  refreshAfterDays: z.number().int().min(1).max(MAX_DATA_AGE_DAYS - 1),
  maxShortSeconds: z.number().int().min(1).max(3600),
  /** At 50 videos and 1 quota unit per batch, the default refreshes up to 1,000 videos per run. */
  refreshBatchesPerRun: z.number().int().min(1).max(1000),
});

export type YouTubeSettings = z.infer<typeof youtubeSettingsSchema>;

export const DEFAULT_YOUTUBE_SETTINGS: YouTubeSettings = {
  statisticsEnabled: true,
  refreshAfterDays: 25,
  maxShortSeconds: 180,
  refreshBatchesPerRun: 20,
};

export async function getYouTubeSettings(): Promise<YouTubeSettings> {
  const setting = await prisma.applicationSetting.findUnique({ where: { key: YOUTUBE_SETTINGS_KEY } });
  if (!setting) return DEFAULT_YOUTUBE_SETTINGS;

  const parsed = youtubeSettingsSchema.safeParse(setting.value);
  if (parsed.success) return parsed.data;

  logger.warn("Stored YouTube settings are invalid. Using the defaults.");
  return DEFAULT_YOUTUBE_SETTINGS;
}
