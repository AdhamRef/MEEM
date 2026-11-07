import { AdminPageHeader } from "@/components/admin/content/list-frame";
import { ArticleEditor } from "@/components/articles/editor/article-editor";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { checkPageAccess } from "@/lib/auth/guards";
import { EMPTY_DOCUMENT } from "@/lib/content/document";
import { hasPermission } from "@/lib/permissions";
import { ShieldX } from "lucide-react";
import { createArticleAction } from "../actions";

export const metadata = { title: strings.editor.newArticle };

export default async function NewArticlePage() {
  const access = await checkPageAccess("admin.access", "/admin/articles/new");
  if (!access.allowed) return null;
  if (!hasPermission(access.actor, "content.create")) return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;


  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8">
      <AdminPageHeader title={strings.editor.newArticle} backHref="/admin/articles" />
      <ArticleEditor
        status="DRAFT"
        canAssign={hasPermission(access.actor, "content.editAny")}
        onSave={createArticleAction}
        initial={{
          title: "",
          slug: "",
          excerpt: null,
          coverImage: null,
          coverCaption: null,
          bylineName: null,
          seoTitle: null,
          seoDescription: null,
          sources: [],
          body: EMPTY_DOCUMENT,
          topics: [],
          libraries: [],
          videos: [],
          playlists: [],
          relations: [],
          assignees: [],
        }}
      />
    </div>
  );
}
