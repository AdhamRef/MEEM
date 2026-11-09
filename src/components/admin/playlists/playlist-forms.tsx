"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { FormField } from "@/components/admin/content/form-field";
import { ImageField } from "@/components/admin/content/image-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { strings } from "@/config/strings.ar";
import type { ActionResult } from "@/lib/http/action";
import { isValidSlug } from "@/lib/slug";
import { zodResolver } from "@/lib/validation/zod-resolver";

const c = strings.adminContent;
const p = strings.playlists;

const slugInput = z.string().trim().refine((value) => value === "" || isValidSlug(value), c.invalidSlug);

const curatedSchema = z.object({
  title: z.string().trim().min(1, c.required).max(200, c.tooLong),
  slug: slugInput,
  description: z.string().trim().max(2000, c.tooLong),
  introduction: z.string().trim().max(5000, c.tooLong),
  coverImage: z.string().nullable(),
  isFeatured: z.boolean(),
});
type CuratedValues = z.infer<typeof curatedSchema>;

function Feedback({ message, isError }: { message: string | null; isError: boolean }) {
  if (!message) return null;
  return (
    <p role={isError ? "alert" : "status"} className={isError ? "text-sm text-destructive" : "text-sm text-text-secondary"} data-testid="form-message">
      {message}
    </p>
  );
}

interface CuratedFormProps {
  id?: string;
  isPublished: boolean;
  canEdit: boolean;
  initial: { title: string; slug: string; description: string | null; introduction: string | null; coverImage: string | null; isFeatured: boolean };
  onSave: (input: unknown) => Promise<ActionResult<{ id: string }>>;
}

export function CuratedPlaylistForm({ id, isPublished, canEdit, initial, onSave }: CuratedFormProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<{ text: string; isError: boolean } | null>(null);
  const form = useForm<CuratedValues>({
    resolver: zodResolver(curatedSchema),
    defaultValues: { title: initial.title, slug: initial.slug, description: initial.description ?? "", introduction: initial.introduction ?? "", coverImage: initial.coverImage, isFeatured: initial.isFeatured },
  });
  const { errors, isSubmitting } = form.formState;

  const save = async (values: CuratedValues) => {
    const result = await onSave({
      title: values.title,
      ...(values.slug ? { slug: values.slug } : {}),
      description: values.description || null,
      introduction: values.introduction || null,
      coverImage: values.coverImage,
      isFeatured: values.isFeatured,
    });
    if (!result.ok) {
      setFeedback({ text: result.message, isError: true });
      return;
    }
    setFeedback({ text: c.saved, isError: false });
    if (id) router.refresh();
    else router.push(`/admin/playlists/${result.data.id}`);
  };

  return (
    <form noValidate onSubmit={(event) => void form.handleSubmit(save)(event)} className="space-y-4 rounded-xl border bg-surface p-4" data-testid="curated-form">
      <FormField label={c.title} error={errors.title?.message}>
        <Input {...form.register("title")} dir="auto" disabled={!canEdit} />
      </FormField>
      <FormField label={c.slug} hint={isPublished ? c.slugLockedHint : c.slugHint} error={errors.slug?.message}>
        <Input {...form.register("slug")} dir="auto" disabled={!canEdit || isPublished} />
      </FormField>
      <FormField label={c.introduction} error={errors.introduction?.message}>
        <Textarea {...form.register("introduction")} dir="auto" rows={4} disabled={!canEdit} />
      </FormField>
      <FormField label={c.description} error={errors.description?.message}>
        <Textarea {...form.register("description")} dir="auto" rows={3} disabled={!canEdit} />
      </FormField>
      <Controller control={form.control} name="coverImage" render={({ field }) => <ImageField label={c.cover} value={field.value} onChange={field.onChange} disabled={!canEdit} />} />
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" {...form.register("isFeatured")} disabled={!canEdit} className="size-4" />
        {c.featured}
      </label>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={isSubmitting} data-testid="form-save">
            {isSubmitting ? c.saving : c.save}
          </Button>
          <Feedback message={feedback?.text ?? null} isError={feedback?.isError ?? false} />
        </div>
      ) : (
        <p className="text-sm text-text-secondary">{c.noPermission}</p>
      )}
    </form>
  );
}

const youtubeSchema = z.object({ slug: slugInput, introduction: z.string().trim().max(5000, c.tooLong), isFeatured: z.boolean() });
type YouTubeValues = z.infer<typeof youtubeSchema>;

interface YouTubeFormProps {
  isPublished: boolean;
  canEdit: boolean;
  canSync: boolean;
  syncStatus: "NOT_APPLICABLE" | "PENDING" | "SYNCED" | "FAILED";
  metadataFetchedAt: string | null;
  initial: { title: string; slug: string; description: string | null; channelTitle: string | null; youtubePlaylistId: string; introduction: string | null; isFeatured: boolean };
  onSave: (input: unknown) => Promise<ActionResult<{ id: string }>>;
  onSync: () => Promise<ActionResult<{ outcome: string; itemCount: number; isTruncated: boolean }>>;
}

