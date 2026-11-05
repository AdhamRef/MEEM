import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/config/env";

/** Uploads go through this, so changing provider never touches the rest of the application. */
export interface StorageAdapter {
  /** Stores the object and returns the URL readers load it from. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<string>;
}

/** The only shape of key the application creates, so nothing else can be read back. */
const SAFE_KEY = /^images\/\d{4}\/\d{2}\/[a-f0-9-]{36}\.webp$/;

export function isSafeStorageKey(key: string): boolean {
  return SAFE_KEY.test(key);
}

/** The name is always generated, so nothing from the uploaded file name reaches a path. */
export function newImageKey(now: Date = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `images/${now.getUTCFullYear()}/${month}/${randomUUID()}.webp`;
}

function localRoot(): string {
  return path.resolve(getEnv().STORAGE_LOCAL_DIR);
}

function localPath(key: string): string {
  if (!isSafeStorageKey(key)) throw new Error("Unsafe storage key");
  return path.join(localRoot(), ...key.split("/"));
}

export const localStorageAdapter: StorageAdapter = {
  async put(key, bytes) {
    const filePath = localPath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, bytes, { flag: "wx" });
    return `/media/${key}`;
  },
};

/** Served by the /media route. Next.js only serves `public` files that existed at build time. */
export async function readLocalObject(key: string): Promise<Buffer | null> {
  if (!isSafeStorageKey(key)) return null;
  try {
    return await readFile(localPath(key));
  } catch {
    return null;
  }
}

export function s3PublicUrl(env: { STORAGE_PUBLIC_URL?: string; STORAGE_ENDPOINT?: string; STORAGE_BUCKET?: string; STORAGE_REGION?: string }, key: string): string {
  if (env.STORAGE_PUBLIC_URL) return `${env.STORAGE_PUBLIC_URL.replace(/\/+$/, "")}/${key}`;
  if (env.STORAGE_ENDPOINT) return `${env.STORAGE_ENDPOINT.replace(/\/+$/, "")}/${env.STORAGE_BUCKET}/${key}`;
  return `https://${env.STORAGE_BUCKET}.s3.${env.STORAGE_REGION}.amazonaws.com/${key}`;
}

function s3StorageAdapter(): StorageAdapter {
  return {
    async put(key, bytes, contentType) {
      const env = getEnv();
      // Loaded only when S3 is configured, because it's a large package that local setups never use.
      const { PutObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
      const client = new S3Client({
        region: env.STORAGE_REGION,
        endpoint: env.STORAGE_ENDPOINT,
        forcePathStyle: Boolean(env.STORAGE_ENDPOINT),
        credentials: { accessKeyId: env.STORAGE_ACCESS_KEY!, secretAccessKey: env.STORAGE_SECRET_KEY! },
      });
      await client.send(
        new PutObjectCommand({
          Bucket: env.STORAGE_BUCKET,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      return s3PublicUrl(env, key);
    },
  };
}

export function getStorage(): StorageAdapter {
  return getEnv().STORAGE_PROVIDER === "s3" ? s3StorageAdapter() : localStorageAdapter;
}
