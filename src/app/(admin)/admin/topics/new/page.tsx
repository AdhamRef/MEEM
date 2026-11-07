import { ShieldX } from "lucide-react";
import { TopicForm } from "@/components/admin/content/entity-forms";
import { AdminPageHeader } from "@/components/admin/content/list-frame";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";
import { createTopicAction } from "../actions";

export const metadata = { title: strings.admin.topics };

export default async function NewTopicPage() {
  const access = await checkPageAccess("admin.access", "/admin/topics/new");
  if (!access.allowed) return null;
  if (!hasPermission(access.actor, "topics.manage")) return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;


  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8">
      <AdminPageHeader title={strings.admin.topics} backHref="/admin/topics" />
      <p className="text-sm text-text-secondary">{strings.adminContent.saveFirst}</p>
      <TopicForm
        isPublished={false}
        canEdit
        onSave={createTopicAction}
        initial={{ title: "", slug: "", introduction: null, description: null, coverImage: null, isFeatured: false, displayOrder: 0, parent: null }}
      />
    </div>
  );
}