/** YouTube's title and description are shown but can't be edited, as its policies require (§6.3). */
export function YouTubePlaylistForm({ isPublished, canEdit, canSync, syncStatus, metadataFetchedAt, initial, onSave, onSync }: YouTubeFormProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<{ text: string; isError: boolean } | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<{ text: string; isError: boolean } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const form = useForm<YouTubeValues>({
    resolver: zodResolver(youtubeSchema),
    defaultValues: { slug: initial.slug, introduction: initial.introduction ?? "", isFeatured: initial.isFeatured },
  });
  const { errors, isSubmitting } = form.formState;

  const save = async (values: YouTubeValues) => {
    const result = await onSave({
      ...(values.slug ? { slug: values.slug } : {}),
      introduction: values.introduction || null,
      isFeatured: values.isFeatured,
    });
    setFeedback(result.ok ? { text: c.saved, isError: false } : { text: result.message, isError: true });
    if (result.ok) router.refresh();
  };

  const sync = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    const result = await onSync();
    setIsSyncing(false);
    if (!result.ok) {
      setSyncFeedback({ text: result.message, isError: true });
      return;
    }
    const text = result.data.outcome === "REMOVED_FROM_YOUTUBE" ? p.removedFromYouTube : `${p.syncDone} ${p.itemCount(result.data.itemCount)}${result.data.isTruncated ? ` ${p.truncated}` : ""}`;
    setSyncFeedback({ text, isError: false });
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-xl border bg-surface p-4" data-testid="youtube-details">
        <h2 className="font-semibold">{p.youtubeDetails}</h2>
        <dl className="space-y-1 text-sm">
          <div>
            <dt className="inline text-text-secondary">{c.title}: </dt>
            <dd className="inline">
              <bdi>{initial.title || p.dataWithdrawnShort}</bdi>
            </dd>
          </div>
          {initial.channelTitle ? (
            <div>
              <dt className="inline text-text-secondary">{p.channel}: </dt>
              <dd className="inline">
                <bdi>{initial.channelTitle}</bdi>
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="inline text-text-secondary">{p.syncStatusLabel}: </dt>
            <dd className="inline" data-testid="sync-status">
              {p.syncStatus[syncStatus]}
              {metadataFetchedAt ? ` · ${new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(metadataFetchedAt))}` : ""}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-text-secondary">{p.youtubeLocked}</p>
        {canSync ? (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="button" variant="secondary" disabled={isSyncing} onClick={sync} data-testid="sync-now">
              <RefreshCw aria-hidden data-icon="inline-start" />
              {isSyncing ? p.syncing : p.syncNow}
            </Button>
            {syncFeedback ? (
              <p role={syncFeedback.isError ? "alert" : "status"} className={syncFeedback.isError ? "text-sm text-destructive" : "text-sm text-text-secondary"} data-testid="sync-message">
                {syncFeedback.text}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <form noValidate onSubmit={(event) => void form.handleSubmit(save)(event)} className="space-y-4 rounded-xl border bg-surface p-4" data-testid="youtube-form">
        <FormField label={c.slug} hint={isPublished ? c.slugLockedHint : c.slugHint} error={errors.slug?.message}>
          <Input {...form.register("slug")} dir="auto" disabled={!canEdit || isPublished} />
        </FormField>
        <FormField label={p.ownIntroduction} hint={p.ownIntroductionHint} error={errors.introduction?.message}>
          <Textarea {...form.register("introduction")} dir="auto" rows={4} disabled={!canEdit} />
        </FormField>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" {...form.register("isFeatured")} disabled={!canEdit} className="size-4" />
          {c.featured}
        </label>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={isSubmitting} data-testid="form-save">
              {isSubmitting ? c.saving : c.save}
            </Button>
            <Feedback message={feedback?.text ?? null} isError={feedback?.isError ?? false} />
          </div>
        ) : null}
      </form>
    </div>
  );
}

/** Explains why it's unavailable rather than offering something that would only fail. */
export function ImportPlaylistForm({ isConfigured, canImport, onImport }: { isConfigured: boolean; canImport: boolean; onImport: (input: unknown) => Promise<ActionResult<{ id: string }>> }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = !canImport ? p.importNoPermission : !isConfigured ? p.apiNotConfigured : null;

  const submit = async () => {
    setIsBusy(true);
    setError(null);
    const result = await onImport({ url });
    setIsBusy(false);
    if (result.ok) router.push(`/admin/playlists/${result.data.id}`);
    else setError(result.message);
  };

  return (
    <section className="space-y-3 rounded-xl border bg-surface p-4" data-testid="import-form">
      <div>
        <h2 className="font-semibold">{p.importTitle}</h2>
        <p className="text-sm text-text-secondary">{p.importDescription}</p>
      </div>
      {reason ? (
        <p className="text-sm text-text-secondary" data-testid="import-unavailable">
          {reason}
        </p>
      ) : (
        <form
          noValidate
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <FormField label={p.playlistUrl} error={error ?? undefined}>
            <Input value={url} dir="ltr" placeholder="https://www.youtube.com/playlist?list=" onChange={(event) => setUrl(event.target.value)} data-testid="import-url" />
          </FormField>
          <Button type="submit" disabled={isBusy || !url.trim()} data-testid="import-submit">
            {isBusy ? p.importing : p.importAction}
          </Button>
        </form>
      )}
    </section>
  );
}
