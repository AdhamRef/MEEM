import { AppError } from "@/lib/errors";

/**
 * Article bodies are stored as Tiptap JSON and never as HTML. This module is the allow-list:
 * it rebuilds a document from scratch, keeping only known nodes, marks, and attributes.
 * Anything else, including unknown attributes such as event handlers, simply isn't copied.
 * It runs on save and again before rendering, so stored data is never trusted.
 */

export type ContentMark = { type: "bold" } | { type: "italic" } | { type: "underline" } | { type: "strike" } | { type: "highlight" } | { type: "link"; attrs: { href: string } };

/** Logical values, so alignment follows the text's direction. "start" is the default and isn't stored. */
export const TEXT_ALIGNMENTS = ["start", "center", "end", "justify"] as const;
export type TextAlignment = (typeof TEXT_ALIGNMENTS)[number];
type StoredAlignment = Exclude<TextAlignment, "start">;

/** Boxes for content that should stand apart: a verse, a hadith, a benefit, a note, or a caution. */
export const CALLOUT_VARIANTS = ["ayah", "hadith", "benefit", "note", "warning"] as const;
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

export interface TextNode {
  type: "text";
  text: string;
  marks?: ContentMark[];
}
export interface HardBreakNode {
  type: "hardBreak";
}
export interface FootnoteNode {
  type: "footnote";
  attrs: { text: string };
}
export type InlineNode = TextNode | HardBreakNode | FootnoteNode;

export interface ParagraphNode {
  type: "paragraph";
  attrs?: { textAlign: StoredAlignment };
  content?: InlineNode[];
}
export interface HeadingNode {
  type: "heading";
  attrs: { level: HeadingLevel; textAlign?: StoredAlignment };
  content?: InlineNode[];
}
export interface ListItemNode {
  type: "listItem";
  content: BlockNode[];
}
export interface ListNode {
  type: "bulletList" | "orderedList";
  content: ListItemNode[];
}
export interface BlockquoteNode {
  type: "blockquote";
  content: BlockNode[];
}
export interface HorizontalRuleNode {
  type: "horizontalRule";
}
export interface FigureNode {
  type: "figure";
  attrs: { src: string; alt: string; caption: string; width: number | null; height: number | null };
}
export interface CalloutNode {
  type: "callout";
  attrs: { variant: CalloutVariant };
  content: BlockNode[];
}
export interface TableCellNode {
  type: "tableCell" | "tableHeader";
  attrs: { colspan: number; rowspan: number };
  content: BlockNode[];
}
export interface TableRowNode {
  type: "tableRow";
  content: TableCellNode[];
}
export interface TableNode {
  type: "table";
  content: TableRowNode[];
}
export type BlockNode = ParagraphNode | HeadingNode | ListNode | BlockquoteNode | HorizontalRuleNode | FigureNode | CalloutNode | TableNode;

export interface ContentDocument {
  type: "doc";
  content: BlockNode[];
}

export const HEADING_LEVELS = [2, 3, 4] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];

const MAX_DEPTH = 16;
const MAX_NODES = 50_000;
const MAX_TEXT_LENGTH = 100_000;
const MAX_ALT_LENGTH = 300;
const MAX_CAPTION_LENGTH = 500;
const MAX_FOOTNOTE_LENGTH = 2_000;
const MAX_IMAGE_DIMENSION = 20_000;
const MAX_TABLE_SPAN = 20;
const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLUMNS = 20;

/**
 * Site paths and http(s) only. `new URL` is what the browser would use, so tricks like
 * "java\nscript:" or leading spaces are judged the way the browser would judge them.
 */
