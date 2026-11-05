import { slugify } from "@/lib/slug";
import type { BlockNode, ContentDocument, HeadingLevel, InlineNode } from "./document";

export interface DocumentHeading {
  anchor: string;
  level: HeadingLevel;
  text: string;
}

export interface DocumentFootnote {
  number: number;
  text: string;
}

const WORDS_PER_MINUTE = 200;

export function inlineText(content: InlineNode[] | undefined): string {
  return (content ?? []).map((node) => (node.type === "text" ? node.text : node.type === "hardBreak" ? " " : "")).join("");
}

function visitBlocks(blocks: BlockNode[], visit: (block: BlockNode) => void): void {
  for (const block of blocks) {
    visit(block);
    if (block.type === "blockquote") visitBlocks(block.content, visit);
    if (block.type === "bulletList" || block.type === "orderedList") {
      for (const item of block.content) visitBlocks(item.content, visit);
    }
  }
}

/** Anchors are derived from the text, so a link to a section stays valid across edits elsewhere. */
export function extractHeadings(document: ContentDocument): DocumentHeading[] {
  const used = new Map<string, number>();
  const headings: DocumentHeading[] = [];

  visitBlocks(document.content, (block) => {
    if (block.type !== "heading") return;
    const text = inlineText(block.content).trim();
    if (!text) return;

    const base = slugify(text).slice(0, 80) || `section-${headings.length + 1}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    headings.push({ anchor: count === 1 ? base : `${base}-${count}`, level: block.attrs.level, text });
  });
  return headings;
}

export function extractPlainText(document: ContentDocument): string {
  const parts: string[] = [];
  visitBlocks(document.content, (block) => {
    if (block.type === "paragraph" || block.type === "heading") parts.push(inlineText(block.content));
    if (block.type === "figure" && block.attrs.caption) parts.push(block.attrs.caption);
  });
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function computeReadingMinutes(plainText: string): number {
  const words = plainText.split(/\s+/).filter(Boolean).length;
  return words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

/** In reading order, which is also the order the renderer numbers them. */
export function collectFootnotes(document: ContentDocument): DocumentFootnote[] {
  const footnotes: DocumentFootnote[] = [];
  visitBlocks(document.content, (block) => {
    if (block.type !== "paragraph" && block.type !== "heading") return;
    for (const node of block.content ?? []) {
      if (node.type === "footnote") footnotes.push({ number: footnotes.length + 1, text: node.attrs.text });
    }
  });
  return footnotes;
}

export function isDocumentEmpty(document: ContentDocument): boolean {
  return extractPlainText(document).length === 0 && !document.content.some((block) => block.type === "figure");
}
