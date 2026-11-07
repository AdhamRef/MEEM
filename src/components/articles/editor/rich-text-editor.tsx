"use client";

import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Columns3,
  Heading2,
  Heading3,
  Heading4,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  Minus,
  NotebookPen,
  PanelTop,
  Quote,
  Redo2,
  Rows3,
  SquareDashedBottom,
  Strikethrough,
  Table2,
  Trash2,
  Underline,
  Undo2,
} from "lucide-react";
import { useRef, useState } from "react";
import { uploadImageFile } from "@/components/admin/content/image-field";
import { PickerSearch } from "@/components/admin/content/content-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { strings } from "@/config/strings.ar";
import { computeReadingMinutes } from "@/lib/content/analysis";
import { CALLOUT_VARIANTS, isSafeHref } from "@/lib/content/document";
import { cn } from "@/lib/utils";
import { editorExtensions } from "./extensions";

const e = strings.editor;

/** Pressing keeps focus in the text. Losing it, even briefly, can drop a format chosen just before typing. */
function ToolButton({ icon: Icon, label, isActive, disabled, onClick, testId, iconClassName }: { icon: LucideIcon; label: string; isActive?: boolean; disabled?: boolean; onClick: () => void; testId?: string; iconClassName?: string }) {
  return (
    <Button type="button" variant="ghost" size="icon" title={label} aria-label={label} aria-pressed={isActive} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick} data-testid={testId} className={cn(isActive && "bg-surface-elevated text-brand")}>
      <Icon aria-hidden className={iconClassName} />
    </Button>
  );
}

/** Back to the text, rather than the toolbar button that opened the dialog, so writing can simply continue. */
function returnToEditor(event: Event, editor: Editor) {
  event.preventDefault();
  editor.commands.focus();
}

function LinkDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [href, setHref] = useState<string>(() => (editor.getAttributes("link").href as string | undefined) ?? "");
  const [error, setError] = useState<string | null>(null);

  const apply = (value: string) => {
    const trimmed = value.trim();
    if (!isSafeHref(trimmed)) {
      setError(e.linkInvalid);
      return;
    }
    const { selection } = editor.state;
    // With nothing selected, the link's own address becomes its text.
    if (selection.empty && !editor.isActive("link")) {
      editor.chain().focus().insertContent({ type: "text", text: trimmed, marks: [{ type: "link", attrs: { href: trimmed } }] }).run();
    } else {
      // Moves the cursor past the link, or the next key typed would replace what was just linked.
      editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).setTextSelection(selection.to).run();
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent aria-describedby={undefined} data-testid="link-dialog" onCloseAutoFocus={(event) => returnToEditor(event, editor)}>
        <DialogTitle className="mb-3 text-lg font-semibold">{e.linkTitle}</DialogTitle>
        <form
          noValidate
          className="space-y-3"
          onSubmit={(event) => {
            // The dialog sits inside the article's form in the React tree.
            event.preventDefault();
            event.stopPropagation();
            apply(href);
          }}
        >
          <label className="block space-y-1.5 text-sm font-medium">
            {e.linkLabel}
            <Input value={href} dir="ltr" onChange={(event) => setHref(event.target.value)} placeholder="https://" data-testid="link-input" />
          </label>
          <p className="text-xs text-text-secondary">{e.linkHint}</p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" data-testid="link-apply">
              {e.linkApply}
            </Button>
            {editor.isActive("link") ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
                  onClose();
                }}
              >
                {e.linkRemove}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={onClose}>
              {strings.adminContent.cancel}
            </Button>
          </div>
        </form>
        <div className="mt-4 border-t pt-3">
          <PickerSearch type="ARTICLE" label={strings.adminContent.picker.search} excludeIds={[]} onPick={(item) => item.href && apply(item.href)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FootnoteDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const isEditing = editor.isActive("footnote");
  const [text, setText] = useState<string>(() => (isEditing ? ((editor.getAttributes("footnote").text as string | undefined) ?? "") : ""));

  const apply = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (isEditing) editor.chain().focus().updateAttributes("footnote", { text: trimmed }).run();
    else editor.chain().focus().insertContent({ type: "footnote", attrs: { text: trimmed } }).run();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent aria-describedby={undefined} data-testid="footnote-dialog" onCloseAutoFocus={(event) => returnToEditor(event, editor)}>
        <DialogTitle className="mb-3 text-lg font-semibold">{e.footnoteTitle}</DialogTitle>
        <Textarea value={text} dir="auto" aria-label={e.footnoteTitle} onChange={(event) => setText(event.target.value)} maxLength={2000} data-testid="footnote-input" />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" onClick={apply} disabled={!text.trim()} data-testid="footnote-apply">
            {e.footnoteApply}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {strings.adminContent.cancel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-6 w-px bg-border" />;
}

/**
 * Start and end follow the writing direction. The editor is always Arabic, so the start is on
 * the right, and the icons show where the text will sit.
 */
const ALIGN_TOOLS = [
  { value: "start", label: e.alignStart, icon: AlignRight, testId: "tool-align-start" },
  { value: "center", label: e.alignCenter, icon: AlignCenter, testId: "tool-align-center" },
  { value: "end", label: e.alignEnd, icon: AlignLeft, testId: "tool-align-end" },
  { value: "justify", label: e.alignJustify, icon: AlignJustify, testId: "tool-align-justify" },
] as const;

function CalloutMenu({ editor }: { editor: Editor }) {
  const isActive = editor.isActive("callout");
  return (
    <DropdownMenu dir="rtl" modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" title={e.callout} aria-label={e.callout} aria-pressed={isActive} onMouseDown={(event) => event.preventDefault()} data-testid="tool-callout" className={cn(isActive && "bg-surface-elevated text-brand")}>
          <SquareDashedBottom aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={(event) => returnToEditor(event, editor)}>
        {CALLOUT_VARIANTS.map((variant) => (
          <DropdownMenuItem key={variant} onSelect={() => editor.chain().focus().setCallout(variant).run()} data-testid={`callout-${variant}`}>
            {strings.articles.callouts[variant]}
          </DropdownMenuItem>
        ))}
        {isActive ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => editor.chain().focus().unsetCallout().run()}>{e.calloutRemove}</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TableTools({ editor }: { editor: Editor }) {
  const chain = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label={e.tableTools} className="flex flex-wrap items-center gap-0.5 border-t bg-surface-elevated/50 p-1" data-testid="table-tools">
      <ToolButton icon={Rows3} label={e.addRowAfter} onClick={() => chain().addRowAfter().run()} testId="table-add-row" />
      <ToolButton icon={Columns3} label={e.addColumnAfter} onClick={() => chain().addColumnAfter().run()} testId="table-add-column" />
      <ToolButton icon={PanelTop} label={e.toggleHeaderRow} onClick={() => chain().toggleHeaderRow().run()} testId="table-header-row" />
      <Divider />
      <ToolButton icon={Rows3} label={e.deleteRow} disabled={!editor.can().deleteRow()} onClick={() => chain().deleteRow().run()} testId="table-delete-row" iconClassName="text-destructive" />
      <ToolButton icon={Columns3} label={e.deleteColumn} disabled={!editor.can().deleteColumn()} onClick={() => chain().deleteColumn().run()} testId="table-delete-column" iconClassName="text-destructive" />
      <ToolButton icon={Trash2} label={e.deleteTable} onClick={() => chain().deleteTable().run()} testId="table-delete" iconClassName="text-destructive" />
    </div>
  );
}

/** Appears over selected text, so formatting doesn't need a trip to the toolbar. */
function SelectionMenu({ editor, onLink }: { editor: Editor; onLink: () => void }) {
  return (
    <BubbleMenu editor={editor} options={{ placement: "top" }} shouldShow={({ editor: current, state }) => current.isEditable && !state.selection.empty && !current.isActive("figure")}>
      <div role="toolbar" aria-label={e.formatMenu} className="flex items-center gap-0.5 rounded-xl border bg-surface p-1 shadow-xl" data-testid="selection-menu">
        <ToolButton icon={Bold} label={e.bold} isActive={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolButton icon={Italic} label={e.italic} isActive={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <ToolButton icon={Underline} label={e.underline} isActive={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} />
        <ToolButton icon={Highlighter} label={e.highlight} isActive={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()} />
        <ToolButton icon={Link2} label={e.link} isActive={editor.isActive("link")} onClick={onLink} />
      </div>
    </BubbleMenu>
  );
}

function WordCount({ editor }: { editor: Editor }) {
  const words = (editor.storage.characterCount as { words: () => number }).words();
  return (
    <p className="flex justify-end gap-3 border-t px-3 py-1.5 text-xs text-text-secondary tabular-nums" data-testid="editor-word-count">
      <span>{e.words(words)}</span>
      {words ? <span>{e.readingTime(computeReadingMinutes(editor.getText()))}</span> : null}
    </p>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const [dialog, setDialog] = useState<"link" | "footnote" | null>(null);
  const [imageMessage, setImageMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImage = async (file: File | undefined) => {
    if (!file) return;
    setIsUploading(true);
    setImageMessage(null);
    const result = await uploadImageFile(file);
    if (result.ok) editor.chain().focus().insertContent({ type: "figure", attrs: { src: result.image.url, width: result.image.width, height: result.image.height, alt: "", caption: "" } }).run();
    else setImageMessage(result.message);
    setIsUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const chain = () => editor.chain().focus();

  return (
    <div className="sticky top-0 z-10 border-b bg-surface">
      <div role="toolbar" aria-label={e.toolbarLabel} className="flex flex-wrap items-center gap-0.5 p-1" data-testid="editor-toolbar">
        <ToolButton icon={Heading2} label={e.heading2} isActive={editor.isActive("heading", { level: 2 })} onClick={() => chain().toggleHeading({ level: 2 }).run()} testId="tool-h2" />
        <ToolButton icon={Heading3} label={e.heading3} isActive={editor.isActive("heading", { level: 3 })} onClick={() => chain().toggleHeading({ level: 3 }).run()} testId="tool-h3" />
        <ToolButton icon={Heading4} label={e.heading4} isActive={editor.isActive("heading", { level: 4 })} onClick={() => chain().toggleHeading({ level: 4 }).run()} testId="tool-h4" />
        <Divider />
        <ToolButton icon={Bold} label={e.bold} isActive={editor.isActive("bold")} onClick={() => chain().toggleBold().run()} testId="tool-bold" />
        <ToolButton icon={Italic} label={e.italic} isActive={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()} testId="tool-italic" />
        <ToolButton icon={Underline} label={e.underline} isActive={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()} testId="tool-underline" />
        <ToolButton icon={Strikethrough} label={e.strike} isActive={editor.isActive("strike")} onClick={() => chain().toggleStrike().run()} testId="tool-strike" />
        <ToolButton icon={Highlighter} label={e.highlight} isActive={editor.isActive("highlight")} onClick={() => chain().toggleHighlight().run()} testId="tool-highlight" />
        <Divider />
        {ALIGN_TOOLS.map((tool) => (
          <ToolButton
            key={tool.value}
            icon={tool.icon}
            label={tool.label}
            isActive={tool.value === "start" ? !ALIGN_TOOLS.some((other) => other.value !== "start" && editor.isActive({ textAlign: other.value })) : editor.isActive({ textAlign: tool.value })}
            onClick={() => (tool.value === "start" ? chain().unsetTextAlign().run() : chain().setTextAlign(tool.value).run())}
            testId={tool.testId}
          />
        ))}
        <Divider />
        <ToolButton icon={List} label={e.bulletList} isActive={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()} testId="tool-bullet" />
        <ToolButton icon={ListOrdered} label={e.orderedList} isActive={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()} testId="tool-ordered" />
        <ToolButton icon={Quote} label={e.quote} isActive={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()} testId="tool-quote" />
        <CalloutMenu editor={editor} />
        <ToolButton icon={Table2} label={e.table} disabled={editor.isActive("table")} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} testId="tool-table" />
        <ToolButton icon={Minus} label={e.divider} onClick={() => chain().setHorizontalRule().run()} testId="tool-divider" />
        <Divider />
        <ToolButton icon={Link2} label={e.link} isActive={editor.isActive("link")} onClick={() => setDialog("link")} testId="tool-link" />
        <ToolButton icon={ImagePlus} label={e.image} disabled={isUploading} onClick={() => fileRef.current?.click()} testId="tool-image" />
        <ToolButton icon={NotebookPen} label={e.footnote} isActive={editor.isActive("footnote")} onClick={() => setDialog("footnote")} testId="tool-footnote" />
        <Divider />
        <ToolButton icon={Undo2} label={e.undo} disabled={!editor.can().undo()} onClick={() => chain().undo().run()} testId="tool-undo" />
        <ToolButton icon={Redo2} label={e.redo} disabled={!editor.can().redo()} onClick={() => chain().redo().run()} testId="tool-redo" />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label={e.image} onChange={(event) => handleImage(event.target.files?.[0])} data-testid="editor-image-input" />
      </div>
      {editor.isActive("table") ? <TableTools editor={editor} /> : null}
      {imageMessage || isUploading ? (
        <p role={imageMessage ? "alert" : "status"} className={cn("px-3 pb-2 text-sm", imageMessage ? "text-destructive" : "text-text-secondary")} data-testid="editor-image-message">
          {imageMessage ?? strings.uploads.uploading}
        </p>
      ) : null}

      <SelectionMenu editor={editor} onLink={() => setDialog("link")} />
      {dialog === "link" ? <LinkDialog editor={editor} onClose={() => setDialog(null)} /> : null}
      {dialog === "footnote" ? <FootnoteDialog editor={editor} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

/** The only entry point for rich text. Its output is checked against the allow-list again on the server. */
export function RichTextEditor({ initialContent, onChange, label }: { initialContent: JSONContent; onChange: (content: JSONContent) => void; label: string }) {
  const editor = useEditor({
    extensions: editorExtensions,
    content: initialContent,
    // The page is rendered on the server first, where there's no document to attach to.
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { class: "prose-article tiptap-editor min-h-80 p-4 outline-none", dir: "rtl", "aria-label": label, "data-testid": "editor-content" } },
    onUpdate: ({ editor: current }) => onChange(current.getJSON()),
  });

  return (
    <div className="rounded-xl border focus-within:ring-3 focus-within:ring-ring/50" data-testid="rich-text-editor">
      {editor ? <Toolbar editor={editor} /> : <div className="h-12 border-b" />}
      <EditorContent editor={editor} />
      {editor ? <WordCount editor={editor} /> : null}
    </div>
  );
}
