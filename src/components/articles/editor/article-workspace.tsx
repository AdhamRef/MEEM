"use client";

import { useState } from "react";
import { StatusActions, type StatusActionsProps } from "@/components/admin/content/status-actions";
import { strings } from "@/config/strings.ar";
import { ArticleEditor, type ArticleEditorProps } from "./article-editor";

/** Holds what the editor and its publish button share: publishing must wait for unsaved changes. */
export function ArticleWorkspace({ editor, actions }: { editor: ArticleEditorProps; actions: Omit<StatusActionsProps, "hasUnsavedChanges"> }) {
  const [isDirty, setIsDirty] = useState(false);

  return (
    <div className="space-y-5">
      <StatusActions {...actions} hasUnsavedChanges={isDirty} />
      {isDirty && actions.canPublish && actions.status === "DRAFT" ? <p className="text-xs text-text-secondary">{strings.adminContent.unsaved}</p> : null}
      <ArticleEditor {...editor} onDirtyChange={setIsDirty} />
    </div>
  );
}
