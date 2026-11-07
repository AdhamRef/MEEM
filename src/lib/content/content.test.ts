import { describe, expect, it } from "vitest";
import { collectFootnotes, computeReadingMinutes, extractHeadings, extractPlainText, isDocumentEmpty } from "./analysis";
import { isSafeHref, isSafeImageSrc, sanitizeDocument, type ContentDocument } from "./document";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const text = (value: string, marks?: unknown[]) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const heading = (level: number, value: string) => ({ type: "heading", attrs: { level }, content: [text(value)] });
const figure = (attrs: Record<string, unknown>) => ({ type: "figure", attrs });

describe("sanitizeDocument: hostile content", () => {
  it.each([
    ["script node", { type: "script", content: [text("alert(1)")] }],
    ["raw html node", { type: "html", attrs: { value: "<img src=x onerror=alert(1)>" } }],
    ["iframe", { type: "iframe", attrs: { src: "https://evil.example" } }],
    ["image node type from outside the editor", { type: "image", attrs: { src: "https://evil.example/x.png" } }],
    ["code block", { type: "codeBlock", content: [text("x")] }],
  ])("drops an unknown block: %s", (_name, node) => {
    expect(sanitizeDocument(doc(node, paragraph(text("keep"))))).toEqual(doc(paragraph(text("keep"))));
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "java\nscript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "//evil.example/path",
    "/\\evil.example",
    "\\\\evil.example",
    "blob:https://evil.example/1",
  ])("removes the link but keeps the text: %j", (href) => {
    const clean = sanitizeDocument(doc(paragraph(text("label", [{ type: "link", attrs: { href } }]))));
    expect(clean).toEqual(doc(paragraph(text("label"))));
  });

  it("copies only known link attributes, so handlers and targets can't get through", () => {
    const clean = sanitizeDocument(doc(paragraph(text("x", [{ type: "link", attrs: { href: "https://a.example", onclick: "alert(1)", target: "_top", style: "x" } }]))));
    expect(clean).toEqual(doc(paragraph(text("x", [{ type: "link", attrs: { href: "https://a.example" } }]))));
  });

  it("drops unknown marks and unknown attributes on nodes", () => {
    const clean = sanitizeDocument(doc({ type: "paragraph", attrs: { onmouseover: "alert(1)", class: "x" }, content: [text("x", [{ type: "textStyle", attrs: { style: "position:fixed" } }, { type: "bold" }])] }));
    expect(clean).toEqual(doc(paragraph(text("x", [{ type: "bold" }]))));
  });

  it("keeps markup-like text as plain text, for React to escape", () => {
    const payload = '<script>alert("x")</script><img src=x onerror=alert(1)>';
    expect(sanitizeDocument(doc(paragraph(text(payload))))).toEqual(doc(paragraph(text(payload))));
  });

  it.each(["javascript:alert(1)", "data:image/svg+xml,<svg onload=alert(1)>", "http://insecure.example/a.png", "/media/../../etc/passwd", "/media//evil", "/other/a.webp", "", null, 7])(
    "drops a figure with an unsafe source: %j",
    (src) => {
      expect(sanitizeDocument(doc(figure({ src, alt: "x" }), paragraph(text("keep"))))).toEqual(doc(paragraph(text("keep"))));
    },
  );

  it("keeps only known figure attributes, and bad dimensions become null", () => {
    const clean = sanitizeDocument(doc(figure({ src: "/media/images/a.webp", alt: "alt", caption: "cap", width: -1, height: "9", onerror: "alert(1)" })));
    expect(clean).toEqual(doc(figure({ src: "/media/images/a.webp", alt: "alt", caption: "cap", width: null, height: null })));
  });

  it("never lets a nested list item carry disallowed children", () => {
    const clean = sanitizeDocument(doc({ type: "bulletList", content: [{ type: "listItem", content: [{ type: "script" }, paragraph(text("a"))] }, { type: "script" }] }));
    expect(clean).toEqual(doc({ type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("a"))] }] }));
  });

  it("rejects a document nested too deeply", () => {
    let node: Record<string, unknown> = paragraph(text("x"));
    for (let depth = 0; depth < 40; depth += 1) node = { type: "blockquote", content: [node] };
    expect(() => sanitizeDocument(doc(node))).toThrow();
  });

  it("rejects a document with too many nodes", () => {
    expect(() => sanitizeDocument(doc(...Array.from({ length: 50_001 }, () => ({ type: "horizontalRule" }))))).toThrow();
  });

  it.each([null, undefined, "x", 3, [], {}, { type: "paragraph" }, { type: "doc", content: "x" }])("gives an empty document for non-documents: %j", (value) => {
    expect(sanitizeDocument(value)).toEqual(doc({ type: "paragraph" }));
  });
});

