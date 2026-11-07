"use client";

import { Tags } from "lucide-react";
import { useState } from "react";
import { LinkSection } from "@/components/admin/content/links-manager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";

const t = strings.importer;

/**
 * A channel's topics. Every video of the channel follows them, so this is the one place video
 * topics are decided. The list loads only when opened, so a page of channels makes no extra requests.
 */
export function ChannelTopics({ channelId, topicTitles, canManage }: { channelId: string; topicTitles: string[]; canManage: boolean }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="w-full space-y-2" data-testid="channel-topics">
      <div className="flex flex-wrap items-center gap-1.5">
        {topicTitles.length ? (
          topicTitles.map((title) => (
            <Badge key={title} variant="secondary">
              {title}
            </Badge>
          ))
        ) : (
          <Badge variant="outline">{t.channelNoTopics}</Badge>
        )}
        {canManage ? (
          <Button type="button" variant="ghost" size="sm" aria-expanded={isOpen} onClick={() => setIsOpen((current) => !current)} data-testid="channel-topics-toggle">
            <Tags aria-hidden data-icon="inline-start" />
            {t.channelEditTopics}
          </Button>
        ) : null}
      </div>
      {isOpen ? <LinkSection ownerId={channelId} config={{ kind: "channel.topic", targetType: "TOPIC", canManage }} /> : null}
    </div>
  );
}
