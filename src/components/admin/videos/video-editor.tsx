"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ContentPicker } from "@/components/admin/content/content-picker";
import { selectClass } from "@/components/admin/content/list-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { strings } from "@/config/strings.ar";
import type { PickerItem, PickerType } from "@/features/relationships/picker.service";
import type { ActionResult } from "@/lib/http/action";

const v = strings.videosAdmin;

const CTA_TARGETS: Record<string, PickerType | null> = {
  "": null,
  INTERNAL_ARTICLE: "ARTICLE",
  TOPIC: "TOPIC",
  FULL_VIDEO: "VIDEO",
  CURATED_PLAYLIST: "PLAYLIST",
  YOUTUBE_PLAYLIST: "PLAYLIST",
  EXTERNAL_RESOURCE: null,
};

interface VideoEditorProps {
  id: string;
  canEdit: boolean;
  categories: { id: string; title: string }[];
  initial: { kind: "SHORT" | "LONG_FORM"; categoryId: string | null; ctaType: string; ctaLabel: string; ctaUrl: string; ctaTarget: PickerItem | null };
  onSave: (input: unknown) => Promise<ActionResult<undefined>>;
}

/** YouTube's own details are read-only. Only what editors add is here: kind, category, and CTA. */
export function VideoEditor({ id, canEdit, categories, initial, onSave }: VideoEditorProps) {
  const router = useRouter();
  const [kind, setKind] = useState(initial.kind);
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? "");
  const [ctaType, setCtaType] = useState(initial.ctaType);
  const [ctaLabel, setCtaLabel] = useState(initial.ctaLabel);
  const [ctaUrl, setCtaUrl] = useState(initial.ctaUrl);
  const [ctaTarget, setCtaTarget] = useState<PickerItem[]>(initial.ctaTarget ? [initial.ctaTarget] : []);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const targetType = CTA_TARGETS[ctaType] ?? null;
  const isExternal = ctaType === "EXTERNAL_RESOURCE";
  const isCtaIncomplete = (targetType !== null && ctaTarget.length === 0) || (isExternal && !ctaUrl.trim());

  const save = async () => {
    setIsBusy(true);
    setMessage(null);
    const label = ctaLabel.trim() || null;
    const cta = !ctaType ? null : isExternal ? { type: ctaType, label, externalUrl: ctaUrl.trim() } : { type: ctaType, label, targetId: ctaTarget[0]?.id };
    const result = await onSave({ kind, categoryId: categoryId || null, cta });
    setIsBusy(false);
    setMessage(result.ok ? { text: strings.adminContent.saved, isError: false } : { text: result.message, isError: true });
    if (result.ok) router.refresh();
  };

  return (
    <section className="space-y-4 rounded-xl border bg-surface p-4" data-testid="video-editor" data-video={id}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium">
          {v.kind}
          <select value={kind} disabled={!canEdit} onChange={(event) => setKind(event.target.value as "SHORT" | "LONG_FORM")} className={selectClass} data-testid="video-kind">
            <option value="SHORT">{strings.content.short}</option>
            <option value="LONG_FORM">{strings.content.longVideo}</option>
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          {strings.adminContent.category}
          <select value={categoryId} disabled={!canEdit} onChange={(event) => setCategoryId(event.target.value)} className={selectClass} data-testid="video-category">
            <option value="">{strings.adminContent.noCategory}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-text-secondary">{v.reviewHint}</p>

      <div className="space-y-3 border-t pt-3">
        <h2 className="font-semibold">{v.ctaTitle}</h2>
        <label className="block space-y-1.5 text-sm font-medium">
          {v.ctaType}
          <select
            value={ctaType}
            disabled={!canEdit}
            onChange={(event) => {
              setCtaType(event.target.value);
              setCtaTarget([]);
            }}
            className={selectClass}
            data-testid="cta-type"
          >
            <option value="">{v.ctaNone}</option>
            {Object.entries(v.ctaTypes).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {targetType ? <ContentPicker key={ctaType} label={v.ctaTarget} type={targetType} single value={ctaTarget} onChange={setCtaTarget} excludeId={targetType === "VIDEO" ? id : undefined} disabled={!canEdit} /> : null}
        {isExternal ? (
          <label className="block space-y-1.5 text-sm font-medium">
            {strings.adminContent.url}
            <Input value={ctaUrl} dir="ltr" type="url" placeholder="https://" disabled={!canEdit} onChange={(event) => setCtaUrl(event.target.value)} data-testid="cta-url" />
          </label>
        ) : null}
        {ctaType ? (
          <label className="block space-y-1.5 text-sm font-medium">
            {v.ctaLabel}
            <Input value={ctaLabel} dir="auto" maxLength={60} disabled={!canEdit} onChange={(event) => setCtaLabel(event.target.value)} data-testid="cta-label" />
          </label>
        ) : null}
      </div>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={isBusy || isCtaIncomplete} onClick={save} data-testid="video-save">
            {isBusy ? strings.adminContent.saving : strings.adminContent.save}
          </Button>
          {message ? (
            <p role={message.isError ? "alert" : "status"} className={message.isError ? "text-sm text-destructive" : "text-sm text-text-secondary"} data-testid="video-message">
              {message.text}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-text-secondary">{strings.adminContent.noPermission}</p>
      )}
    </section>
  );
}
