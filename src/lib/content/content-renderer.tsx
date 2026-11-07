/* eslint-disable @next/next/no-img-element -- Uploads are already resized by the upload pipeline, and their host depends on the storage provider. */
import Link from "next/link";
import type { ReactNode } from "react";
import { strings } from "@/config/strings.ar";
import { collectFootnotes, extractHeadings } from "./analysis";
import { isSafeHref, isSafeImageSrc, sanitizeDocument, type BlockNode, type CalloutVariant, type ContentMark, type InlineNode, type TextAlignment } from "./document";

/** Logical values only, so a paragraph aligned to the end stays at the end in either direction. */
const alignClass: Record<Exclude<TextAlignment, "start">, string> = { center: "text-center", end: "text-end", justify: "text-justify" };
const alignOf = (attrs: { textAlign?: Exclude<TextAlignment, "start"> } | undefined) => (attrs?.textAlign ? alignClass[attrs.textAlign] : undefined);

/**
 * Builds React elements from the allow-listed document, and never uses
 * dangerouslySetInnerHTML, so stored text can't become markup. It works in both the public
 * page and the editor's preview, so what a volunteer previews is what readers get.
 */

interface RenderContext {
  anchors: string[];
  nextHeading: number;
  nextFootnote: number;
}

function renderLink(href: string, children: ReactNode): ReactNode {
  if (!isSafeHref(href)) return children;
  if (href.startsWith("/")) return <Link href={href}>{children}</Link>;
  if (href.startsWith("#")) return <a href={href}>{children}</a>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  );
}

function renderMarks(text: string, marks: ContentMark[] | undefined): ReactNode {
  let output: ReactNode = text;
  for (const mark of marks ?? []) {
    if (mark.type === "bold") output = <strong>{output}</strong>;
    else if (mark.type === "italic") output = <em>{output}</em>;
    else if (mark.type === "underline") output = <u>{output}</u>;
    else if (mark.type === "strike") output = <s>{output}</s>;
    else if (mark.type === "highlight") output = <mark>{output}</mark>;
    else output = renderLink(mark.attrs.href, output);
  }
  return output;
}

function renderInline(nodes: InlineNode[] | undefined, context: RenderContext): ReactNode[] {
  return (nodes ?? []).map((node, index) => {
    if (node.type === "text") return <span key={index}>{renderMarks(node.text, node.marks)}</span>;
    if (node.type === "hardBreak") return <br key={index} />;

    context.nextFootnote += 1;
    const number = context.nextFootnote;
    return (
      <sup key={index} id={`fnref-${number}`}>
        <a href={`#fn-${number}`} aria-label={`${strings.articles.footnote} ${number}`}>
          {number}
        </a>
      </sup>
    );
  });
}

function renderBlock(block: BlockNode, key: number, context: RenderContext): ReactNode {
  switch (block.type) {
    case "paragraph":
      return (
        <p key={key} dir="auto" className={alignOf(block.attrs)}>
          {renderInline(block.content, context)}
        </p>
      );
    case "heading": {
      const Tag = `h${block.attrs.level}` as const;
      // Must walk in the same order as extractHeadings, which skips empty headings.
      const isEmpty = !block.content?.some((node) => node.type === "text" && node.text.trim());
      const anchor = isEmpty ? undefined : context.anchors[context.nextHeading++];
      return (
        <Tag key={key} id={anchor} dir="auto" className={alignOf(block.attrs)}>
          {renderInline(block.content, context)}
        </Tag>
      );
    }
    case "bulletList":
    case "orderedList": {
      const List = block.type === "bulletList" ? "ul" : "ol";
      return <List key={key}>{block.content.map((item, index) => <li key={index}>{item.content.map((child, childIndex) => renderBlock(child, childIndex, context))}</li>)}</List>;
    }
    case "blockquote":
      return <blockquote key={key}>{block.content.map((child, index) => renderBlock(child, index, context))}</blockquote>;
    case "horizontalRule":
      return <hr key={key} />;
    case "callout":
      return (
        <aside key={key} className="article-callout" data-variant={block.attrs.variant} aria-label={calloutLabel(block.attrs.variant)}>
          <p className="article-callout-label">{calloutLabel(block.attrs.variant)}</p>
          {block.content.map((child, index) => renderBlock(child, index, context))}
        </aside>
      );
    case "table":
      return (
        // Wide tables scroll inside their own box on a phone, rather than widening the page.
        <div key={key} className="article-table" role="region" aria-label={strings.articles.table} tabIndex={0}>
          <table>
            <tbody>
              {block.content.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.content.map((cell, cellIndex) => {
                    const Cell = cell.type === "tableHeader" ? "th" : "td";
                    return (
                      <Cell key={cellIndex} colSpan={cell.attrs.colspan > 1 ? cell.attrs.colspan : undefined} rowSpan={cell.attrs.rowspan > 1 ? cell.attrs.rowspan : undefined} scope={cell.type === "tableHeader" ? "col" : undefined} dir="auto">
                        {cell.content.map((child, index) => renderBlock(child, index, context))}
                      </Cell>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "figure":
      if (!isSafeImageSrc(block.attrs.src)) return null;
      return (
        <figure key={key}>
          <img src={block.attrs.src} alt={block.attrs.alt} width={block.attrs.width ?? undefined} height={block.attrs.height ?? undefined} loading="lazy" decoding="async" />
          {block.attrs.caption ? <figcaption dir="auto">{block.attrs.caption}</figcaption> : null}
        </figure>
      );
  }
}

function calloutLabel(variant: CalloutVariant): string {
  return strings.articles.callouts[variant];
}

export function ArticleBody({ body }: { body: unknown }) {
  const document = sanitizeDocument(body);
  const footnotes = collectFootnotes(document);
  const context: RenderContext = { anchors: extractHeadings(document).map((heading) => heading.anchor), nextHeading: 0, nextFootnote: 0 };

  return (
    <div className="prose-article" data-testid="article-body">
      {document.content.map((block, index) => renderBlock(block, index, context))}

      {footnotes.length ? (
        <section aria-label={strings.articles.footnotes} data-testid="article-footnotes">
          <hr />
          <ol className="text-[0.875em] text-text-secondary">
            {footnotes.map((footnote) => (
              <li key={footnote.number} id={`fn-${footnote.number}`}>
                <span dir="auto">{footnote.text}</span>{" "}
                <a href={`#fnref-${footnote.number}`} aria-label={strings.articles.backToText}>
                  ↩
                </a>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
