import sharp from "sharp";
import { AppError } from "@/lib/errors";
import { strings } from "@/config/strings.ar";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_OUTPUT_WIDTH = 2000;
const OUTPUT_QUALITY = 82;

export type AllowedImageFormat = "jpeg" | "png" | "webp";

/**
 * Identifies an image by its first bytes, because a browser-supplied type and file name are
 * only claims. SVG is excluded on purpose, since it can carry scripts.
 */
export function sniffImageFormat(bytes: Uint8Array): AllowedImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return "png";
  if (bytes.length >= 12) {
    const tag = (start: number) => String.fromCharCode(...bytes.slice(start, start + 4));
    if (tag(0) === "RIFF" && tag(8) === "WEBP") return "webp";
  }
  return null;
}

export interface ProcessedImage {
  bytes: Buffer;
  contentType: "image/webp";
  extension: "webp";
  width: number;
  height: number;
}

/**
 * Re-encoding keeps only the pixels. It removes metadata, including GPS positions in phone
 * photos, and anything hidden after the image data, so what gets stored is always a real image.
 */
export async function processUploadedImage(input: Uint8Array): Promise<ProcessedImage> {
  if (input.length === 0) throw new AppError("VALIDATION", strings.uploads.empty);
  if (input.length > MAX_UPLOAD_BYTES) throw new AppError("VALIDATION", strings.uploads.tooLarge);

  const format = sniffImageFormat(input);
  if (!format) throw new AppError("VALIDATION", strings.uploads.badType);

  try {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .rotate()
      .resize({ width: MAX_OUTPUT_WIDTH, withoutEnlargement: true })
      .webp({ quality: OUTPUT_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { bytes: data, contentType: "image/webp", extension: "webp", width: info.width, height: info.height };
  } catch {
    // The first bytes looked right, but the file itself isn't a usable image.
    throw new AppError("VALIDATION", strings.uploads.corrupt);
  }
}
