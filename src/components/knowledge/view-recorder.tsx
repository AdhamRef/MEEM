"use client";

import { useSession } from "next-auth/react";
import { useEffect } from "react";

type ViewableType = "VIDEO" | "ARTICLE" | "TOPIC" | "LIBRARY" | "PLAYLIST" | "RESOURCE";

/** A lost view only leaves a gap in someone's history, so failures are ignored. */
export function sendView(entityType: ViewableType, entityId: string): void {
  void fetch("/api/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityType, entityId }),
    keepalive: true,
  }).catch(() => {});
}

/** Guests have no history, and nothing is sent for them. Public pages stay static this way. */
export function useRecordView(entityType: ViewableType, entityId: string): void {
  const { status } = useSession();
  useEffect(() => {
    if (status === "authenticated") sendView(entityType, entityId);
  }, [status, entityType, entityId]);
}

export function ViewRecorder({ entityType, entityId }: { entityType: ViewableType; entityId: string }) {
  useRecordView(entityType, entityId);
  return null;
}
