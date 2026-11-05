import { recordAudit } from "@/features/admin/audit";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { assertPermission, type Actor } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/prisma/transaction";
import { DEFAULT_SCORING_CONFIG, scoringConfigSchema, type ScoringConfig } from "./scoring";

export const SCORING_SETTING_KEY = "recommendations.scoring";

export async function getScoringConfig(): Promise<ScoringConfig> {
  const setting = await prisma.applicationSetting.findUnique({ where: { key: SCORING_SETTING_KEY } });
  if (!setting) return DEFAULT_SCORING_CONFIG;

  const parsed = scoringConfigSchema.safeParse(setting.value);
  if (parsed.success) return parsed.data;

  // A bad stored value shouldn't take the feed down.
  logger.warn("Stored recommendation scoring settings are invalid. Using the defaults.");
  return DEFAULT_SCORING_CONFIG;
}

export async function updateScoringConfig(actor: Actor | null, rawConfig: unknown): Promise<ScoringConfig> {
  assertPermission(actor, "settings.manage");
  const parsed = scoringConfigSchema.safeParse(rawConfig);
  if (!parsed.success) throw new AppError("VALIDATION");
  const value = parsed.data;

  await withTransaction(async (tx) => {
    await tx.applicationSetting.upsert({
      where: { key: SCORING_SETTING_KEY },
      update: { value, updatedById: actor.id },
      create: { key: SCORING_SETTING_KEY, value, updatedById: actor.id },
    });
    await recordAudit(tx, actor, {
      action: "settings.update",
      entityType: "ApplicationSetting",
      entityId: SCORING_SETTING_KEY,
      metadata: { value },
    });
  });

  return value;
}
