import { NextResponse, type NextRequest } from "next/server";

/**
 * A strict policy for the dashboard, where a successful injection would do the most harm. A
 * nonce makes pages dynamic, which dashboard pages already are. Public pages stay cacheable,
 * with the policy in next.config.ts. This is one more layer, and never the permission check:
 * each service still checks permissions itself.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV !== "production";

  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // The article editor and drag-and-drop set inline styles.
    "style-src 'self' 'unsafe-inline'",
    // Thumbnails come from YouTube, and uploads from whichever storage provider is configured.
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  // Next.js reads the nonce from this request header, and applies it to its own scripts.
  requestHeaders.set("Content-Security-Policy", policy);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
