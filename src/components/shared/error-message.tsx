"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";

/** Shown by error boundaries. It never displays the error itself, which could leak internals. */
export function ErrorMessage({ onRetry }: { onRetry: () => void }) {
  return (
    <StateMessage
      icon={TriangleAlert}
      role="alert"
      headingLevel="h1"
      title={strings.states.errorTitle}
      description={strings.states.errorDescription}
      action={
        <Button onClick={onRetry}>
          <RotateCw aria-hidden data-icon="inline-start" />
          {strings.states.retry}
        </Button>
      }
    />
  );
}
