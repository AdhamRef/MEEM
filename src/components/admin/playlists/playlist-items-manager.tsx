"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { PickerSearch } from "@/components/admin/content/content-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { strings } from "@/config/strings.ar";
import { moveItem } from "@/features/playlists/rules";
import type { ActionResult } from "@/lib/http/action";

const p = strings.playlists;

export interface ManagedItem {
  videoId: string;
  title: string;
  hint: string;
  note: string | null;
  isDraft: boolean;
  isUnavailable: boolean;
}

function ItemBadges({ item }: { item: ManagedItem }) {
  return (
    <>
      {item.isUnavailable ? <Badge variant="destructive">{p.itemUnavailable}</Badge> : null}
      {item.isDraft ? <Badge variant="secondary">{strings.adminContent.picker.draftTag}</Badge> : null}
    </>
  );
}

function SortableRow({
  item,
  index,
  total,
  isBusy,
  canEdit,
  onMove,
  onRemove,
  onNoteSaved,
}: {
  item: ManagedItem;
  index: number;
  total: number;
  isBusy: boolean;
  canEdit: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
  onNoteSaved: (note: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.videoId, disabled: !canEdit || isBusy });
  const [note, setNote] = useState(item.note ?? "");

  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={`space-y-2 rounded-lg border bg-surface-elevated p-2 ${isDragging ? "relative z-10 opacity-90" : ""}`} data-testid="managed-item">
      <div className="flex items-center gap-1">
        {canEdit ? (
          <button type="button" {...attributes} {...listeners} aria-label={`${p.dragHandle}: ${item.title}`} className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50" data-testid="drag-handle">
            <GripVertical aria-hidden className="size-4 text-text-secondary" />
          </button>
        ) : null}
        <span className="w-6 shrink-0 text-center text-xs text-text-secondary tabular-nums">{index + 1}</span>
        <span className="min-w-0 flex-1">
          <bdi className="block truncate text-sm" data-testid="managed-title">
            {item.title || p.itemWithdrawn}
          </bdi>
          <bdi className="block truncate text-xs text-text-secondary">{item.hint}</bdi>
        </span>
        <ItemBadges item={item} />
        {canEdit ? (
          <>
            <Button type="button" variant="ghost" size="icon" disabled={isBusy || index === 0} aria-label={`${p.moveUp}: ${item.title}`} onClick={() => onMove(index, index - 1)} data-testid="move-up">
              <ArrowUp aria-hidden />
            </Button>
            <Button type="button" variant="ghost" size="icon" disabled={isBusy || index === total - 1} aria-label={`${p.moveDown}: ${item.title}`} onClick={() => onMove(index, index + 1)} data-testid="move-down">
              <ArrowDown aria-hidden />
            </Button>
            <Button type="button" variant="ghost" size="icon" disabled={isBusy} aria-label={`${strings.adminContent.removeLink}: ${item.title}`} onClick={onRemove} data-testid="remove-item">
              <X aria-hidden />
            </Button>
          </>
        ) : null}
      </div>
      {canEdit ? (
        <Input
          value={note}
          dir="auto"
          maxLength={500}
          disabled={isBusy}
          placeholder={p.itemNote}
          aria-label={`${p.itemNote}: ${item.title}`}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => {
            if (note.trim() !== (item.note ?? "")) onNoteSaved(note.trim());
          }}
          data-testid="item-note"
        />
      ) : null}
    </li>
  );
}

interface ManagerProps {
  items: ManagedItem[];
  canEdit: boolean;
  onAdd: (videoId: string) => Promise<ActionResult<undefined>>;
  onRemove: (videoId: string) => Promise<ActionResult<undefined>>;
  onReorder: (videoIds: string[]) => Promise<ActionResult<undefined>>;
  onNote: (videoId: string, note: string | null) => Promise<ActionResult<undefined>>;
}

/** Each change saves at once. Dragging works by mouse, touch, and keyboard, and the arrows need no dragging at all. */
export function PlaylistItemsManager({ items: initialItems, canEdit, onAdd, onRemove, onReorder, onNote }: ManagerProps) {
  const router = useRouter();
  const dndId = useId();
  const [items, setItems] = useState(initialItems);
  const [syncedWith, setSyncedWith] = useState(initialItems);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Takes on what the server sends after a refresh, such as a video that was just added.
  if (syncedWith !== initialItems) {
    setSyncedWith(initialItems);
    setItems(initialItems);
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const titleOf = (id: unknown) => items.find((item) => item.videoId === id)?.title ?? "";
  const positionOf = (id: unknown) => items.findIndex((item) => item.videoId === id) + 1;
  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) => p.announcePicked(titleOf(active.id)),
      onDragOver: ({ over }) => (over ? p.announceOver(positionOf(over.id)) : undefined),
      onDragEnd: ({ over }) => (over ? p.announceDropped(positionOf(over.id)) : undefined),
      onDragCancel: () => p.announceCancelled,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Read at announcement time, and only titles and order matter.
    [items],
  );

  const run = async (work: () => Promise<ActionResult<undefined>>, options: { onFailure?: () => void; refresh?: boolean } = {}) => {
    setIsBusy(true);
    setError(null);
    setStatus(null);
    const result = await work();
    setIsBusy(false);
    if (!result.ok) {
      setError(result.message);
      options.onFailure?.();
      return;
    }
    setStatus(strings.adminContent.saved);
    if (options.refresh) router.refresh();
  };

  const applyOrder = (next: ManagedItem[]) => {
    const previous = items;
    setItems(next);
    void run(() => onReorder(next.map((item) => item.videoId)), { onFailure: () => setItems(previous) });
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((item) => item.videoId === active.id);
    const to = items.findIndex((item) => item.videoId === over.id);
    applyOrder(moveItem(items, from, to));
  };

  return (
    <section aria-labelledby="playlist-items-title" className="space-y-3 rounded-xl border bg-surface p-4" data-testid="playlist-items-manager">
      <div>
        <h2 id="playlist-items-title" className="font-semibold">
          {p.itemsTitle}
        </h2>
        <p className="text-xs text-text-secondary">{canEdit ? p.itemsHint : p.itemsFromYouTube}</p>
      </div>

      {items.length === 0 ? <p className="text-sm text-text-secondary">{p.noItems}</p> : null}

      <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} accessibility={{ announcements, screenReaderInstructions: { draggable: p.dragInstructions } }}>
        <SortableContext items={items.map((item) => item.videoId)} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2" data-testid="managed-items">
            {items.map((item, index) => (
              <SortableRow
                key={item.videoId}
                item={item}
                index={index}
                total={items.length}
                isBusy={isBusy}
                canEdit={canEdit}
                onMove={(from, to) => applyOrder(moveItem(items, from, to))}
                onRemove={() => run(() => onRemove(item.videoId), { refresh: true })}
                onNoteSaved={(note) => run(() => onNote(item.videoId, note || null))}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      {canEdit ? <PickerSearch type="VIDEO" label={p.addVideo} excludeIds={items.map((item) => item.videoId)} disabled={isBusy} onPick={(item) => run(() => onAdd(item.id), { refresh: true })} /> : null}

      <p role={error ? "alert" : "status"} className={error ? "text-sm text-destructive" : status ? "text-sm text-text-secondary" : "sr-only"} data-testid="items-message">
        {error ?? status}
      </p>
    </section>
  );
}
