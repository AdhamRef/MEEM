"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { searchPickerAction } from "@/app/(admin)/admin/picker-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { strings } from "@/config/strings.ar";
import type { PickerItem, PickerType } from "@/features/relationships/picker.service";

const DEBOUNCE_MS = 250;

/** Search results for one type. Used alone for add-one-at-a-time lists, and inside ContentPicker. */
export function PickerSearch({
  type,
  excludeIds,
  excludeId,
  onPick,
  label,
  disabled,
}: {
  type: PickerType;
  excludeIds: string[];
  excludeId?: string;
  onPick: (item: PickerItem) => void;
  label: string;
  disabled?: boolean;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<{ forQuery: string; results: PickerItem[]; failed: boolean } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let isCurrent = true;
    const timer = setTimeout(async () => {
      const result = await searchPickerAction({ type, query, ...(excludeId ? { excludeId } : {}) });
      if (isCurrent) setState({ forQuery: query, results: result.ok ? result.data : [], failed: !result.ok });
    }, DEBOUNCE_MS);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [isOpen, query, type, excludeId]);

  const isSearching = state?.forQuery !== query;
  const visible = (state?.results ?? []).filter((item) => !excludeIds.includes(item.id));

  return (
    <div className="space-y-2" data-testid={`picker-${type}`}>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <Input
        id={inputId}
        type="search"
        value={query}
        disabled={disabled}
        placeholder={label}
        autoComplete="off"
        onFocus={() => setIsOpen(true)}
        onChange={(event) => {
          setIsOpen(true);
          setQuery(event.target.value);
        }}
      />
      {isOpen ? (
        <div className="max-h-56 overflow-y-auto rounded-lg border bg-surface-elevated" data-testid="picker-results">
          {isSearching ? (
            <p className="p-3 text-sm text-text-secondary">{strings.adminContent.picker.searching}</p>
          ) : state?.failed ? (
            <p role="alert" className="p-3 text-sm text-destructive">
              {strings.adminContent.picker.failed}
            </p>
          ) : visible.length === 0 ? (
            <p className="p-3 text-sm text-text-secondary">{type === "PLAYLIST" && !query ? strings.adminContent.picker.playlistsEmpty : strings.adminContent.picker.noResults}</p>
          ) : (
            <ul>
              {visible.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(item);
                      setQuery("");
                    }}
                    className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-start text-sm outline-none hover:bg-surface focus-visible:bg-surface focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
                  >
                    <Plus aria-hidden className="size-4 shrink-0 text-text-secondary" />
                    <span className="min-w-0 flex-1">
                      <bdi className="block truncate">{item.label}</bdi>
                      {item.hint ? <bdi className="block truncate text-xs text-text-secondary">{item.hint}</bdi> : null}
                    </span>
                    {item.isDraft ? <Badge variant="secondary">{strings.adminContent.picker.draftTag}</Badge> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

interface ContentPickerProps {
  label: string;
  hint?: string;
  type: PickerType;
  value: PickerItem[];
  onChange: (items: PickerItem[]) => void;
  excludeId?: string;
  /** Replaces the choice instead of adding to a list. */
  single?: boolean;
  disabled?: boolean;
  max?: number;
}

/** Searchable selection, so editors never need an ID or the database (§13.3). */
export function ContentPicker({ label, hint, type, value, onChange, excludeId, single, disabled, max = 50 }: ContentPickerProps) {
  const groupId = useId();
  const canAddMore = single ? value.length === 0 : value.length < max;

  return (
    <div role="group" aria-labelledby={groupId} className="space-y-2" data-testid={`content-picker-${type}`}>
      <p id={groupId} className="text-sm font-medium">
        {label}
      </p>
      {hint ? <p className="text-xs text-text-secondary">{hint}</p> : null}
      {value.length ? (
        <ul className="space-y-1.5">
          {value.map((item) => (
            <li key={item.id} className="flex items-center gap-2 rounded-lg border bg-surface-elevated ps-3 pe-1 py-1 text-sm">
              <span className="min-w-0 flex-1">
                <bdi className="block truncate">{item.label}</bdi>
                {item.hint ? <bdi className="block truncate text-xs text-text-secondary">{item.hint}</bdi> : null}
              </span>
              {item.isDraft ? <Badge variant="secondary">{strings.adminContent.picker.draftTag}</Badge> : null}
              <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={`${strings.adminContent.picker.remove}: ${item.label}`} onClick={() => onChange(value.filter((other) => other.id !== item.id))}>
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {canAddMore && !disabled ? (
        <PickerSearch type={type} label={strings.adminContent.picker.search} excludeId={excludeId} excludeIds={value.map((item) => item.id)} onPick={(item) => onChange(single ? [item] : [...value, item])} />
      ) : null}
    </div>
  );
}
