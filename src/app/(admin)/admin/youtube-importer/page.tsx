import { ShieldX } from "lucide-react";
import Link from "next/link";
import { JobList } from "@/components/admin/importer/job-list";
import { ImporterStart } from "@/components/admin/importer/importer-start";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { StatTile } from "@/components/admin/importer/job-visuals";
import { getImporterOverview, listImportJobs } from "@/features/youtube/import/import.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/permissions";
import { isYouTubeApiConfigured } from "@/lib/youtube/client";
import { isQuotaExhausted } from "@/lib/youtube/quota";

const t = strings.importer;

export const metadata = { title: t.title };

export default async function ImporterPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const access = await checkPageAccess("admin.access", "/admin/youtube-importer");
  if (!access.allowed) return null;
  if (!hasPermission(access.actor, "youtube.import")) return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;

  const { cursor } = await searchParams;
  const [jobs, quotaExhausted, overview] = await Promise.all([listImportJobs(access.actor, { cursor }), isQuotaExhausted(), getImporterOverview(access.actor)]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">{t.title}</h1>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="importer-overview">
        <StatTile label={t.overview.channels} value={overview.channels} />
        <StatTile label={t.overview.discovered} value={overview.discovered} />
        <StatTile label={t.overview.imported} value={overview.imported} />
        <StatTile label={t.overview.needsReview} value={overview.needsReview} />
        <StatTile label={t.overview.unfinished} value={overview.unfinished} />
        <StatTile label={t.overview.quota} value={overview.quotaExhausted ? t.overview.quotaOut : overview.quotaUnits} hint={t.overview.quotaHint("10,000")} tone={overview.quotaExhausted ? "alert" : undefined} />
      </dl>

      <ImporterStart isConfigured={isYouTubeApiConfigured()} quotaExhausted={quotaExhausted} />

      <section className="space-y-2">
        <h2 className="font-semibold">{t.jobsTitle}</h2>
        {jobs.items.length === 0 ? (
          <p className="rounded-xl border bg-surface p-6 text-center text-text-secondary" data-testid="jobs-empty">
            {t.jobsEmpty}
          </p>
        ) : (
          <JobList
            jobs={jobs.items.map((job) => ({
              id: job.id,
              channelId: job.channelId,
              channelTitle: job.channel.title,
              channelHandle: job.channel.handle,
              channelImage: job.channel.thumbnailUrl,
              youtubeChannelId: job.channel.youtubeChannelId,
              shortCount: job.shortCount,
              longCount: job.longCount,
              failedCount: job.failedCount,
              type: job.type,
              status: job.status,
              discoveredCount: job.discoveredCount,
              importedCount: job.importedCount,
              createdAt: job.createdAt.toISOString(),
              updatedAt: job.updatedAt.toISOString(),
            }))}
          />
        )}
        {jobs.nextCursor ? (
          <Link href={`/admin/youtube-importer?cursor=${jobs.nextCursor}`} className="text-sm text-brand underline-offset-4 hover:underline">
            {strings.adminContent.nextPage}
          </Link>
        ) : null}
      </section>
    </div>
  );
}
