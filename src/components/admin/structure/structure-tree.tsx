"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  CornerDownLeft,
  CornerUpRight,
  EllipsisVertical,
  ExternalLink,
  GripVertical,
  Loader2,
  PencilLine,
  Plus,
  Search,
  Star,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { strings } from "@/config/strings.ar";
import type { StructureCountKey, StructureKind, StructureNode } from "@/features/structure/structure.service";
import { applyPlacement, flattenTree, getProjection, placementAfterDrop, placementForMenuMove, type FlatItem, type MenuMove, type Placement, type Projection } from "@/features/structure/tree";
import type { ActionResult } from "@/lib/http/action";
import { cn } from "@/lib/utils";

const s = strings.structure;
const INDENT = 28;
const MAX_TREE_DEPTH = 8;

type Row = FlatItem<StructureNode>;

interface StructureTreeProps {
  kind: StructureKind;
  nodes: StructureNode[];
  selectedId: string | null;
  canManage: boolean;
  isTruncated: boolean;
  onMove: (input: unknown) => Promise<ActionResult<undefined>>;
  onCreate: (input: unknown) => Promise<ActionResult<{ id: string }>>;
}

const PUBLIC_BASE: Partial<Record<StructureKind, string>> = { topics: "topics", libraries: "libraries", playlists: "playlists" };

export function editHref(kind: StructureKind, id: string): string {
  return kind === "playlists" ? `/admin/playlists/${id}` : `/admin/structure?tab=${kind}&id=${id}`;
}

function publicHref(kind: StructureKind, node: StructureNode): string | null {
  const base = PUBLIC_BASE[kind];
  if (!base || !node.slug || node.status !== "PUBLISHED" || node.isArchived) return null;
  return `/${base}/${encodeURIComponent(node.slug)}`;
}

function ancestorsOf(nodes: StructureNode[], id: string | null): Set<string> {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  const result = new Set<string>();
  let current = id ? (parentOf.get(id) ?? null) : null;
  while (current && !result.has(current)) {
    result.add(current);
    current = parentOf.get(current) ?? null;
  }
  return result;
}

