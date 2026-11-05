import { ShieldX } from "lucide-react";
import { CategoryManager } from "@/components/admin/system/category-manager";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { listAllCategories } from "@/features/categories/categories.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";

export const metadata = { title: strings.admin.categories };

export default async function AdminCategoriesPage() {
  const access = await checkPageAccess("admin.access", "/admin/categories");
  if (!access.allowed) return null;
  if (!hasPermission(access.actor, "categories.manage")) return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;

  const categories = await listAllCategories(access.actor);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8">
      <h1 className="text-2xl font-semibold">{strings.admin.categories}</h1>
      <CategoryManager canManage categories={categories} />
    </div>
  );
}
