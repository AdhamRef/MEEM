import { NextResponse, type NextRequest } from "next/server";
import { runScheduledSourceCheck } from "@/features/youtube/sources/sources.service";
import { apiHandler } from "@/lib/http/api";
import { assertCronRequest } from "@/lib/http/cron-auth";

/** The run itself stops at 45 seconds. This leaves room to finish the page under way and respond. */
export const maxDuration = 60;

/** For a scheduler to call hourly (plan D10): new videos from followed channels and playlists. */
const handler = apiHandler(async (request: NextRequest) => {
  assertCronRequest(request);
  const report = await runScheduledSourceCheck();
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
});

export { handler as GET, handler as POST };
