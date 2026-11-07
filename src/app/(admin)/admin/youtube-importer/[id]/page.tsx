import { FileX, ShieldX } from "lucide-react";
import Link from "next/link";
import { JobWorkspace } from "@/components/admin/importer/job-workspace";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { getImportJob } from "@/features/youtube/import/import.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { AppError } from "@/lib/errors";
import { hasPermission } from "@/lib/permissions";

const t = strings.importer;

export const metadata = { title: t.title };

export default async function ImportJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await checkPageAccess("admin.access", `/admin/youtube-importer/${id}`);
  if (!access.allowed) return null;
  if (!hasPermission(access.actor, "youtube.import")) return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;

  const job = await getImportJob(access.actor, id).catch((error: unknown) => {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION")) return null;
    throw error;
  });
  if (!job) return <StateMessage icon={FileX} title={strings.errors.notFound} />;


  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-8" data-testid="import-job-page">
      <Link href="/admin/youtube-importer" className="text-sm text-text-secondary underline-offset-4 hover:underline">
        {strings.adminContent.backToList}
      </Link>
      <JobWorkspace
        jobId={job.id}
        jobType={job.type}
        channel={{ title: job.channel.title, handle: job.channel.handle, thumbnailUrl: job.channel.thumbnailUrl, youtubeChannelId: job.channel.youtubeChannelId }}
        startedAt={job.createdAt.toISOString()}
        initial={{ status: job.status, discoveredCount: job.discoveredCount, importedCount: job.importedCount, duplicateCount: job.duplicateCount, skippedCount: job.skippedCount, failedCount: job.failedCount, message: null }}
        initialErrors={job.status === "PAUSED" ? job.errors.map((error) => error.message) : []}
      />
    </div>
  );
}
