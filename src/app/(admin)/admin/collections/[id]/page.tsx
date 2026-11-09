import { redirect } from "next/navigation";

/** Kept so existing links and bookmarks still open the item, now beside its place in the tree. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/structure?tab=collections&id=${encodeURIComponent(id)}`);
}
