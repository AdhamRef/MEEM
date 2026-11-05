/* eslint-disable @next/next/no-img-element -- Thumbnails load directly from YouTube by design, and aren't re-processed or re-hosted. */
import { FileX, ShieldX } from "lucide-react";
import { LinksManager } from "@/components/admin/content/links-manager";
import { AdminPageHeader, StatusBadge } from "@/components/admin/content/list-frame";
import { VideoStatusActions } from "@/components/admin/videos/video-status-actions";
import { VideoEditor } from "@/components/admin/videos/video-editor";
import { StateMessage } from "@/components/shared/state-message";
import { Badge } from "@/components/ui/badge";
import { strings } from "@/config/strings.ar";
import { listActiveCategories } from "@/features/categories/categories.service";
import { formatDuration } from "@/features/playlists/rules";
import { canManageLink, linkTargetType, type LinkKind } from "@/features/relationships/links.service";
import { getVideoForEditing } from "@/features/shorts/videos-admin.service";
import { checkPageAccess } from "@/lib/auth/guards";
import { AppError } from "@/lib/errors";
import { hasPermission } from "@/lib/permissions";
import { formatDate } from "@/lib/utils/format";
import { youtubeWatchUrl } from "@/lib/youtube/ids";
import { assignVideoAction, setVideoArchivedAction, setVideoPublishedAction } from "../actions";

const v = strings.videosAdmin;

export const metadata = { title: strings.admin.shorts };

const LINK_KINDS: LinkKind[] = ["video.topic", "video.library", "video.article"];

export default async function EditVideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await checkPageAccess("admin.access", `/admin/shorts/${id}`);
  if (!access.allowed) return null;
  const { actor } = access;
  if (!hasPermission(actor, "content.viewAny")) return <StateMessage icon={ShieldX} title={strings.admin.deniedTitle} description={strings.adminContent.noPermission} />;

  const video = await getVideoForEditing(actor, id).catch((error: unknown) => {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION")) return null;
    throw error;
  });
  if (!video) return <StateMessage icon={FileX} title={strings.errors.notFound} />;

  const categories = await listActiveCategories();
  const duration = formatDuration(video.durationSeconds);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8" data-testid="video-edit-page">
      <AdminPageHeader title={video.title || v.withdrawn} backHref="/admin/shorts">
        <StatusBadge status={video.status} isArchived={video.isArchived} />
      </AdminPageHeader>

      <section className="flex flex-wrap gap-4 rounded-xl border bg-surface p-4" data-testid="video-youtube-details">
        {video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" referrerPolicy="strict-origin-when-cross-origin" className="aspect-video w-48 rounded-lg object-cover" /> : null}
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <p className="text-text-secondary">
            {video.channelTitle ? (
              <>
                <bdi>{video.channelTitle}</bdi> ·{" "}
              </>
            ) : null}
            {strings.feed.source}
            {duration ? (
              <>
                {" "}
                · <bdi dir="ltr">{duration}</bdi>
              </>
            ) : null}
            {video.ytPublishedAt ? ` · ${formatDate(video.ytPublishedAt)}` : ""}
          </p>
          <div className="flex flex-wrap gap-1">
            <Badge variant="secondary">{video.classification === "SHORT_CANDIDATE" ? strings.importer.shortCandidate : strings.importer.longCandidate}</Badge>
            {video.reviewedAt ? <Badge variant="outline">{v.reviewed}</Badge> : <Badge variant="outline">{v.needsReview}</Badge>}
            {video.availability === "AVAILABLE" ? null : <Badge variant="destructive">{v.availability[video.availability]}</Badge>}
          </div>
          <a href={youtubeWatchUrl(video.youtubeVideoId)} target="_blank" rel="noopener noreferrer" className="inline-block text-brand underline-offset-4 hover:underline">
            {strings.feed.watchOnYouTube}
          </a>
          <p className="text-xs text-text-secondary">{v.youtubeLocked}</p>
        </div>
      </section>

      <VideoStatusActions
        status={video.status}
        isArchived={video.isArchived}
        canPublish={hasPermission(actor, "content.publish")}
        canArchive={hasPermission(actor, "content.archive")}
        onPublish={setVideoPublishedAction.bind(null, id)}
        onArchive={setVideoArchivedAction.bind(null, id)}
        publicHref={`/videos/${id}`}
      />

      <VideoEditor
        id={id}
        canEdit={hasPermission(actor, "content.editAny")}
        categories={categories.map((category) => ({ id: category.id, title: category.title }))}
        onSave={assignVideoAction.bind(null, id)}
        initial={{ kind: video.kind, categoryId: video.categoryId, ctaType: video.cta?.type ?? "", ctaLabel: video.cta?.label ?? "", ctaUrl: video.cta?.externalUrl ?? "", ctaTarget: video.ctaTarget }}
      />

      <LinksManager ownerId={id} sections={LINK_KINDS.map((kind) => ({ kind, targetType: linkTargetType(kind), canManage: canManageLink(actor, kind) }))} />
    </div>
  );
}
