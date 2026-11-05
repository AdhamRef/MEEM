import { ShieldX } from "lucide-react";
import { ScoringSettingsForm, YouTubeSettingsForm } from "@/components/admin/system/settings-forms";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { getSettingsForEditing } from "@/features/admin/system.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";

export const metadata = { title: strings.admin.settings };

export default async function SettingsPage() {
  const access = await checkPageAccess("admin.access", "/admin/settings");
  if (!access.allowed) return null;
  if (!hasPermission(access.actor, "settings.manage")) return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;

  const settings = await getSettingsForEditing(access.actor);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8">
      <h1 className="text-2xl font-semibold">{strings.admin.settings}</h1>
      <ScoringSettingsForm initial={settings.scoring} />
      <YouTubeSettingsForm initial={settings.youtube} />
    </div>
  );
}
