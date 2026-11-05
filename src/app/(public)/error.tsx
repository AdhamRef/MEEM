"use client";

import { ErrorMessage } from "@/components/shared/error-message";

export default function PublicError({ retry }: { retry: () => void }) {
  return <ErrorMessage onRetry={retry} />;
}