describe("sanitizeDocument: normal content", () => {
  it("keeps every supported element unchanged", () => {
    const original = doc(
      heading(2, "عنوان"),
      paragraph(text("نص "), text("عريض", [{ type: "bold" }]), text(" "), text("مائل", [{ type: "italic" }]), { type: "hardBreak" }, text("رابط", [{ type: "link", attrs: { href: "/articles/اختبار" } }]), { type: "footnote", attrs: { text: "حاشية" } }),
      { type: "orderedList", content: [{ type: "listItem", content: [paragraph(text("أ"))] }] },
      { type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("ب"))] }] },
      { type: "blockquote", content: [paragraph(text("اقتباس"))] },
      { type: "horizontalRule" },
      figure({ src: "https://cdn.example/a.webp", alt: "وصف", caption: "تعليق", width: 800, height: 600 }),
    );
    expect(sanitizeDocument(original)).toEqual(original);
  });

  it("is stable when applied twice", () => {
    const once = sanitizeDocument(doc(heading(1, "أ"), paragraph(text("ب", [{ type: "link", attrs: { href: "javascript:x" } }]))));
    expect(sanitizeDocument(once)).toEqual(once);
  });

  it("moves headings above the allowed levels to the top allowed level", () => {
    expect(sanitizeDocument(doc(heading(1, "أ"), heading(9, "ب"), heading(3, "ج"))).content.map((block) => (block.type === "heading" ? block.attrs.level : 0))).toEqual([2, 2, 3]);
  });
});

describe("URL rules", () => {
  it.each(["/articles/x", "https://a.example/x?y=1#z", "http://a.example", "#section"])("accepts %s", (href) => expect(isSafeHref(href)).toBe(true));
  it.each(["/media/images/2026/11/a.webp", "https://cdn.example/a.webp"])("accepts the image %s", (src) => expect(isSafeImageSrc(src)).toBe(true));
});

describe("document analysis", () => {
  const typed = (...content: unknown[]) => sanitizeDocument(doc(...content)) as ContentDocument;

  it("builds a table of contents with Arabic anchors, in order, with no duplicates", () => {
    const headings = extractHeadings(typed(heading(2, "مُقدّمة البحث"), paragraph(text("x")), heading(3, "تفصيل"), heading(2, "تفصيل"), heading(2, "!!!")));
    expect(headings.map((item) => item.anchor)).toEqual(["مقدمة-البحث", "تفصيل", "تفصيل-2", "section-4"]);
    expect(headings.map((item) => item.level)).toEqual([2, 3, 2, 2]);
  });

  it("finds headings nested in quotes and lists, and skips empty ones", () => {
    const headings = extractHeadings(typed({ type: "blockquote", content: [heading(3, "داخل")] }, { type: "heading", attrs: { level: 2 } }));
    expect(headings.map((item) => item.text)).toEqual(["داخل"]);
  });

  it("calculates reading time, with no time for no words", () => {
    expect(computeReadingMinutes("")).toBe(0);
    expect(computeReadingMinutes("كلمة")).toBe(1);
    expect(computeReadingMinutes(Array(200).fill("كلمة").join(" "))).toBe(1);
    expect(computeReadingMinutes(Array(201).fill("كلمة").join(" "))).toBe(2);
  });

  it("numbers footnotes in reading order", () => {
    const footnotes = collectFootnotes(typed(paragraph(text("a"), { type: "footnote", attrs: { text: "أولى" } }), { type: "blockquote", content: [paragraph({ type: "footnote", attrs: { text: "ثانية" } })] }));
    expect(footnotes).toEqual([{ number: 1, text: "أولى" }, { number: 2, text: "ثانية" }]);
  });

  it("drops a footnote with no text", () => {
    expect(collectFootnotes(typed(paragraph({ type: "footnote", attrs: { text: "   " } })))).toEqual([]);
  });

  it("reads plain text from paragraphs, headings, and captions", () => {
    expect(extractPlainText(typed(heading(2, "أ"), paragraph(text("ب")), figure({ src: "/media/a.webp", caption: "ج" })))).toBe("أ ب ج");
  });

  it("treats a document as empty only with no text and no image", () => {
    expect(isDocumentEmpty(typed(paragraph()))).toBe(true);
    expect(isDocumentEmpty(typed(paragraph(text("أ"))))).toBe(false);
    expect(isDocumentEmpty(typed(figure({ src: "/media/a.webp" })))).toBe(false);
  });
});

