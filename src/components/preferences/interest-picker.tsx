"use client";

import {
  Anchor,
  BookOpen,
  Check,
  CircleHelp,
  Footprints,
  HandHeart,
  Heart,
  Landmark,
  Layers,
  Newspaper,
  Scale,
  ShieldCheck,
  Sparkles,
  Sunrise,
  type LucideIcon,
} from "lucide-react";
import type { CategoryIconName } from "@/features/categories/schemas";
import { cn } from "@/lib/utils";

export interface PickerCategory {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
}

const ICONS: Record<CategoryIconName, LucideIcon> = {
  anchor: Anchor,
  scale: Scale,
  "book-open": BookOpen,
  footprints: Footprints,
  landmark: Landmark,
  heart: Heart,
  "shield-check": ShieldCheck,
  "circle-help": CircleHelp,
  layers: Layers,
  sunrise: Sunrise,
  newspaper: Newspaper,
  "hand-heart": HandHeart,
};

function iconFor(name: string | null): LucideIcon {
  return (name && ICONS[name as CategoryIconName]) || Sparkles;
}

interface InterestPickerProps {
  categories: PickerCategory[];
  selectedIds: ReadonlySet<string>;
  onToggle: (categoryId: string) => void;
  label: string;
  disabled?: boolean;
}

export function InterestPicker({ categories, selectedIds, onToggle, label, disabled }: InterestPickerProps) {
  return (
    <ul aria-label={label} className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
      {categories.map((category) => {
        const Icon = iconFor(category.icon);
        const isSelected = selectedIds.has(category.id);

        return (
          <li key={category.id}>
            <button
              type="button"
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => onToggle(category.id)}
              className={cn(
                "flex size-full min-h-11 items-start gap-3 rounded-xl border p-3.5 text-start transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
                isSelected ? "border-brand bg-surface-elevated" : "bg-surface hover:bg-surface-elevated",
              )}
            >
              <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", isSelected ? "text-brand" : "text-text-secondary")} strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{category.title}</span>
                {category.description ? <span className="mt-0.5 block text-sm text-text-secondary">{category.description}</span> : null}
              </span>
              <Check aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-brand", !isSelected && "invisible")} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Adds or removes one ID, leaving the original set untouched. */
export function toggleSelection(current: ReadonlySet<string>, categoryId: string): Set<string> {
  const next = new Set(current);
  if (!next.delete(categoryId)) next.add(categoryId);
  return next;
}
