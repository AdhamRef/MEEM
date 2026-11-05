"use client";

/* eslint-disable @next/next/no-img-element -- A preview of an uploaded image inside the editor. */
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { strings } from "@/config/strings.ar";
import { HEADING_LEVELS, isSafeHref, isSafeImageSrc } from "@/lib/content/document";

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
    strike: false,
    underline: false,
    link: {
      openOnClick: false,
      autolink: true,
      protocols: ["http", "https"],
      isAllowedUri: (url) => isSafeHref(url),
      HTMLAttributes: { rel: "noopener noreferrer nofollow", target: null },
    },
  }),
  Figure,
  Footnote,
];
