import { describe, expect, it } from "vitest";
import { applyPlacement, flattenTree, getProjection, isDescendant, placementAfterDrop, placementForMenuMove, siblingIds, type TreeItem } from "./tree";

const node = (id: string, parentId: string | null, order: number): TreeItem => ({ id, parentId, order });

// a
// ├─ a1
// └─ a2
// b
// c
const tree = [node("a", null, 0), node("b", null, 10), node("c", null, 20), node("a1", "a", 0), node("a2", "a", 10)];

describe("flattenTree", () => {
  it("lists depth-first in order, with depths and child counts", () => {
    expect(flattenTree(tree).map((row) => [row.id, row.depth, row.childCount])).toEqual([
      ["a", 0, 2],
      ["a1", 1, 0],
      ["a2", 1, 0],
      ["b", 0, 0],
      ["c", 0, 0],
    ]);
  });

  it("hides the children of collapsed items and of the dragged item", () => {
    expect(flattenTree(tree, new Set(["a"])).map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(flattenTree(tree, new Set(), "a").map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("treats an item whose parent is missing as top-level, and survives a parent loop", () => {
    const broken = [node("x", "gone", 0), node("p", "q", 0), node("q", "p", 0)];
    expect(flattenTree(broken).map((row) => row.id)).toEqual(["x"]);
  });
});

describe("getProjection", () => {
  const flat = flattenTree(tree);

  it("keeps the depth when not pulled sideways", () => {
    expect(getProjection(flat, "c", "b", 0, 24, 32)).toEqual({ depth: 0, parentId: null });
  });

  it("nests under the row above when pulled toward the start", () => {
    expect(getProjection(flat, "c", "c", 24, 24, 32)).toEqual({ depth: 1, parentId: "b" });
  });

  it("never nests deeper than one below the row above", () => {
    expect(getProjection(flat, "c", "c", 24 * 5, 24, 32)).toEqual({ depth: 1, parentId: "b" });
  });

  it("respects the maximum depth, so a flat list stays flat", () => {
    expect(getProjection(flat, "c", "c", 24, 24, 0)).toEqual({ depth: 0, parentId: null });
  });

  it("moves a child out to the top level when pulled toward the end", () => {
    expect(getProjection(flat, "a2", "a2", -24, 24, 32)).toEqual({ depth: 0, parentId: null });
  });

  it("can't leave a child stranded above its new siblings", () => {
    // Dropping b between a and a1 must make it a child of a, since a1 is a child below it.
    expect(getProjection(flat, "b", "a1", 0, 24, 32)).toEqual({ depth: 1, parentId: "a" });
  });
});

describe("placementAfterDrop", () => {
  it("gives the whole new sibling order", () => {
    const flat = flattenTree(tree);
    const projection = getProjection(flat, "c", "a", 0, 24, 32)!;
    expect(placementAfterDrop(tree, flat, "c", "a", projection)).toEqual({ parentId: null, orderedIds: ["c", "a", "b"] });
  });

  it("puts a drop into a collapsed parent last, keeping its hidden children", () => {
    const flat = flattenTree(tree, new Set(["a"]));
    expect(placementAfterDrop(tree, flat, "b", "b", { depth: 1, parentId: "a" })).toEqual({ parentId: "a", orderedIds: ["a1", "a2", "b"] });
  });

  it("refuses to drop an item inside itself", () => {
    const flat = flattenTree(tree);
    expect(placementAfterDrop(tree, flat, "a", "a", { depth: 1, parentId: "a1" })).toBeNull();
  });
});

describe("placementForMenuMove", () => {
  it("moves up and down among siblings, and stops at the ends", () => {
    expect(placementForMenuMove(tree, "b", "up")).toEqual({ parentId: null, orderedIds: ["b", "a", "c"] });
    expect(placementForMenuMove(tree, "a2", "down")).toBeNull();
    expect(placementForMenuMove(tree, "a", "up")).toBeNull();
  });

  it("indents under the sibling above, last", () => {
    expect(placementForMenuMove(tree, "b", "indent")).toEqual({ parentId: "a", orderedIds: ["a1", "a2", "b"] });
    expect(placementForMenuMove(tree, "a", "indent")).toBeNull();
  });

  it("outdents to just after its parent", () => {
    expect(placementForMenuMove(tree, "a1", "outdent")).toEqual({ parentId: null, orderedIds: ["a", "a1", "b", "c"] });
    expect(placementForMenuMove(tree, "b", "outdent")).toBeNull();
  });
});

describe("applyPlacement and helpers", () => {
  it("rewrites the parent and the sibling order, spaced by ten", () => {
    const next = applyPlacement(tree, "b", { parentId: "a", orderedIds: ["a1", "b", "a2"] });
    expect(siblingIds(next, "a")).toEqual(["a1", "b", "a2"]);
    expect(next.find((item) => item.id === "a2")?.order).toBe(20);
    expect(siblingIds(next, null)).toEqual(["a", "c"]);
  });

  it("knows descendants", () => {
    expect(isDescendant(tree, "a", "a2")).toBe(true);
    expect(isDescendant(tree, "a2", "a")).toBe(false);
  });
});
