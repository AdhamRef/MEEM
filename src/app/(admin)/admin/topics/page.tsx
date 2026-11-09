import { redirect } from "next/navigation";

/** Lists now live in the structure workspace, where they can also be arranged. */
export default function Page() {
  redirect("/admin/structure?tab=topics");
}
