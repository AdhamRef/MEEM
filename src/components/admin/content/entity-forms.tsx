"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, type UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { strings } from "@/config/strings.ar";
import type { PickerItem } from "@/features/relationships/picker.service";
import type { ActionResult } from "@/lib/http/action";
import { isValidSlug } from "@/lib/slug";
import { zodResolver } from "@/lib/validation/zod-resolver";
import { ContentPicker } from "./content-picker";
import { FormField } from "./form-field";
import { ImageField } from "./image-field";

const c = strings.adminContent;

const requiredText = (max: number) => z.string().trim().min(1, c.required).max(max, c.tooLong);
const optionalInput = (max: number) => z.string().trim().max(max, c.tooLong);
const slugInput = z.string().trim().refine((value) => value === "" || isValidSlug(value), c.invalidSlug);
const orderInput = z.string().trim().regex(/^\d{0,6}$/, c.invalidNumber);

const blankToNull = (value: string) => value.trim() || null;

interface SaveOutcome {
  id: string;
}

function useFormSubmit(basePath: string, id: string | undefined) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const handle = (result: ActionResult<SaveOutcome>) => {
    setIsError(!result.ok);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(c.saved);
    if (id) router.refresh();
    else router.push(`${basePath}/${result.data.id}`);
  };
  return { message, isError, handle };
}

