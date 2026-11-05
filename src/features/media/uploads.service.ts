import { recordAudit } from "@/features/admin/audit";
import { AppError } from "@/lib/errors";
import { hasPermission, type Actor, type Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { processUploadedImage } from "@/lib/storage/image";
import { getStorage, newImageKey } from "@/lib/storage";

const CAN_UPLOAD: Permission[] = ["content.create", "content.editAssigned", "content.editAny", "topics.manage", "libraries.manage"];

export interface UploadedImage {
  url: string;
  width: number;
  height: number;
}

/** Everything about the file is decided here. Its name and claimed type are never used. */
export async function uploadImage(actor: Actor | null, bytes: Uint8Array): Promise<UploadedImage> {
  if (!actor) throw new AppError("UNAUTHENTICATED");
  if (!CAN_UPLOAD.some((permission) => hasPermission(actor, permission))) throw new AppError("FORBIDDEN");

  const image = await processUploadedImage(bytes);
  const key = newImageKey();
  const url = await getStorage().put(key, image.bytes, image.contentType);

  await recordAudit(prisma, actor, { action: "media.upload", entityType: "Media", entityId: key, metadata: { bytes: image.bytes.length, width: image.width, height: image.height } });
  return { url, width: image.width, height: image.height };
}
