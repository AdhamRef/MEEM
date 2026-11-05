import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import type { ReactNode } from "react";
import { DirectionProvider } from "@/components/ui/direction";
import { strings } from "@/config/strings.ar";
import { siteUrl } from "@/lib/seo";
import "./globals.css";

// next/font downloads this at build time and serves it from this site, so visitors'
// browsers never contact Google for fonts.
const arabicFont = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: strings.app.name, template: `%s | ${strings.app.name}` },
  description: strings.app.description,
  openGraph: { type: "website", locale: "ar_AR", siteName: strings.app.name, title: strings.app.name, description: strings.app.description },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#090B10",
  colorScheme: "dark",
  // Lets the bottom navigation use the safe-area insets on phones with a home indicator.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`dark ${arabicFont.variable}`}>
      <body>
        <DirectionProvider dir="rtl">{children}</DirectionProvider>
      </body>
    </html>
  );
}
