"use client";

import { ErrorMessage } from "@/components/shared/error-message";
import "./globals.css";

/** Replaces the root layout when that layout itself fails, so it must render its own document. */
export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="ar" dir="rtl" className="dark">
      <body className="flex min-h-dvh flex-col">
        <ErrorMessage onRetry={retry} />
      </body>
    </html>
  );
}
