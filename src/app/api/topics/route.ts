import { NextResponse } from "next/server";
import { getInterestCatalogue } from "@/features/topics/catalogue.service";
import { apiHandler } from "@/lib/http/api";

/** Public, and the same for everyone. It lets the home page stay static and load this in the browser. */
export const GET = apiHandler(async () => {
  return NextResponse.json(await getInterestCatalogue(), { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
});
