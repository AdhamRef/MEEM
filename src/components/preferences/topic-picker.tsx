/* eslint-disable @next/next/no-img-element -- Covers come from this site's uploads, and channel images from YouTube. */
"use client";

import { Check } from "lucide-react";
import type { CatalogueChannel, CatalogueTopic } from "@/features/topics/catalogue.service";
import { cn } from "@/lib/utils";
import { ChannelAvatar } from "./channel-avatar";

/** Uneven heights give the tiles their pinboard feel, and repeat predictably so nothing jumps. */
const TILE_HEIGHTS = ["h-44", "h-60", "h-52", "h-48", "h-64", "h-40"];
const MOSAIC_LIMIT = 4;

/** The art for a topic with no cover of its own: the faces of the channels that make it up. */
function TopicMosaic({ channels }: { channels: CatalogueChannel[] }) {
  const shown = channels.slice(0, MOSAIC_LIMIT);
  return (
    <span className={cn("grid size-full", shown.length > 1 && "grid-cols-2", shown.length > 2 && "grid-rows-2")}>
      {shown.map((channel, index) => (
        <ChannelAvatar key={channel.id} title={channel.title} thumbnailUrl={channel.thumbnailUrl} className={cn("size-full min-h-0", shown.length === 3 && index === 0 && "row-span-2")} />
      ))}
    </span>
  );
}

interface TopicPickerProps {
  topics: CatalogueTopic[];
  channels: CatalogueChannel[];
  selectedIds: ReadonlySet<string>;
  onToggle: (topicId: string) => void;
  label: string;
  disabled?: boolean;
}

export function TopicPicker({ topics, channels, selectedIds, onToggle, label, disabled }: TopicPickerProps) {
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));

  return (
    <ul aria-label={label} className="columns-2 gap-3 md:columns-3 lg:columns-4" data-testid="topic-picker">
      {topics.map((topic, index) => {
        const isSelected = selectedIds.has(topic.id);
        const topicChannels = topic.channelIds.flatMap((id) => channelById.get(id) ?? []);

        return (
          <li key={topic.id} className="mb-3 break-inside-avoid">
            <button
              type="button"
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => onToggle(topic.id)}
              data-testid="topic-tile"
              className={cn(
                "group relative block w-full overflow-hidden rounded-3xl bg-surface text-start outline-none transition-[transform,box-shadow] duration-200 focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] disabled:opacity-60",
                TILE_HEIGHTS[index % TILE_HEIGHTS.length],
                isSelected && "ring-3 ring-brand ring-offset-2 ring-offset-background",
              )}
            >
              <span className={cn("absolute inset-0 block transition-transform duration-500 motion-safe:group-hover:scale-105", isSelected && "motion-safe:scale-105")}>
                {topic.coverImage ? <img src={topic.coverImage} alt="" loading="lazy" decoding="async" className="size-full object-cover" /> : <TopicMosaic channels={topicChannels} />}
              </span>
              <span aria-hidden className="absolute inset-0 bg-linear-to-t from-black/90 via-black/35 to-black/5" />

              <span className={cn("absolute end-3 top-3 flex size-8 items-center justify-center rounded-full border-2 transition-colors", isSelected ? "border-transparent bg-brand text-primary-foreground" : "border-white/70 bg-black/30")}>
                {isSelected ? <Check aria-hidden className="size-4 motion-safe:animate-in motion-safe:zoom-in-50" strokeWidth={3} /> : null}
              </span>

              <span className="absolute inset-x-0 bottom-0 block p-3.5 text-white">
                <span className="block text-lg leading-snug font-semibold">{topic.title}</span>
                {topic.introduction ? <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-white/80">{topic.introduction}</span> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Adds or removes one ID, leaving the original set untouched. */
export function toggleSelection(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current);
  if (!next.delete(id)) next.add(id);
  return next;
}
