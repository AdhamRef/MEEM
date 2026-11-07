"use client";

/* eslint-disable @next/next/no-img-element -- A preview of an uploaded image inside the editor. */
import { mergeAttributes, Node } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { strings } from "@/config/strings.ar";
import { CALLOUT_VARIANTS, HEADING_LEVELS, isSafeHref, isSafeImageSrc, type CalloutVariant } from "@/lib/content/document";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** Puts the selected blocks in a box, or changes the box they're already in. */
      setCallout: (variant: CalloutVariant) => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const variant = node.attrs.variant as CalloutVariant;
  return (
    <NodeViewWrapper as="aside" className="article-callout" data-variant={variant} data-testid="editor-callout">
      <div contentEditable={false} className="mb-2 flex items-center gap-2">
        {editor.isEditable ? (
          <select
            value={variant}
            aria-label={strings.editor.calloutKind}
            onChange={(event) => updateAttributes({ variant: event.target.value })}
            className="article-callout-label rounded-md border-0 bg-transparent p-0 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            data-testid="callout-variant"
          >
            {CALLOUT_VARIANTS.map((option) => (
              <option key={option} value={option}>
                {strings.articles.callouts[option]}
              </option>
            ))}
          </select>
        ) : (
          <span className="article-callout-label">{strings.articles.callouts[variant]}</span>
        )}
      </div>
      <NodeViewContent className="space-y-3" />
    </NodeViewWrapper>
  );
}

/** A box for a verse, a hadith, a benefit, a note, or a caution. The allow-list keeps only these. */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "(paragraph | heading | bulletList | orderedList | blockquote)+",
  defining: true,

  addAttributes() {
    return { variant: { default: "note" satisfies CalloutVariant } };
  },

  parseHTML() {
    return [
      {
        tag: "aside[data-callout]",
        getAttrs: (element) => {
          const variant = element.getAttribute("data-variant");
          return { variant: (CALLOUT_VARIANTS as readonly (string | null)[]).includes(variant) ? variant : "note" };
        },
      },
    ];
  },

  renderHTML({ node }) {
    return ["aside", { "data-callout": "", "data-variant": node.attrs.variant, class: "article-callout" }, 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },

  addCommands() {
    return {
      setCallout:
        (variant) =>
        ({ editor, commands }) =>
          editor.isActive("callout") ? commands.updateAttributes("callout", { variant }) : commands.wrapIn(this.name, { variant }),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    };
  },
});

function FigureView({ node, updateAttributes, deleteNode, editor }: ReactNodeViewProps) {
  const { src, alt, caption } = node.attrs as { src: string; alt: string; caption: string };
  const isEditable = editor.isEditable;

  return (
    <NodeViewWrapper as="figure" className="space-y-2 rounded-xl border p-3" data-testid="editor-figure">
      <img src={src} alt={alt} />
      {isEditable ? (
        <div className="space-y-2" contentEditable={false}>
          <Input value={caption} placeholder={strings.editor.figureCaption} aria-label={strings.editor.figureCaption} dir="auto" onChange={(event) => updateAttributes({ caption: event.target.value })} data-testid="figure-caption" />
          <Input value={alt} placeholder={strings.editor.figureAlt} aria-label={strings.editor.figureAlt} dir="auto" onChange={(event) => updateAttributes({ alt: event.target.value })} data-testid="figure-alt" />
          <Button type="button" variant="ghost" onClick={deleteNode}>
            <Trash2 aria-hidden data-icon="inline-start" />
            {strings.editor.figureRemove}
          </Button>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

/** An image with its caption. It's the only way an image enters a document. */
export const Figure = Node.create({
  name: "figure",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return { src: { default: null }, alt: { default: "" }, caption: { default: "" }, width: { default: null }, height: { default: null } };
  },

  parseHTML() {
    return [
      {
        tag: "figure[data-figure]",
        getAttrs: (element) => {
          const src = element.querySelector("img")?.getAttribute("src");
          if (!isSafeImageSrc(src)) return false;
          return { src, alt: element.querySelector("img")?.getAttribute("alt") ?? "", caption: element.querySelector("figcaption")?.textContent ?? "" };
        },
      },
    ];
  },

  renderHTML({ node }) {
    return ["figure", { "data-figure": "" }, ["img", { src: node.attrs.src, alt: node.attrs.alt }], ["figcaption", {}, node.attrs.caption ?? ""]];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureView);
  },
});

/** A numbered note. It holds plain text only, in an attribute, so it can't contain markup. */
export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { text: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "sup[data-footnote]", getAttrs: (element) => ({ text: element.getAttribute("data-footnote") ?? "" }) }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes, { "data-footnote": node.attrs.text, title: node.attrs.text, class: "editor-footnote" })];
  },
});

export const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [...HEADING_LEVELS] },
    code: false,
    codeBlock: false,
    link: {
      openOnClick: false,
      autolink: true,
      protocols: ["http", "https"],
      isAllowedUri: (url) => isSafeHref(url),
      HTMLAttributes: { rel: "noopener noreferrer nofollow", target: null },
    },
  }),
  Highlight.configure({ multicolor: false }),
  // Logical values, which the allow-list keeps, so alignment follows the text's direction.
  TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["start", "center", "end", "justify"], defaultAlignment: "start" }),
  TableKit.configure({ table: { resizable: false } }),
  Placeholder.configure({ placeholder: strings.editor.placeholder }),
  CharacterCount,
  Callout,
  Figure,
  Footnote,
];
