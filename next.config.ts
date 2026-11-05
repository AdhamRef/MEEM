import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Public pages stay cacheable, which rules out per-request nonces, so inline scripts have to be
 * allowed here. The rest still limits a great deal: what can be framed, where data can go, and
 * who can frame this site. /admin has a stricter policy, in src/proxy.ts.
 */
const publicContentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://www.youtube.com${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Thumbnails come from YouTube, and uploads from whichever storage provider is configured.
  "img-src 'self' data: https:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "object-src 'none'",
  "base-uri 'self'",
  // Signing in posts to the site, which then redirects the browser to Google.
  "form-action 'self' https://accounts.google.com",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,

  // A long article is sent to the server as JSON. The services still apply their own limits.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },

  // Native module with platform binaries, which must not be bundled.
  serverExternalPackages: ["sharp"],

  // Development only. The default corner covers an item in the phone navigation bar.
  devIndicators: { position: "top-left" },

  // Lets phones on the local network reach the dev server during device testing.
  // Comma-separated hostnames, for example DEV_ALLOWED_ORIGINS=192.168.1.20
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // The YouTube player fails with error 153 when no referrer is sent.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // Features this site never uses. Autoplay and fullscreen stay available to the player.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]),
        ],
      },
      { source: "/((?!admin).*)", headers: [{ key: "Content-Security-Policy", value: publicContentSecurityPolicy }] },
      // A second layer alongside each page's metadata: private pages are never indexed.
      ...["/admin/:path*", "/auth/:path*", "/account", "/saved", "/history", "/interests", "/search", "/api/:path*"].map((source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
    ];
  },
};

export default nextConfig;
