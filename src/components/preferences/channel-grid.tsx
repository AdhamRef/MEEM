"use client";

import { Check, Plus } from "lucide-react";
import { strings } from "@/config/strings.ar";
import { isChannelOn, isOnByDefault, withChannelSwitched, type ChannelChoices } from "@/features/preferences/channel-choices";
import type { CatalogueChannel, CatalogueTopic } from "@/features/topics/catalogue.service";
import { cn } from "@/lib/utils";
import { ChannelAvatar } from "./channel-avatar";

const s = strings.interests;

function ChannelCard({ channel, isOn, topicTitles, onToggle, disabled }: { channel: CatalogueChannel; isOn: boolean; topicTitles: string[]; onToggle: () => void; disabled?: boolean }) {
  return (
    <li>
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label={channel.title}
        disabled={disabled}
        onClick={onToggle}
        data-testid="channel-card"
        className={cn(
          "group relative flex size-full flex-col items-center gap-2 rounded-3xl border p-4 pt-5 text-center outline-none transition-all duration-200 focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] disabled:opacity-60",
          isOn ? "border-brand bg-surface-elevated" : "border-border bg-surface hover:bg-surface-elevated",
        )}
      >
        <span className="relative">
          <span className={cn("block size-20 overflow-hidden rounded-full transition-all duration-300 sm:size-24", isOn ? "ring-3 ring-brand ring-offset-3 ring-offset-surface-elevated" : "opacity-55 grayscale group-hover:opacity-80")}>
            <ChannelAvatar title={channel.title} thumbnailUrl={channel.thumbnailUrl} className="size-full" />
          </span>
          <span className={cn("absolute -end-1 -bottom-1 flex size-7 items-center justify-center rounded-full border-2 transition-colors", isOn ? "border-surface-elevated bg-brand text-primary-foreground" : "border-surface bg-surface-elevated text-text-secondary")}>
            {isOn ? <Check aria-hidden className="size-3.5 motion-safe:animate-in motion-safe:zoom-in-50" strokeWidth={3} /> : <Plus aria-hidden className="size-3.5" strokeWidth={3} />}
          </span>
        </span>

        <bdi dir="auto" className="mt-1 line-clamp-2 block font-medium leading-snug">
          {channel.title}
        </bdi>
        {topicTitles.length ? <span className="line-clamp-1 block text-xs text-text-secondary">{topicTitles.slice(0, 2).join("، ")}</span> : null}
        <span className="mt-auto block text-xs text-text-secondary">
          {s.channelVideoCount(channel.videoCount)} · {strings.feed.source}
        </span>
      </button>
    </li>
  );
}

function ChannelSection({ title, channels, render, onSetAll, disabled, testId }: { title: string; channels: CatalogueChannel[]; render: (channel: CatalogueChannel) => { isOn: boolean; node: React.ReactNode }; onSetAll: (isOn: boolean) => void; disabled?: boolean; testId: string }) {
  if (channels.length === 0) return null;
  const rendered = channels.map(render);
  const allOn = rendered.every((item) => item.isOn);

  return (
    <section data-testid={testId} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{title}</h3>
        <button type="button" disabled={disabled} onClick={() => onSetAll(!allOn)} data-testid={`${testId}-all`} className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-brand underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
          {allOn ? s.turnAllOff : s.turnAllOn}
        </button>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{rendered.map((item) => item.node)}</ul>
    </section>
  );
}

interface ChannelGridProps {
  channels: CatalogueChannel[];
  topics: CatalogueTopic[];
  selectedTopicIds: ReadonlySet<string>;
  choices: ChannelChoices;
  onChange: (next: Record<string, boolean>) => void;
  disabled?: boolean;
}

/**
 * Channels are grouped by whether their topics were chosen, not by their current switch, so a card
 * stays where it is when pressed. The on and off states differ by icon and ring as well as colour.
 */
export function ChannelGrid({ channels, topics, selectedTopicIds, choices, onChange, disabled }: ChannelGridProps) {
  const topicTitle = new Map(topics.map((topic) => [topic.id, topic.title]));
  const hasSelection = selectedTopicIds.size > 0;
  const matching = hasSelection ? channels.filter((channel) => channel.topicIds.some((id) => selectedTopicIds.has(id))) : channels;
  const others = hasSelection ? channels.filter((channel) => !channel.topicIds.some((id) => selectedTopicIds.has(id))) : [];

  const renderCard = (channel: CatalogueChannel) => {
    const isOn = isChannelOn(channel.id, channel.topicIds, selectedTopicIds, choices);
    const onByDefault = isOnByDefault(channel.topicIds, selectedTopicIds);
    return {
      isOn,
      node: (
        <ChannelCard
          key={channel.id}
          channel={channel}
          isOn={isOn}
          disabled={disabled}
          topicTitles={channel.topicIds.flatMap((id) => topicTitle.get(id) ?? [])}
          onToggle={() => onChange(withChannelSwitched(choices, channel.id, !isOn, onByDefault))}
        />
      ),
    };
  };

  const setAll = (group: CatalogueChannel[], isOn: boolean) => {
    let next: Record<string, boolean> = { ...choices };
    for (const channel of group) next = withChannelSwitched(next, channel.id, isOn, isOnByDefault(channel.topicIds, selectedTopicIds));
    onChange(next);
  };

  return (
    <div className="space-y-8" data-testid="channel-grid">
      <ChannelSection title={hasSelection ? s.matchingChannels : s.allChannels} channels={matching} render={renderCard} onSetAll={(isOn) => setAll(matching, isOn)} disabled={disabled} testId="channels-matching" />
      <ChannelSection title={s.otherChannels} channels={others} render={renderCard} onSetAll={(isOn) => setAll(others, isOn)} disabled={disabled} testId="channels-other" />
    </div>
  );
}

export function countChannelsOn(channels: CatalogueChannel[], selectedTopicIds: ReadonlySet<string>, choices: ChannelChoices): number {
  return channels.filter((channel) => isChannelOn(channel.id, channel.topicIds, selectedTopicIds, choices)).length;
}
