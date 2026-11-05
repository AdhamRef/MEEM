import { ShieldX } from "lucide-react";
import { LibraryForm } from "@/components/admin/content/entity-forms";
import { AdminPageHeader } from "@/components/admin/content/list-frame";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";
import { createLibraryAction } from "../actions";

export const metadata = { title: strings.admin.libraries };

export default async function NewLibraryPage() {
  const access = await checkPageAccess("admin.access", "/admin/libraries/new");
  if (!access.allowed) return null;
  if (!hasPermission(access.actor, "libraries.manage")) return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8">
      <AdminPageHeader title={strings.admin.libraries} backHref="/admin/libraries" />
      <p className="text-sm text-text-secondary">{strings.adminContent.saveFirst}</p>
      <LibraryForm
        isPublished={false}
        canEdit
        onSave={createLibraryAction}
        initial={{ name: "", slug: "", description: null, introduction: null, coverImage: null, isFeatured: false, displayOrder: 0, parent: null }}
      />
    </div>
  );
}
