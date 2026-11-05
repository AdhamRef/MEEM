"use client";

import { StatusActions } from "@/components/admin/content/status-actions";
import type { ActionResult } from "@/lib/http/action";

interface VideoStatusActionsProps {
  status: "DRAFT" | "PUBLISHED";
  isArchived: boolean;
  canPublish: boolean;
  canArchive: boolean;
  onPublish: (isPublished: boolean) => Promise<ActionResult<undefined>>;
  onArchive: (isArchived: boolean) => Promise<ActionResult<undefined>>;
  publicHref: string;
}

/**
 * Videos can be archived but not deleted here. Deleting would let a later import bring back
 * something staff had rejected, whereas an archived record keeps it out.
 */
export function VideoStatusActions(props: VideoStatusActionsProps) {
  return <StatusActions {...props} canDelete={false} onDelete={async () => ({ ok: true, data: undefined })} listHref="/admin/shorts" />;
}
