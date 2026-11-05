"use client";

import { useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { SaveButton, ShareButton } from "@/components/video/video-actions";

interface ContentActionsProps {
  entityType: "ARTICLE" | "TOPIC" | "PLAYLIST";
  entityId: string;
  path: string;
  title: string;
  testId?: string;
}

/** Save and share. The page stays static for guests, and only this part asks about the account. */
export function ContentActions({ entityType, entityId, path, title, testId = "content-actions" }: ContentActionsProps) {
  const { status } = useSession();
  const [isSaved, setIsSaved] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // A check that was already on its way must not undo what the person just pressed.
  const hasToggled = useRef(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch(`/api/favorites?type=${entityType}&ids=${entityId}`)
      .then((response) => (response.ok ? (response.json() as Promise<{ savedIds: string[] }>) : { savedIds: [] }))
      .then(({ savedIds }) => {
        if (!hasToggled.current) setIsSaved(savedIds.includes(entityId));
      })
      .catch(() => {
        // Shown as not saved. Saving again is harmless.
      });
  }, [status, entityType, entityId]);

  return (
    <div className="flex flex-wrap items-center gap-1" data-testid={testId}>
      <SaveButton
        content={{ entityType, entityId }}
        isSaved={isSaved}
        callbackPath={path}
        onChange={(next) => {
          hasToggled.current = true;
          setIsSaved(next);
        }}
        onFailure={setNotice}
      />
      <ShareButton path={path} title={title} onResult={setNotice} />
      <span role="status" className={notice ? "text-sm text-text-secondary" : "sr-only"}>
        {notice}
      </span>
    </div>
  );
}