describe("sanitizeDocument: richer formatting", () => {
  const cell = (type: string, value: string, attrs: Record<string, unknown> = {}) => ({ type, attrs, content: [paragraph(text(value))] });

  it("keeps underline, strike, and one highlight colour, never a stored colour", () => {
    const clean = sanitizeDocument(doc(paragraph(text("x", [{ type: "underline" }, { type: "strike" }, { type: "highlight", attrs: { color: "red; background:url(x)" } }]))));
    expect(clean).toEqual(doc(paragraph(text("x", [{ type: "underline" }, { type: "strike" }, { type: "highlight" }]))));
  });

  it("keeps logical alignment only, and drops start, which is the default", () => {
    const clean = sanitizeDocument(
      doc(
        { type: "paragraph", attrs: { textAlign: "center" }, content: [text("أ")] },
        { type: "paragraph", attrs: { textAlign: "left" }, content: [text("ب")] },
        { type: "paragraph", attrs: { textAlign: "start" }, content: [text("ج")] },
        { type: "heading", attrs: { level: 2, textAlign: "justify" }, content: [text("د")] },
      ),
    );
    expect(clean.content).toEqual([
      { type: "paragraph", attrs: { textAlign: "center" }, content: [text("أ")] },
      paragraph(text("ب")),
      paragraph(text("ج")),
      { type: "heading", attrs: { level: 2, textAlign: "justify" }, content: [text("د")] },
    ]);
  });

  it("keeps a callout's known variant, falls back to a note, and never nests boxes or tables in one", () => {
    const clean = sanitizeDocument(
      doc(
        { type: "callout", attrs: { variant: "ayah", onclick: "x" }, content: [paragraph(text("آية"))] },
        { type: "callout", attrs: { variant: "<script>" }, content: [paragraph(text("أ")), { type: "callout", attrs: { variant: "note" }, content: [paragraph(text("ب"))] }] },
        { type: "callout", attrs: { variant: "note" }, content: [] },
      ),
    );
    expect(clean.content).toEqual([
      { type: "callout", attrs: { variant: "ayah" }, content: [paragraph(text("آية"))] },
      { type: "callout", attrs: { variant: "note" }, content: [paragraph(text("أ"))] },
    ]);
  });

  it("keeps tables with bounded spans, text-only cells, and no stray rows or cells", () => {
    const clean = sanitizeDocument(
      doc({
        type: "table",
        attrs: { style: "x" },
        content: [
          { type: "tableRow", content: [cell("tableHeader", "أ", { colspan: 2, style: "x" }), cell("tableHeader", "ب", { colspan: 999 })] },
          { type: "tableRow", content: [{ type: "tableCell", attrs: { rowspan: 2 }, content: [{ type: "table", content: [] }, paragraph(text("ج"))] }, { type: "image", attrs: {} }] },
          { type: "paragraph", content: [text("ليس صفًا")] },
        ],
      }),
    );
    expect(clean.content).toEqual([
      {
        type: "table",
        content: [
          { type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 2, rowspan: 1 }, content: [paragraph(text("أ"))] }, { type: "tableHeader", attrs: { colspan: 1, rowspan: 1 }, content: [paragraph(text("ب"))] }] },
          { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 1, rowspan: 2 }, content: [paragraph(text("ج"))] }] },
        ],
      },
    ]);
  });

  it("reads headings, text, and footnotes inside callouts and tables", () => {
    const clean = sanitizeDocument(
      doc(
        { type: "callout", attrs: { variant: "benefit" }, content: [{ type: "heading", attrs: { level: 3 }, content: [text("فائدة")] }, paragraph(text("نص"), { type: "footnote", attrs: { text: "هامش" } })] },
        { type: "table", content: [{ type: "tableRow", content: [cell("tableCell", "خلية")] }] },
      ),
    );
    expect(extractHeadings(clean).map((item) => item.text)).toEqual(["فائدة"]);
    expect(extractPlainText(clean)).toBe("فائدة نص خلية");
    expect(collectFootnotes(clean)).toEqual([{ number: 1, text: "هامش" }]);
  });
});
