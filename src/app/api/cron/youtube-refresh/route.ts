import { NextResponse, type NextRequest } from "next/server";
import { runScheduledRefresh } from "@/features/youtube/metadata-refresh.service";
import { apiHandler } from "@/lib/http/api";
import { assertCronRequest } from "@/lib/http/cron-auth";

/** For a scheduler to call daily. YouTube requires stored data to be refreshed or removed within 30 days. */
const handler = apiHandler(async (request: NextRequest) => {
  assertCronRequest(request);
  const report = await runScheduledRefresh();
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
});

export { handler as GET, handler as POST };
