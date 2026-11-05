import { ShieldX } from "lucide-react";
import { CollectionForm } from "@/components/admin/collections/collection-forms";
import { AdminPageHeader } from "@/components/admin/content/list-frame";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";
import { createCollectionAction } from "../actions";

export const metadata = { title: strings.collections.title };

export default async function NewCollectionPage() {
  const access = await checkPageAccess("admin.access", "/admin/collections/new");
  if (!access.allowed) return null;
  if (!hasPermission(access.actor, "topics.manage")) return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8">
      <AdminPageHeader title={strings.collections.title} backHref="/admin/collections" />
      <p className="text-sm text-text-secondary">{strings.collections.intro}</p>
      <CollectionForm canEdit onSave={createCollectionAction} initial={{ title: "", description: null, displayOrder: 0 }} />
    </div>
  );
}
