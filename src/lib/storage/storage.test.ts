import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { MAX_UPLOAD_BYTES, processUploadedImage, sniffImageFormat } from "./image";
import { isSafeStorageKey, localStorageAdapter, newImageKey, readLocalObject, s3PublicUrl } from "./index";

const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: "#123456" } }).png().toBuffer();
const jpegWithGps = () =>
  sharp({ create: { width: 40, height: 30, channels: 3, background: "#123456" } })
    .withExif({ IFD3: { GPSLatitudeRef: "N" }, IFD0: { Copyright: "secret-owner" } })
    .jpeg()
    .toBuffer();

async function codeOf(work: Promise<unknown>) {
  try {
    await work;
    return null;
  } catch (error) {
    return error instanceof AppError ? error.code : "UNEXPECTED";
  }
}

describe("sniffImageFormat", () => {
  it("recognises real images by their bytes", async () => {
    expect(sniffImageFormat(await png())).toBe("png");
    expect(sniffImageFormat(await jpegWithGps())).toBe("jpeg");
    expect(sniffImageFormat(await sharp(await png()).webp().toBuffer())).toBe("webp");
  });

  it.each([
    ["SVG with a script", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ["HTML", "<!doctype html><script>alert(1)</script>"],
    ["PHP", "<?php system($_GET['c']); ?>"],
    ["a Windows program", "MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00"],
    ["GIF", "GIF89a\x01\x00\x01\x00"],
    ["PDF", "%PDF-1.7"],
    ["empty", ""],
  ])("rejects %s", (_name, content) => {
    expect(sniffImageFormat(Buffer.from(content, "latin1"))).toBeNull();
  });
});

describe("processUploadedImage", () => {
  it("re-encodes to WebP and reports the real size", async () => {
    const result = await processUploadedImage(await png());
    expect(result.contentType).toBe("image/webp");
    expect(sniffImageFormat(result.bytes)).toBe("webp");
    expect([result.width, result.height]).toEqual([40, 30]);
  });

  it("removes metadata such as GPS positions", async () => {
    const input = await jpegWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const { bytes } = await processUploadedImage(input);
    expect((await sharp(bytes).metadata()).exif).toBeUndefined();
    expect(bytes.includes("secret-owner")).toBe(false);
  });

  it("removes anything hidden after the image data", async () => {
    const polyglot = Buffer.concat([await png(), Buffer.from("<script>alert(1)</script>")]);
    const { bytes } = await processUploadedImage(polyglot);
    expect(bytes.includes("<script>")).toBe(false);
  });

  it("shrinks very wide images and never enlarges small ones", async () => {
    const wide = await sharp({ create: { width: 3000, height: 100, channels: 3, background: "#000" } }).png().toBuffer();
    expect((await processUploadedImage(wide)).width).toBe(2000);
    expect((await processUploadedImage(await png())).width).toBe(40);
  });

  it("rejects an empty file, an oversized file, a wrong type, and a corrupt image", async () => {
    expect(await codeOf(processUploadedImage(new Uint8Array()))).toBe("VALIDATION");
    expect(await codeOf(processUploadedImage(new Uint8Array(MAX_UPLOAD_BYTES + 1)))).toBe("VALIDATION");
    expect(await codeOf(processUploadedImage(Buffer.from("<svg onload=alert(1)>")))).toBe("VALIDATION");
    expect(await codeOf(processUploadedImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])))).toBe("VALIDATION");
  });
});

describe("storage keys", () => {
  it("generates safe keys that never repeat", () => {
    const key = newImageKey(new Date("2026-03-05T00:00:00Z"));
    expect(key).toMatch(/^images\/2026\/03\//);
    expect(isSafeStorageKey(key)).toBe(true);
    expect(newImageKey()).not.toBe(newImageKey());
  });

  it.each(["../../.env", "images/2026/03/../../../.env", "images/2026/03/a.webp", "images/2026/03/a.html", "/etc/passwd", "images\\2026\\03\\x.webp", ""])("rejects %j", (key) => {
    expect(isSafeStorageKey(key)).toBe(false);
  });
});

describe("local storage", () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "uploads-test-"));
    vi.stubEnv("DATABASE_URL", "mongodb://localhost/x");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("STORAGE_LOCAL_DIR", directory);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("stores a file, returns its URL, and reads it back", async () => {
    const key = newImageKey();
    expect(await localStorageAdapter.put(key, Buffer.from("x"), "image/webp")).toBe(`/media/${key}`);
    expect((await readLocalObject(key))?.toString()).toBe("x");
  });

  it("refuses to write outside its own key shape", async () => {
    await expect(localStorageAdapter.put("../evil.webp", Buffer.from("x"), "image/webp")).rejects.toThrow();
  });

  it("can't read anything outside its key shape, even when the file exists", async () => {
    await writeFile(path.join(directory, "secret.txt"), "secret");
    expect(await readLocalObject("secret.txt")).toBeNull();
    expect(await readLocalObject("../secret.txt")).toBeNull();
  });

  it("returns nothing for a missing file", async () => {
    expect(await readLocalObject(newImageKey())).toBeNull();
  });
});

describe("S3 public URLs", () => {
  it("prefers the configured public address", () => {
    expect(s3PublicUrl({ STORAGE_PUBLIC_URL: "https://cdn.example/", STORAGE_BUCKET: "b" }, "k")).toBe("https://cdn.example/k");
  });
  it("uses path style with a custom endpoint", () => {
    expect(s3PublicUrl({ STORAGE_ENDPOINT: "https://r2.example", STORAGE_BUCKET: "b" }, "k")).toBe("https://r2.example/b/k");
  });
  it("falls back to AWS's address", () => {
    expect(s3PublicUrl({ STORAGE_BUCKET: "b", STORAGE_REGION: "eu-west-1" }, "k")).toBe("https://b.s3.eu-west-1.amazonaws.com/k");
  });
});
