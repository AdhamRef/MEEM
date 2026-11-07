import { redirect } from "next/navigation";

/** Replaced by Sources (plan D10). Kept so bookmarks and old links still land somewhere useful. */
export default function MovedToSources() {
  redirect("/admin/sources");
}
