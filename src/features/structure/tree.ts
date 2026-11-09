/**
 * Pure tree helpers for the content structure workspace. The drag-and-drop screen and the
 * structure service both use them, so the rules for where a dragged item lands live in one place.
 */

export interface TreeItem {
  id: string;
  parentId: string | null;
  order: number;
}

export interface FlatItem<Item extends TreeItem> {
  id: string;
  item: Item;
  parentId: string | null;
  depth: number;
  childCount: number;
}

export interface Placement {
  parentId: string | null;
  /** Every sibling under the new parent, the moved item included, in their new order. */
  orderedIds: string[];
}

export type MenuMove = "up" | "down" | "indent" | "outdent";

const byOrder = (a: TreeItem, b: TreeItem) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Children by parent. An item whose parent isn't in the list is treated as top-level, so nothing is lost. */
export function groupChildren<Item extends TreeItem>(items: Item[]): Map<string | null, Item[]> {
  const ids = new Set(items.map((item) => item.id));
  const groups = new Map<string | null, Item[]>();
  for (const item of items) {
    const parentId = item.parentId && ids.has(item.parentId) && item.parentId !== item.id ? item.parentId : null;
    const group = groups.get(parentId) ?? [];
    group.push(item);
    groups.set(parentId, group);
  }
  for (const group of groups.values()) group.sort(byOrder);
  return groups;
}

export function effectiveParentId(items: TreeItem[], id: string): string | null {
  const item = items.find((candidate) => candidate.id === id);
  if (!item?.parentId || item.parentId === id || !items.some((candidate) => candidate.id === item.parentId)) return null;
  return item.parentId;
}

export function siblingIds(items: TreeItem[], parentId: string | null): string[] {
  return (groupChildren(items).get(parentId) ?? []).map((item) => item.id);
}

/**
 * Depth-first, in display order. Children of collapsed items are left out, and so is everything
 * under `hideBelow`, which is the item being dragged: it can't be dropped inside itself.
 */
export function flattenTree<Item extends TreeItem>(items: Item[], collapsed: ReadonlySet<string> = new Set(), hideBelow?: string): FlatItem<Item>[] {
  const groups = groupChildren(items);
  const result: FlatItem<Item>[] = [];
  const visited = new Set<string>();

  const walk = (parentId: string | null, depth: number) => {
    for (const item of groups.get(parentId) ?? []) {
      // A corrupted parent chain could loop. Each item is shown once at most.
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      const children = groups.get(item.id) ?? [];
      result.push({ id: item.id, item, parentId, depth, childCount: children.length });
      if (!collapsed.has(item.id) && item.id !== hideBelow) walk(item.id, depth + 1);
    }
  };
  walk(null, 0);
  return result;
}

export function isDescendant(items: TreeItem[], ancestorId: string, id: string): boolean {
  const parentOf = new Map(items.map((item) => [item.id, item.parentId]));
  let current = parentOf.get(id) ?? null;
  for (let guard = 0; current && guard <= items.length; guard += 1) {
    if (current === ancestorId) return true;
    current = parentOf.get(current) ?? null;
  }
  return false;
}

function arrayMove<Value>(values: Value[], from: number, to: number): Value[] {
  const next = [...values];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as Value);
  return next;
}

export interface Projection {
  depth: number;
  parentId: string | null;
}

/**
 * Where a dragged item would land: the row it is over sets the position, and how far it was pulled
 * sideways sets the depth. `offset` is measured toward the line's start, so it is positive for
 * moving deeper in both directions of text.
 */
