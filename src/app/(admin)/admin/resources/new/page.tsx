import { ShieldX } from "lucide-react";
import { ResourceForm } from "@/components/admin/content/entity-forms";
import { AdminPageHeader } from "@/components/admin/content/list-frame";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";
import { createResourceAction } from "../actions";

export const metadata = { title: strings.admin.resources };

export default async function NewResourcePage() {
  const access = await checkPageAccess("admin.access", "/admin/resources/new");
  if (!access.allowed) return null;
  if (!hasPermission(access.actor, "relationships.manage")) return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8">
      <AdminPageHeader title={strings.admin.resources} backHref="/admin/resources" />
      <ResourceForm isPublished={false} canEdit onSave={createResourceAction} initial={{ title: "", slug: "", sourceName: "", url: "", description: null, coverImage: null }} />
    </div>
  );
}
