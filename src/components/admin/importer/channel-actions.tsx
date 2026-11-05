"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setChannelActiveAction } from "@/app/(admin)/admin/channels/actions";
import { startChannelSyncAction } from "@/app/(admin)/admin/youtube-importer/actions";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";

const t = strings.importer;

/** A sync only runs when someone presses this. There's no background polling (§7.4). */
export function ChannelActions({ channelId, isActive, canSync }: { channelId: string; isActive: boolean; canSync: boolean }) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sync = async () => {
    setIsBusy(true);
    setError(null);
    const result = await startChannelSyncAction(channelId);
    if (result.ok) {
      router.push(`/admin/youtube-importer/${result.data.jobId}`);
      return;
    }
    setError(result.message);
    setIsBusy(false);
  };

  const toggle = async () => {
    setIsBusy(true);
    setError(null);
    const result = await setChannelActiveAction(channelId, !isActive);
    if (!result.ok) setError(result.message);
    setIsBusy(false);
    router.refresh();
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button type="button" variant="secondary" disabled={isBusy || !canSync} onClick={sync} data-testid="channel-sync">
        <RefreshCw aria-hidden data-icon="inline-start" />
        {t.syncChannel}
      </Button>
      <Button type="button" variant="ghost" disabled={isBusy} onClick={toggle} data-testid="channel-toggle">
        {isActive ? t.deactivateChannel : t.activateChannel}
      </Button>
      {error ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