function SubmitRow({ isSubmitting, message, isError, disabled }: { isSubmitting: boolean; message: string | null; isError: boolean; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={isSubmitting || disabled} data-testid="form-save">
        {isSubmitting ? c.saving : c.save}
      </Button>
      {message ? (
        <p role={isError ? "alert" : "status"} className={isError ? "text-sm text-destructive" : "text-sm text-text-secondary"} data-testid="form-message">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function TextField({ label, hint, error, registration, disabled }: { label: string; hint?: string; error?: string; registration: UseFormRegisterReturn; disabled?: boolean }) {
  return (
    <FormField label={label} hint={hint} error={error}>
      <Input {...registration} disabled={disabled} dir="auto" />
    </FormField>
  );
}

function AreaField({ label, error, registration, disabled, rows = 3 }: { label: string; error?: string; registration: UseFormRegisterReturn; disabled?: boolean; rows?: number }) {
  return (
    <FormField label={label} error={error}>
      <Textarea {...registration} disabled={disabled} rows={rows} dir="auto" />
    </FormField>
  );
}

// ---------------------------------------------------------------------------
// Topic
// ---------------------------------------------------------------------------

const topicFormSchema = z.object({
  title: requiredText(120),
  slug: slugInput,
  introduction: optionalInput(1000),
  description: optionalInput(5000),
  coverImage: z.string().nullable(),
  isFeatured: z.boolean(),
  displayOrder: orderInput,
});
type TopicFormValues = z.infer<typeof topicFormSchema>;

export interface TopicFormProps {
  id?: string;
  isPublished: boolean;
  canEdit: boolean;
  initial: { title: string; slug: string; introduction: string | null; description: string | null; coverImage: string | null; isFeatured: boolean; displayOrder: number; parent: PickerItem | null };
  onSave: (input: unknown) => Promise<ActionResult<SaveOutcome>>;
}

export function TopicForm({ id, isPublished, canEdit, initial, onSave }: TopicFormProps) {
  const form = useForm<TopicFormValues>({
    resolver: zodResolver(topicFormSchema),
    defaultValues: {
      title: initial.title,
      slug: initial.slug,
      introduction: initial.introduction ?? "",
      description: initial.description ?? "",
      coverImage: initial.coverImage,
      isFeatured: initial.isFeatured,
      displayOrder: String(initial.displayOrder),
    },
  });
  const [parent, setParent] = useState<PickerItem[]>(initial.parent ? [initial.parent] : []);
  const submit = useFormSubmit("/admin/topics", id);
  const { errors, isSubmitting } = form.formState;

  return (
    <form
      noValidate
      className="space-y-4 rounded-xl border bg-surface p-4"
      data-testid="topic-form"
      onSubmit={form.handleSubmit(async (values) => {
        submit.handle(
          await onSave({
            title: values.title,
            ...(blankToNull(values.slug) ? { slug: values.slug.trim() } : {}),
            introduction: blankToNull(values.introduction),
            description: blankToNull(values.description),
            coverImage: values.coverImage,
            parentId: parent[0]?.id ?? null,
            isFeatured: values.isFeatured,
            displayOrder: Number(values.displayOrder || 0),
          }),
        );
      })}
    >
      <TextField label={c.title} registration={form.register("title")} error={errors.title?.message} disabled={!canEdit} />
      <TextField label={c.slug} hint={isPublished ? c.slugLockedHint : c.slugHint} registration={form.register("slug")} error={errors.slug?.message} disabled={!canEdit || isPublished} />
      <AreaField label={c.introduction} registration={form.register("introduction")} error={errors.introduction?.message} disabled={!canEdit} />
      <AreaField label={c.description} rows={6} registration={form.register("description")} error={errors.description?.message} disabled={!canEdit} />
      <Controller control={form.control} name="coverImage" render={({ field }) => <ImageField label={c.cover} value={field.value} onChange={field.onChange} disabled={!canEdit} />} />
      <ContentPicker label={c.parentTopic} type="TOPIC" single value={parent} onChange={setParent} excludeId={id} disabled={!canEdit} />
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" {...form.register("isFeatured")} disabled={!canEdit} className="size-4" />
        {c.featured}
      </label>
      <TextField label={c.displayOrder} hint={c.displayOrderHint} registration={form.register("displayOrder")} error={errors.displayOrder?.message} disabled={!canEdit} />
      {canEdit ? <SubmitRow isSubmitting={isSubmitting} message={submit.message} isError={submit.isError} /> : <p className="text-sm text-text-secondary">{c.noPermission}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

const libraryFormSchema = z.object({
  name: requiredText(120),
  slug: slugInput,
  description: optionalInput(1000),
  introduction: optionalInput(5000),
  coverImage: z.string().nullable(),
  isFeatured: z.boolean(),
  displayOrder: orderInput,
});
type LibraryFormValues = z.infer<typeof libraryFormSchema>;

export interface LibraryFormProps {
  id?: string;
  isPublished: boolean;
  canEdit: boolean;
  initial: { name: string; slug: string; description: string | null; introduction: string | null; coverImage: string | null; isFeatured: boolean; displayOrder: number; parent: PickerItem | null };
  onSave: (input: unknown) => Promise<ActionResult<SaveOutcome>>;
}

export function LibraryForm({ id, isPublished, canEdit, initial, onSave }: LibraryFormProps) {
  const form = useForm<LibraryFormValues>({
    resolver: zodResolver(libraryFormSchema),
    defaultValues: {
      name: initial.name,
      slug: initial.slug,
      description: initial.description ?? "",
      introduction: initial.introduction ?? "",
      coverImage: initial.coverImage,
      isFeatured: initial.isFeatured,
      displayOrder: String(initial.displayOrder),
    },
  });
  const [parent, setParent] = useState<PickerItem[]>(initial.parent ? [initial.parent] : []);
  const submit = useFormSubmit("/admin/libraries", id);
  const { errors, isSubmitting } = form.formState;

  return (
    <form
      noValidate
      className="space-y-4 rounded-xl border bg-surface p-4"
      data-testid="library-form"
      onSubmit={form.handleSubmit(async (values) => {
        submit.handle(
          await onSave({
            name: values.name,
            ...(blankToNull(values.slug) ? { slug: values.slug.trim() } : {}),
            description: blankToNull(values.description),
            introduction: blankToNull(values.introduction),
            coverImage: values.coverImage,
            parentId: parent[0]?.id ?? null,
            isFeatured: values.isFeatured,
            displayOrder: Number(values.displayOrder || 0),
          }),
        );
      })}
    >
      <TextField label={c.name} registration={form.register("name")} error={errors.name?.message} disabled={!canEdit} />
      <TextField label={c.slug} hint={isPublished ? c.slugLockedHint : c.slugHint} registration={form.register("slug")} error={errors.slug?.message} disabled={!canEdit || isPublished} />
      <AreaField label={c.description} registration={form.register("description")} error={errors.description?.message} disabled={!canEdit} />
      <AreaField label={c.introduction} rows={6} registration={form.register("introduction")} error={errors.introduction?.message} disabled={!canEdit} />
      <Controller control={form.control} name="coverImage" render={({ field }) => <ImageField label={c.cover} value={field.value} onChange={field.onChange} disabled={!canEdit} />} />
      <ContentPicker label={c.parentLibrary} type="LIBRARY" single value={parent} onChange={setParent} excludeId={id} disabled={!canEdit} />
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" {...form.register("isFeatured")} disabled={!canEdit} className="size-4" />
        {c.featured}
      </label>
      <TextField label={c.displayOrder} hint={c.displayOrderHint} registration={form.register("displayOrder")} error={errors.displayOrder?.message} disabled={!canEdit} />
      {canEdit ? <SubmitRow isSubmitting={isSubmitting} message={submit.message} isError={submit.isError} /> : <p className="text-sm text-text-secondary">{c.noPermission}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// External resource
// ---------------------------------------------------------------------------

const resourceFormSchema = z.object({
  title: requiredText(200),
  slug: slugInput,
  sourceName: requiredText(120),
  url: z.url({ protocol: /^https?$/, error: c.invalidUrl }),
  description: optionalInput(2000),
  coverImage: z.string().nullable(),
});
type ResourceFormValues = z.infer<typeof resourceFormSchema>;

export interface ResourceFormProps {
  id?: string;
  isPublished: boolean;
  canEdit: boolean;
  initial: { title: string; slug: string; sourceName: string; url: string; description: string | null; coverImage: string | null };
  onSave: (input: unknown) => Promise<ActionResult<SaveOutcome>>;
}

export function ResourceForm({ id, isPublished, canEdit, initial, onSave }: ResourceFormProps) {
  const form = useForm<ResourceFormValues>({
    resolver: zodResolver(resourceFormSchema),
    defaultValues: { title: initial.title, slug: initial.slug, sourceName: initial.sourceName, url: initial.url, description: initial.description ?? "", coverImage: initial.coverImage },
  });
  const submit = useFormSubmit("/admin/resources", id);
  const { errors, isSubmitting } = form.formState;

  return (
    <form
      noValidate
      className="space-y-4 rounded-xl border bg-surface p-4"
      data-testid="resource-form"
      onSubmit={form.handleSubmit(async (values) => {
        submit.handle(
          await onSave({
            title: values.title,
            ...(blankToNull(values.slug) ? { slug: values.slug.trim() } : {}),
            sourceName: values.sourceName,
            url: values.url,
            description: blankToNull(values.description),
            coverImage: values.coverImage,
          }),
        );
      })}
    >
      <p className="text-sm text-text-secondary">{c.copyrightNote}</p>
      <TextField label={c.title} registration={form.register("title")} error={errors.title?.message} disabled={!canEdit} />
      <TextField label={c.slug} hint={isPublished ? c.slugLockedHint : c.slugHint} registration={form.register("slug")} error={errors.slug?.message} disabled={!canEdit || isPublished} />
      <TextField label={c.sourceName} registration={form.register("sourceName")} error={errors.sourceName?.message} disabled={!canEdit} />
      <FormField label={c.url} error={errors.url?.message}>
        <Input {...form.register("url")} type="url" dir="ltr" placeholder="https://" disabled={!canEdit} />
      </FormField>
      <AreaField label={c.description} rows={5} registration={form.register("description")} error={errors.description?.message} disabled={!canEdit} />
      <Controller control={form.control} name="coverImage" render={({ field }) => <ImageField label={c.cover} value={field.value} onChange={field.onChange} disabled={!canEdit} />} />
      {canEdit ? <SubmitRow isSubmitting={isSubmitting} message={submit.message} isError={submit.isError} /> : <p className="text-sm text-text-secondary">{c.noPermission}</p>}
    </form>
  );
}
