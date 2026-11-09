import { redirect } from "next/navigation";

export default function Page() {
  redirect("/admin/structure?tab=collections&new=1");
}
