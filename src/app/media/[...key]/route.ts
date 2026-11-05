import { NextResponse, type NextRequest } from "next/server";
import { readLocalObject } from "@/lib/storage";

/**
 * Serves uploads for the local storage provider. Next.js only serves `public` files that
 * existed at build time, so uploads can't live there. Keys are random and never change, so
 * browsers may cache them forever, and only keys the application itself generates can be read.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const bytes = await readLocalObject(key.join("/"));
  if (!bytes) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