export function getProjection<Item extends TreeItem>(flat: FlatItem<Item>[], activeId: string, overId: string, offset: number, indent: number, maxDepth: number): Projection | null {
  const activeIndex = flat.findIndex((row) => row.id === activeId);
  const overIndex = flat.findIndex((row) => row.id === overId);
  if (activeIndex < 0 || overIndex < 0) return null;

  const active = flat[activeIndex]!;
  const moved = arrayMove(flat, activeIndex, overIndex);
  const previous = moved[overIndex - 1];
  const next = moved[overIndex + 1];

  const projected = active.depth + Math.round(offset / Math.max(indent, 1));
  const upper = Math.min(maxDepth, previous ? previous.depth + 1 : 0);
  const lower = Math.min(upper, next ? next.depth : 0);
  const depth = Math.max(lower, Math.min(projected, upper));

  if (depth === 0 || !previous) return { depth: 0, parentId: null };
  if (depth === previous.depth) return { depth, parentId: previous.parentId };
  if (depth > previous.depth) return { depth, parentId: previous.id };
  const ancestor = moved
    .slice(0, overIndex)
    .reverse()
    .find((row) => row.depth === depth);
  return { depth, parentId: ancestor?.parentId ?? null };
}

/**
 * The full sibling order after a drop. Visible rows give the order. Siblings that weren't visible,
 * because their parent was collapsed, keep their place after them, and a drop into a collapsed
 * parent goes last.
 */
export function placementAfterDrop<Item extends TreeItem>(items: Item[], flat: FlatItem<Item>[], activeId: string, overId: string, projection: Projection): Placement | null {
  const activeIndex = flat.findIndex((row) => row.id === activeId);
  const overIndex = flat.findIndex((row) => row.id === overId);
  if (activeIndex < 0 || overIndex < 0) return null;
  if (projection.parentId === activeId || (projection.parentId && isDescendant(items, activeId, projection.parentId))) return null;

  const moved = arrayMove(flat, activeIndex, overIndex).map((row) => (row.id === activeId ? { ...row, parentId: projection.parentId } : row));
  const visible = moved.filter((row) => row.parentId === projection.parentId).map((row) => row.id);
  const all = siblingIds(items, projection.parentId).filter((id) => id !== activeId);
  const hidden = all.filter((id) => !visible.includes(id));
  // Only the dragged row is visible there, so the parent is collapsed and its children come first.
  if (hidden.length && visible.length === 1) return { parentId: projection.parentId, orderedIds: [...hidden, activeId] };
  return { parentId: projection.parentId, orderedIds: [...visible, ...hidden] };
}

/** The same moves without dragging, for the row menu and keyboard users. Null when the move isn't possible. */
export function placementForMenuMove(items: TreeItem[], id: string, move: MenuMove): Placement | null {
  const parentId = effectiveParentId(items, id);
  const siblings = siblingIds(items, parentId);
  const index = siblings.indexOf(id);
  if (index < 0) return null;

  if (move === "up" || move === "down") {
    const target = move === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= siblings.length) return null;
    return { parentId, orderedIds: arrayMove(siblings, index, target) };
  }
  if (move === "indent") {
    const newParent = siblings[index - 1];
    if (!newParent) return null;
    return { parentId: newParent, orderedIds: [...siblingIds(items, newParent).filter((sibling) => sibling !== id), id] };
  }
  if (!parentId) return null;
  const grandParent = effectiveParentId(items, parentId);
  const uncles = siblingIds(items, grandParent).filter((sibling) => sibling !== id);
  const at = uncles.indexOf(parentId);
  uncles.splice(at + 1, 0, id);
  return { parentId: grandParent, orderedIds: uncles };
}

/** Spaced by ten, so the stored numbers stay readable and small. */
export const ORDER_STEP = 10;

export function applyPlacement<Item extends TreeItem>(items: Item[], id: string, placement: Placement): Item[] {
  const position = new Map(placement.orderedIds.map((siblingId, index) => [siblingId, index * ORDER_STEP]));
  return items.map((item) => {
    const order = position.get(item.id);
    if (item.id === id) return { ...item, parentId: placement.parentId, order: order ?? item.order };
    return order === undefined ? item : { ...item, order };
  });
}
