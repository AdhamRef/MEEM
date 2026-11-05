import { NextResponse } from "next/server";
import { listActiveCategories } from "@/features/categories/categories.service";
import { apiHandler } from "@/lib/http/api";

/** Public. Used by the first-visit interest prompt, so the home page itself never needs the database. */
export const GET = apiHandler(async () => {
  const categories = await listActiveCategories();
  return NextResponse.json({ categories }, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
});