function StatusDot({ node }: { node: StructureNode }) {
  const label = node.isArchived ? s.archived : node.status === "PUBLISHED" ? s.published : s.draft;
  return (
    <span
      title={label}
      className={cn("size-2 shrink-0 rounded-full", node.isArchived ? "bg-subtle/50" : node.status === "PUBLISHED" ? "bg-brand shadow-[0_0_0_3px] shadow-brand/15" : "border border-text-secondary")}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
}

const COUNT_ORDER: StructureCountKey[] = ["channels", "items", "videos", "articles", "playlists", "libraries", "resources"];

function Counts({ node }: { node: StructureNode }) {
  const shown = COUNT_ORDER.filter((key) => (node.counts[key] ?? 0) > 0).slice(0, 3);
  if (!shown.length) return null;
  return (
    <span className="hidden shrink-0 items-center gap-1 sm:flex">
      {shown.map((key) => (
        <span key={key} className="rounded-md bg-background/60 px-1.5 py-0.5 text-[11px] text-text-secondary tabular-nums">
          {node.counts[key]} {s.counts[key]}
        </span>
      ))}
    </span>
  );
}

interface RowProps {
  row: Row;
  kind: StructureKind;
  depth: number;
  isSelected: boolean;
  isCollapsed: boolean;
  canDrag: boolean;
  canManage: boolean;
  isTree: boolean;
  isBusy: boolean;
  isGhost?: boolean;
  isOverlay?: boolean;
  onToggle: () => void;
  onMenuMove: (move: MenuMove) => void;
  onAddChild: () => void;
  availableMoves: Record<MenuMove, boolean>;
}

function TreeRow({ row, kind, depth, isSelected, isCollapsed, canDrag, canManage, isTree, isBusy, isGhost, isOverlay, onToggle, onMenuMove, onAddChild, availableMoves }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } = useSortable({ id: row.id, disabled: !canDrag || isOverlay });
  const node = row.item;
  const site = publicHref(kind, node);

  return (
    <li
      ref={isOverlay ? undefined : setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, paddingInlineStart: depth * INDENT }}
      className={cn("relative list-none", isGhost && "opacity-60")}
      data-testid="structure-row"
      data-id={row.id}
      data-depth={depth}
    >
      {/* Guides show which rows share a parent. */}
      {depth > 0 && !isOverlay ? <span aria-hidden className="pointer-events-none absolute inset-y-0 border-s border-dashed border-border" style={{ insetInlineStart: depth * INDENT - INDENT / 2 }} /> : null}
      <div
        className={cn(
          "group/row flex min-h-12 items-center gap-1 rounded-xl border border-transparent pe-1 transition-colors",
          isSelected ? "border-brand/40 bg-brand/10" : "hover:bg-surface-elevated",
          isGhost && "border-dashed border-brand/60 bg-brand/5",
          isOverlay && "border-brand/50 bg-surface-elevated shadow-2xl shadow-black/50 ring-1 ring-brand/30",
        )}
      >
        {canDrag ? (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={s.dragHandle(node.title)}
            className="flex size-10 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-subtle outline-none hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
            data-testid="structure-drag"
          >
            <GripVertical aria-hidden className="size-4" />
          </button>
        ) : (
          <span className="w-2 shrink-0" />
        )}

        {isTree ? (
          row.childCount > 0 ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? s.expand(node.title) : s.collapse(node.title)}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-text-secondary outline-none hover:bg-background/60 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ChevronDown aria-hidden className={cn("size-4 transition-transform", isCollapsed && "-rotate-90 rtl:rotate-90")} />
            </button>
          ) : (
            <span className="size-8 shrink-0" />
          )
        ) : null}

        <Link
          href={editHref(kind, node.id)}
          scroll={false}
          aria-current={isSelected ? "true" : undefined}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          data-testid="structure-open"
        >
          <StatusDot node={node} />
          <bdi className={cn("truncate text-sm", isSelected ? "font-semibold text-text-primary" : "font-medium", node.isArchived && "text-subtle line-through decoration-subtle/50")}>{node.title}</bdi>
          {node.isFeatured ? <Star aria-label={s.featured} className="size-3.5 shrink-0 fill-current text-brand" /> : null}
          {row.childCount > 0 && isCollapsed ? (
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              {s.childCount(row.childCount)}
            </Badge>
          ) : null}
          {node.status === "DRAFT" && !node.isArchived ? (
            <Badge variant="outline" className="shrink-0">
              {s.draft}
            </Badge>
          ) : null}
        </Link>

        <Counts node={node} />

        {!isOverlay ? (
          <DropdownMenu dir="rtl" modal={false}>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" className="shrink-0 opacity-70 group-hover/row:opacity-100" aria-label={s.rowMenu(node.title)} data-testid="structure-menu">
                <EllipsisVertical aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuItem asChild>
                <Link href={editHref(kind, node.id)} scroll={false}>
                  <PencilLine aria-hidden />
                  {s.open}
                </Link>
              </DropdownMenuItem>
              {site ? (
                <DropdownMenuItem asChild>
                  <Link href={site} target="_blank">
                    <ExternalLink aria-hidden />
                    {s.viewOnSite}
                  </Link>
                </DropdownMenuItem>
              ) : null}
              {canManage ? (
                <>
                  <DropdownMenuSeparator />
                  {isTree ? (
                    <DropdownMenuItem disabled={isBusy} onSelect={onAddChild} data-testid="structure-add-child">
                      <Plus aria-hidden />
                      {s.addChild}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem disabled={isBusy || !availableMoves.up} onSelect={() => onMenuMove("up")} data-testid="structure-move-up">
                    <ArrowUp aria-hidden />
                    {s.moveUp}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isBusy || !availableMoves.down} onSelect={() => onMenuMove("down")} data-testid="structure-move-down">
                    <ArrowDown aria-hidden />
                    {s.moveDown}
                  </DropdownMenuItem>
                  {isTree ? (
                    <>
                      <DropdownMenuItem disabled={isBusy || !availableMoves.indent} onSelect={() => onMenuMove("indent")} data-testid="structure-indent">
                        <CornerDownLeft aria-hidden className="rtl:-scale-x-100" />
                        {s.indent}
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={isBusy || !availableMoves.outdent} onSelect={() => onMenuMove("outdent")} data-testid="structure-outdent">
                        <CornerUpRight aria-hidden className="rtl:-scale-x-100" />
                        {s.outdent}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  );
}

function CreateRow({ depth, isBusy, onSubmit, onCancel }: { depth: number; isBusy: boolean; onSubmit: (title: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  };
  return (
    <li className="list-none py-1" style={{ paddingInlineStart: depth * INDENT }}>
      <form onSubmit={submit} className="flex items-center gap-2 rounded-xl border border-brand/40 bg-brand/5 p-1.5">
        <Input
          autoFocus
          value={value}
          dir="auto"
          maxLength={120}
          disabled={isBusy}
          aria-label={s.newName}
          placeholder={s.newPlaceholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel();
          }}
          className="h-10 flex-1 border-0 bg-transparent"
          data-testid="structure-new-name"
        />
        <Button type="submit" size="sm" disabled={isBusy || !value.trim()} data-testid="structure-create">
          {isBusy ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {isBusy ? s.creating : s.create}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={isBusy}>
          {strings.adminContent.cancel}
        </Button>
      </form>
    </li>
  );
}

/**
 * The arranging screen. Each drop saves at once, and the screen shows the new order before the
 * server answers. If the server refuses, the order snaps back and says why.
 */
export function StructureTree({ kind, nodes, selectedId, canManage, isTruncated, onMove, onCreate }: StructureTreeProps) {
  const router = useRouter();
  const dndId = useId();
  const isTree = kind === "topics" || kind === "libraries";
  const maxDepth = isTree ? MAX_TREE_DEPTH : 0;

  const [items, setItems] = useState(nodes);
  const [sourceNodes, setSourceNodes] = useState(nodes);
  // A fresh server render replaces the local copy, as React recommends for derived state.
  if (nodes !== sourceNodes) {
    setSourceNodes(nodes);
    setItems(nodes);
  }

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [creatingUnder, setCreatingUnder] = useState<string | null | undefined>(undefined);
  const directionSign = useRef(1);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // The selected item's parents stay open, so it can always be seen.
  const openForSelection = useMemo(() => ancestorsOf(items, selectedId), [items, selectedId]);
  const effectiveCollapsed = useMemo(() => {
    const next = new Set(collapsed);
    for (const id of openForSelection) next.delete(id);
    return next;
  }, [collapsed, openForSelection]);

  const normalizedQuery = query.trim().toLowerCase();
  const flat = useMemo(() => {
    if (!normalizedQuery) return flattenTree(items, effectiveCollapsed, activeId ?? undefined);
    const all = flattenTree(items);
    const matches = new Set(all.filter((row) => row.item.title.toLowerCase().includes(normalizedQuery)).map((row) => row.id));
    const keep = new Set(matches);
    for (const id of matches) for (const ancestor of ancestorsOf(items, id)) keep.add(ancestor);
    return all.filter((row) => keep.has(row.id));
  }, [items, effectiveCollapsed, activeId, normalizedQuery]);

  const canDrag = canManage && !normalizedQuery && !isBusy;
  const projection: Projection | null = activeId && overId ? getProjection(flat, activeId, overId, offset, INDENT, maxDepth) : null;
  const activeRow = activeId ? flat.find((row) => row.id === activeId) : undefined;

  const save = async (id: string, placement: Placement) => {
    const before = items;
    setItems(applyPlacement(items, id, placement));
    setIsBusy(true);
    setMessage({ text: s.saving, isError: false });
    const result = await onMove({ kind, id, parentId: placement.parentId, orderedIds: placement.orderedIds });
    setIsBusy(false);
    if (!result.ok) {
      setItems(before);
      setMessage({ text: result.message, isError: true });
    } else {
      setMessage({ text: s.savedOrder, isError: false });
    }
    router.refresh();
  };

  const resetDrag = () => {
    setActiveId(null);
    setOverId(null);
    setOffset(0);
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    directionSign.current = document.documentElement.dir === "rtl" ? -1 : 1;
    setActiveId(String(active.id));
    setOverId(String(active.id));
    setMessage(null);
    if (typeof document !== "undefined") document.body.style.setProperty("cursor", "grabbing");
  };
  const onDragMove = ({ delta }: DragMoveEvent) => setOffset(delta.x * directionSign.current);
  const onDragOver = ({ over }: DragOverEvent) => setOverId(over ? String(over.id) : null);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    document.body.style.removeProperty("cursor");
    const id = String(active.id);
    const finalProjection = over ? getProjection(flat, id, String(over.id), offset, INDENT, maxDepth) : null;
    const placement = over && finalProjection ? placementAfterDrop(items, flat, id, String(over.id), finalProjection) : null;
    resetDrag();
    if (!placement) return;
    const current = items.find((item) => item.id === id);
    const before = flattenTree(items).filter((row) => row.parentId === (current?.parentId ?? null)).map((row) => row.id);
    if ((current?.parentId ?? null) === placement.parentId && before.join() === placement.orderedIds.join()) return;
    if (placement.parentId) setCollapsed((previous) => new Set([...previous].filter((collapsedId) => collapsedId !== placement.parentId)));
    void save(id, placement);
  };

  const menuMove = (id: string, move: MenuMove) => {
    const placement = placementForMenuMove(items, id, move);
    if (placement) void save(id, placement);
  };

  const create = async (title: string) => {
    const parentId = creatingUnder ?? null;
    setIsBusy(true);
    const result = await onCreate({ kind, title, parentId });
    setIsBusy(false);
    if (!result.ok) {
      setMessage({ text: result.message, isError: true });
      return;
    }
    setCreatingUnder(undefined);
    if (parentId) setCollapsed((previous) => new Set([...previous].filter((collapsedId) => collapsedId !== parentId)));
    router.push(editHref(kind, result.data.id), { scroll: false });
    router.refresh();
  };

  const parentIds = useMemo(() => new Set(items.map((item) => item.parentId).filter((id): id is string => Boolean(id))), [items]);
  const allCollapsed = parentIds.size > 0 && [...parentIds].every((id) => collapsed.has(id));

  const rowFor = (row: Row) => {
    const isActive = row.id === activeId;
    return (
      <TreeRow
        key={row.id}
        row={row}
        kind={kind}
        depth={isActive && projection ? projection.depth : row.depth}
        isSelected={row.id === selectedId}
        isCollapsed={effectiveCollapsed.has(row.id) && !normalizedQuery}
        canDrag={canDrag}
        canManage={canManage}
        isTree={isTree}
        isBusy={isBusy}
        isGhost={isActive}
        onToggle={() =>
          setCollapsed((previous) => {
            const next = new Set(previous);
            if (next.has(row.id)) next.delete(row.id);
            else next.add(row.id);
            return next;
          })
        }
        onMenuMove={(move) => menuMove(row.id, move)}
        onAddChild={() => setCreatingUnder(row.id)}
        availableMoves={{
          up: Boolean(placementForMenuMove(items, row.id, "up")),
          down: Boolean(placementForMenuMove(items, row.id, "down")),
          indent: isTree && Boolean(placementForMenuMove(items, row.id, "indent")),
          outdent: isTree && Boolean(placementForMenuMove(items, row.id, "outdent")),
        }}
      />
    );
  };

  return (
    <div className="flex min-h-0 flex-col gap-3" data-testid="structure-tree" data-kind={kind}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search aria-hidden className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-subtle" />
          <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={s.filter} aria-label={s.filter} className="ps-9" data-testid="structure-filter" />
        </div>
        {isTree && parentIds.size > 0 ? (
          <Button type="button" variant="ghost" size="icon" aria-label={allCollapsed ? s.expandAll : s.collapseAll} title={allCollapsed ? s.expandAll : s.collapseAll} onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(parentIds))}>
            {allCollapsed ? <ChevronsUpDown aria-hidden /> : <ChevronsDownUp aria-hidden />}
          </Button>
        ) : null}
        {canManage ? (
          kind === "playlists" ? (
            <Button asChild>
              <Link href="/admin/playlists/new">
                <Plus aria-hidden data-icon="inline-start" />
                {s.addRoot[kind]}
              </Link>
            </Button>
          ) : (
            <Button type="button" onClick={() => setCreatingUnder(null)} disabled={isBusy} data-testid="structure-add-root">
              <Plus aria-hidden data-icon="inline-start" />
              {s.addRoot[kind]}
            </Button>
          )
        ) : null}
      </div>

      <p className="flex items-center gap-2 text-xs text-subtle">{normalizedQuery ? s.filterHint : canManage ? s.legend : s.readOnly}</p>

      <div aria-live="polite" className="min-h-5 text-sm">
        {message ? (
          <span role={message.isError ? "alert" : "status"} className={cn("inline-flex items-center gap-1.5", message.isError ? "text-destructive" : "text-text-secondary")} data-testid="structure-message">
            {isBusy ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : null}
            {message.text}
          </span>
        ) : null}
      </div>

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          document.body.style.removeProperty("cursor");
          resetDrag();
        }}
      >
        <SortableContext items={flat.map((row) => row.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-0.5" aria-label={s.tabs[kind]}>
            {creatingUnder === null ? <CreateRow depth={0} isBusy={isBusy} onSubmit={(title) => void create(title)} onCancel={() => setCreatingUnder(undefined)} /> : null}
            {flat.map((row) => (
              <Fragment key={row.id}>
                {rowFor(row)}
                {creatingUnder === row.id ? <CreateRow depth={row.depth + 1} isBusy={isBusy} onSubmit={(title) => void create(title)} onCancel={() => setCreatingUnder(undefined)} /> : null}
              </Fragment>
            ))}
          </ul>
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {activeRow ? (
            <ul className="m-0 p-0">
              <TreeRow
                row={activeRow}
                kind={kind}
                depth={0}
                isSelected={false}
                isCollapsed
                canDrag
                canManage={false}
                isTree={isTree}
                isBusy={false}
                isOverlay
                onToggle={() => undefined}
                onMenuMove={() => undefined}
                onAddChild={() => undefined}
                availableMoves={{ up: false, down: false, indent: false, outdent: false }}
              />
            </ul>
          ) : null}
        </DragOverlay>
      </DndContext>

      {!flat.length && creatingUnder === undefined ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-text-secondary" data-testid="structure-empty">
          {normalizedQuery ? s.noMatches : s.empty}
        </p>
      ) : null}
      {isTruncated ? <p className="text-xs text-subtle">{s.truncated(items.length)}</p> : null}
    </div>
  );
}