export function isSafeHref(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_000) return false;
  if (/^\/(?![/\\])/.test(value)) return !/[\s\\]/.test(value);
  if (/^#[^\s]+$/.test(value)) return true;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Uploaded images only ever come from the local media route or an https storage host. */
export function isSafeImageSrc(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_000) return false;
  if (value.startsWith("/media/")) return !/\.\.|\/\/|\\|\s/.test(value);
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function cleanAlignment(attrs: Record<string, unknown> | null): StoredAlignment | null {
  const value = attrs?.textAlign;
  return value === "center" || value === "end" || value === "justify" ? value : null;
}

function cleanSpan(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_TABLE_SPAN ? value : 1;
}

function cleanDimension(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_IMAGE_DIMENSION ? value : null;
}

class Sanitizer {
  private visited = 0;

  private enter(depth: number): void {
    this.visited += 1;
    // Rejected rather than trimmed: a document this large or deep isn't a real article.
    if (depth > MAX_DEPTH || this.visited > MAX_NODES) throw new AppError("VALIDATION");
  }

  private children(node: Record<string, unknown>): unknown[] {
    return Array.isArray(node.content) ? node.content : [];
  }

  private marks(raw: unknown): ContentMark[] {
    if (!Array.isArray(raw)) return [];
    const marks: ContentMark[] = [];
    for (const item of raw) {
      const mark = asRecord(item);
      if (mark?.type === "bold") marks.push({ type: "bold" });
      else if (mark?.type === "italic") marks.push({ type: "italic" });
      else if (mark?.type === "underline") marks.push({ type: "underline" });
      else if (mark?.type === "strike") marks.push({ type: "strike" });
      // One colour only, chosen by the design, so a stored colour can never be injected.
      else if (mark?.type === "highlight") marks.push({ type: "highlight" });
      else if (mark?.type === "link") {
        const href = asRecord(mark.attrs)?.href;
        // A bad link loses only the link, and its text stays.
        if (isSafeHref(href)) marks.push({ type: "link", attrs: { href } });
      }
    }
    return marks;
  }

  private inline(raw: unknown[], depth: number): InlineNode[] {
    const nodes: InlineNode[] = [];
    for (const item of raw) {
      this.enter(depth);
      const node = asRecord(item);
      if (node?.type === "text") {
        const text = cleanString(node.text, MAX_TEXT_LENGTH);
        if (!text) continue;
        const marks = this.marks(node.marks);
        nodes.push(marks.length ? { type: "text", text, marks } : { type: "text", text });
      } else if (node?.type === "hardBreak") {
        nodes.push({ type: "hardBreak" });
      } else if (node?.type === "footnote") {
        const text = cleanString(asRecord(node.attrs)?.text, MAX_FOOTNOTE_LENGTH).trim();
        if (text) nodes.push({ type: "footnote", attrs: { text } });
      }
    }
    return nodes;
  }

  private withInline<Node extends { content?: InlineNode[] }>(base: Node, raw: Record<string, unknown>, depth: number): Node {
    const content = this.inline(this.children(raw), depth + 1);
    return content.length ? { ...base, content } : base;
  }

  private blocks(raw: unknown[], depth: number): BlockNode[] {
    const nodes: BlockNode[] = [];
    for (const item of raw) {
      this.enter(depth);
      const node = asRecord(item);
      const block = node ? this.block(node, depth) : null;
      if (block) nodes.push(block);
    }
    return nodes;
  }

  private block(node: Record<string, unknown>, depth: number): BlockNode | null {
    switch (node.type) {
      case "paragraph": {
        const textAlign = cleanAlignment(asRecord(node.attrs));
        return this.withInline<ParagraphNode>(textAlign ? { type: "paragraph", attrs: { textAlign } } : { type: "paragraph" }, node, depth);
      }
      case "heading": {
        const attrs = asRecord(node.attrs);
        const level = attrs?.level;
        // The article title is the page's only h1, so anything higher becomes the top level here.
        const safeLevel: HeadingLevel = level === 3 || level === 4 ? level : 2;
        const textAlign = cleanAlignment(attrs);
        return this.withInline<HeadingNode>({ type: "heading", attrs: textAlign ? { level: safeLevel, textAlign } : { level: safeLevel } }, node, depth);
      }
      case "callout": {
        const variant = asRecord(node.attrs)?.variant;
        const safeVariant: CalloutVariant = (CALLOUT_VARIANTS as readonly unknown[]).includes(variant) ? (variant as CalloutVariant) : "note";
        // Nothing nests inside a box but text and lists, so boxes and tables can't pile up.
        const content = this.blocks(this.children(node), depth + 1).filter((child) => child.type !== "callout" && child.type !== "table");
        return content.length ? { type: "callout", attrs: { variant: safeVariant }, content } : null;
      }
      case "table":
        return this.table(node, depth);
      case "bulletList":
      case "orderedList": {
        const items: ListItemNode[] = [];
        for (const rawItem of this.children(node)) {
          this.enter(depth + 1);
          const item = asRecord(rawItem);
          if (item?.type !== "listItem") continue;
          const content = this.blocks(this.children(item), depth + 2);
          if (content.length) items.push({ type: "listItem", content });
        }
        return items.length ? { type: node.type, content: items } : null;
      }
      case "blockquote": {
        const content = this.blocks(this.children(node), depth + 1);
        return content.length ? { type: "blockquote", content } : null;
      }
      case "horizontalRule":
        return { type: "horizontalRule" };
      case "figure": {
        const attrs = asRecord(node.attrs);
        if (!isSafeImageSrc(attrs?.src)) return null;
        return {
          type: "figure",
          attrs: {
            src: attrs.src,
            alt: cleanString(attrs.alt, MAX_ALT_LENGTH),
            caption: cleanString(attrs.caption, MAX_CAPTION_LENGTH),
            width: cleanDimension(attrs.width),
            height: cleanDimension(attrs.height),
          },
        };
      }
      default:
        return null;
    }
  }

  private table(node: Record<string, unknown>, depth: number): TableNode | null {
    const rows: TableRowNode[] = [];
    for (const rawRow of this.children(node).slice(0, MAX_TABLE_ROWS)) {
      this.enter(depth + 1);
      const row = asRecord(rawRow);
      if (row?.type !== "tableRow") continue;
      const cells: TableCellNode[] = [];
      for (const rawCell of this.children(row).slice(0, MAX_TABLE_COLUMNS)) {
        this.enter(depth + 2);
        const cell = asRecord(rawCell);
        if (cell?.type !== "tableCell" && cell?.type !== "tableHeader") continue;
        const attrs = asRecord(cell.attrs);
        // Cells hold text and lists only, never another table or a box.
        const content = this.blocks(this.children(cell), depth + 3).filter((child) => child.type === "paragraph" || child.type === "bulletList" || child.type === "orderedList");
        cells.push({ type: cell.type, attrs: { colspan: cleanSpan(attrs?.colspan), rowspan: cleanSpan(attrs?.rowspan) }, content: content.length ? content : [{ type: "paragraph" }] });
      }
      if (cells.length) rows.push({ type: "tableRow", content: cells });
    }
    return rows.length ? { type: "table", content: rows } : null;
  }

  run(raw: unknown): ContentDocument {
    const root = asRecord(raw);
    const content = root?.type === "doc" ? this.blocks(this.children(root), 1) : [];
    // The editor can't open a document with no blocks.
    return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
  }
}

export function sanitizeDocument(raw: unknown): ContentDocument {
  return new Sanitizer().run(raw);
}

export const EMPTY_DOCUMENT: ContentDocument = { type: "doc", content: [{ type: "paragraph" }] };
