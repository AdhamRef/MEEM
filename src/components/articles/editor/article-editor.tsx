"use client";

import type { JSONContent } from "@tiptap/react";
import { Eye, PenLine, Plus, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { ContentPicker, PickerSearch } from "@/components/admin/content/content-picker";
import { FormField, FormSection } from "@/components/admin/content/form-field";
import { ImageField } from "@/components/admin/content/image-field";
import { selectClass } from "@/components/admin/content/list-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { strings } from "@/config/strings.ar";
import type { PickerItem } from "@/features/relationships/picker.service";
import { RELATION_TARGETS } from "@/features/relationships/content-relations";
import { ArticleBody } from "@/lib/content/content-renderer";
import type { ActionResult } from "@/lib/http/action";
import { isValidSlug } from "@/lib/slug";
import { zodResolver } from "@/lib/validation/zod-resolver";

const e = strings.editor;
const c = strings.adminContent;

// Heavy, and needed only on this screen, so it stays out of every other dashboard page.
const RichTextEditor = dynamic(() => import("./rich-text-editor").then((module) => module.RichTextEditor), {
  ssr: false,
  loading: () => <div className="min-h-96 animate-pulse rounded-xl border bg-surface" />,
});

const httpUrl = z.union([z.literal(""), z.url({ protocol: /^https?$/, error: c.invalidUrl })]);

const formSchema = z.object({
  title: z.string().trim().min(1, c.required).max(200, c.tooLong),
  slug: z.string().trim().refine((value) => value === "" || isValidSlug(value), c.invalidSlug),
  excerpt: z.string().trim().max(500, c.tooLong),
  coverImage: z.string().nullable(),
  coverCaption: z.string().trim().max(300, c.tooLong),
  bylineName: z.string().trim().max(120, c.tooLong),
  seoTitle: z.string().trim().max(120, c.tooLong),
  seoDescription: z.string().trim().max(300, c.tooLong),
  sources: z.array(z.object({ title: z.string().trim().min(1, c.required).max(300, c.tooLong), author: z.string().trim().max(200, c.tooLong), url: httpUrl, note: z.string().trim().max(500, c.tooLong) })),
});
type FormValues = z.infer<typeof formSchema>;

const RELATION_TYPES = Object.keys(RELATION_TARGETS) as (keyof typeof RELATION_TARGETS)[];
type RelationType = (typeof RELATION_TYPES)[number];
type RelationTarget = "ARTICLE" | "TOPIC" | "RESOURCE";

export interface RelationValue {
  relationType: RelationType;
  targetType: RelationTarget;
  targetId: string;
  label: string;
  note: string | null;
}

export interface ArticleEditorProps {
  id?: string;
  status: "DRAFT" | "PUBLISHED";
  canAssign: boolean;
  initial: {
    title: string;
    slug: string;
    excerpt: string | null;
    coverImage: string | null;
    coverCaption: string | null;
    bylineName: string | null;
    seoTitle: string | null;
    seoDescription: string | null;
    sources: { title: string; author: string | null; url: string | null; note: string | null }[];
    body: unknown;
    topics: PickerItem[];
    libraries: PickerItem[];
    videos: PickerItem[];
    playlists: PickerItem[];
    relations: RelationValue[];
    assignees: PickerItem[];
  };
  onSave: (input: unknown) => Promise<ActionResult<{ id: string }>>;
  onDirtyChange?: (isDirty: boolean) => void;
}

export function ArticleEditor({ id, status, canAssign, initial, onSave, onDirtyChange }: ArticleEditorProps) {
  const router = useRouter();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: initial.title,
      slug: initial.slug,
      excerpt: initial.excerpt ?? "",
      coverImage: initial.coverImage,
      coverCaption: initial.coverCaption ?? "",
      bylineName: initial.bylineName ?? "",
      seoTitle: initial.seoTitle ?? "",
      seoDescription: initial.seoDescription ?? "",
      sources: initial.sources.map((source) => ({ title: source.title, author: source.author ?? "", url: source.url ?? "", note: source.note ?? "" })),
    },
  });
  const sources = useFieldArray({ control: form.control, name: "sources" });
  const { errors, isSubmitting, isDirty: isFormDirty } = form.formState;

  const [tab, setTab] = useState<"write" | "preview">("write");
  const bodyRef = useRef<unknown>(initial.body);
  const [previewBody, setPreviewBody] = useState<unknown>(initial.body);
  const [isOtherDirty, setIsOtherDirty] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const [topics, setTopics] = useState(initial.topics);
  const [libraries, setLibraries] = useState(initial.libraries);
  const [videos, setVideos] = useState(initial.videos);
  const [playlists, setPlaylists] = useState(initial.playlists);
  const [assignees, setAssignees] = useState(initial.assignees);
  const [relations, setRelations] = useState(initial.relations);
  const [newRelationType, setNewRelationType] = useState<RelationType>("RELATED_ARTICLE");
  const [newRelationTarget, setNewRelationTarget] = useState<RelationTarget>("ARTICLE");

  const markDirty = () => setIsOtherDirty(true);
  const isDirty = isFormDirty || isOtherDirty;

  useEffect(() => {
    onDirtyChange?.(isDirty);
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty, onDirtyChange]);

  const handleBodyChange = (content: JSONContent) => {
    bodyRef.current = content;
    markDirty();
  };

  const save = async (values: FormValues) => {
    setMessage(null);
    const result = await onSave({
      title: values.title,
      ...(values.slug ? { slug: values.slug } : {}),
      excerpt: values.excerpt || null,
      coverImage: values.coverImage,
      coverCaption: values.coverCaption || null,
      bylineName: values.bylineName || null,
      seoTitle: values.seoTitle || null,
      seoDescription: values.seoDescription || null,
      // ProseMirror builds attributes without a prototype, which Server Actions silently replace
      // with a placeholder, losing heading levels, links, and images. Plain JSON survives.
      body: JSON.parse(JSON.stringify(bodyRef.current)) as unknown,
      sources: values.sources.map((source) => ({ title: source.title, author: source.author || null, url: source.url || null, note: source.note || null })),
      topicIds: topics.map((item) => item.id),
      libraryIds: libraries.map((item) => item.id),
      videoIds: videos.map((item) => item.id),
      playlistIds: playlists.map((item) => item.id),
      relations: relations.map(({ relationType, targetType, targetId, note }) => ({ relationType, targetType, targetId, note })),
      ...(canAssign ? { assigneeIds: assignees.map((item) => item.id) } : {}),
    });

    if (!result.ok) {
      setMessage({ text: result.message, isError: true });
      return;
    }
    setIsOtherDirty(false);
    form.reset(values);
    setMessage({ text: c.saved, isError: false });
    if (id) router.refresh();
    else router.push(`/admin/articles/${result.data.id}`);
  };

  const allowedTargets = RELATION_TARGETS[newRelationType] as RelationTarget[];
  const relationTarget = allowedTargets.includes(newRelationTarget) ? newRelationTarget : (allowedTargets[0] ?? "ARTICLE");

  return (
    <form onSubmit={(event) => void form.handleSubmit(save)(event)} noValidate className="space-y-5" data-testid="article-form">
      <FormField label={e.title} error={errors.title?.message}>
        <Input {...form.register("title")} dir="auto" placeholder={e.titlePlaceholder} className="h-14 text-xl font-semibold md:text-xl" data-testid="article-title" />
      </FormField>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{e.body}</h2>
          <div className="flex gap-1">
            <Button type="button" variant={tab === "write" ? "secondary" : "ghost"} aria-pressed={tab === "write"} onClick={() => setTab("write")} data-testid="tab-write">
              <PenLine aria-hidden data-icon="inline-start" />
              {e.write}
            </Button>
            <Button
              type="button"
              variant={tab === "preview" ? "secondary" : "ghost"}
              aria-pressed={tab === "preview"}
              onClick={() => {
                setPreviewBody(bodyRef.current);
                setTab("preview");
              }}
              data-testid="tab-preview"
            >
              <Eye aria-hidden data-icon="inline-start" />
              {e.preview}
            </Button>
          </div>
        </div>

        {/* Kept mounted but hidden, so switching tabs never loses the undo history. */}
        <div hidden={tab !== "write"}>
          <RichTextEditor initialContent={initial.body as JSONContent} onChange={handleBodyChange} label={e.body} />
        </div>
        {tab === "preview" ? (
          <div className="rounded-xl border bg-surface p-5" data-testid="article-preview">
            <h1 dir="auto" className="mb-4 text-start text-3xl font-semibold">
              {form.getValues("title") || e.previewEmpty}
            </h1>
            <ArticleBody body={previewBody} />
          </div>
        ) : null}
      </section>

      <FormSection title={e.sectionDetails}>
        <FormField label={e.excerpt} hint={e.excerptHint} error={errors.excerpt?.message}>
          <Textarea {...form.register("excerpt")} dir="auto" rows={2} data-testid="article-excerpt" />
        </FormField>
        <Controller control={form.control} name="coverImage" render={({ field }) => <ImageField label={c.cover} value={field.value} onChange={field.onChange} />} />
        <FormField label={e.coverCaption} error={errors.coverCaption?.message}>
          <Input {...form.register("coverCaption")} dir="auto" />
        </FormField>
        <FormField label={e.byline} error={errors.bylineName?.message}>
          <Input {...form.register("bylineName")} dir="auto" data-testid="article-byline" />
        </FormField>
        <FormField label={c.slug} hint={status === "PUBLISHED" ? c.slugLockedHint : c.slugHint} error={errors.slug?.message}>
          <Input {...form.register("slug")} dir="auto" disabled={status === "PUBLISHED"} data-testid="article-slug" />
        </FormField>
      </FormSection>

      <FormSection title={e.sectionConnections}>
        <ContentPicker
          label={e.topics}
          type="TOPIC"
          value={topics}
          onChange={(next) => {
            setTopics(next);
            markDirty();
          }}
        />
        <ContentPicker
          label={e.libraries}
          type="LIBRARY"
          value={libraries}
          onChange={(next) => {
            setLibraries(next);
            markDirty();
          }}
        />
        <ContentPicker
          label={e.shorts}
          type="VIDEO"
          value={videos}
          onChange={(next) => {
            setVideos(next);
            markDirty();
          }}
        />
        <ContentPicker
          label={e.playlists}
          type="PLAYLIST"
          value={playlists}
          onChange={(next) => {
            setPlaylists(next);
            markDirty();
          }}
        />

        <div className="space-y-2" data-testid="article-relations">
          <p className="text-sm font-medium">{e.relations}</p>
          {relations.length ? (
            <ul className="space-y-1.5">
              {relations.map((relation) => (
                <li key={`${relation.relationType}:${relation.targetId}`} className="flex items-center gap-2 rounded-lg border bg-surface-elevated ps-3 pe-1 py-1 text-sm" data-testid="relation-row">
                  <span className="min-w-0 flex-1">
                    <bdi className="block truncate">{relation.label}</bdi>
                    <span className="block text-xs text-text-secondary">{strings.articles.relationLabels[relation.relationType]}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${c.picker.remove}: ${relation.label}`}
                    onClick={() => {
                      setRelations(relations.filter((other) => other !== relation));
                      markDirty();
                    }}
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <select aria-label={e.relationType} value={newRelationType} onChange={(event) => setNewRelationType(event.target.value as RelationType)} className={selectClass} data-testid="relation-type">
              {RELATION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {strings.articles.relationLabels[type]}
                </option>
              ))}
            </select>
            {allowedTargets.length > 1 ? (
              <select aria-label={e.relationType} value={relationTarget} onChange={(event) => setNewRelationTarget(event.target.value as RelationTarget)} className={selectClass}>
                {allowedTargets.map((target) => (
                  <option key={target} value={target}>
                    {target === "ARTICLE" ? strings.admin.articles : target === "TOPIC" ? strings.admin.topics : strings.admin.resources}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <PickerSearch
            key={relationTarget}
            type={relationTarget}
            label={c.addLink}
            excludeId={relationTarget === "ARTICLE" ? id : undefined}
            excludeIds={relations.filter((relation) => relation.relationType === newRelationType).map((relation) => relation.targetId)}
            onPick={(item) => {
              setRelations([...relations, { relationType: newRelationType, targetType: relationTarget, targetId: item.id, label: item.label, note: null }]);
              markDirty();
            }}
          />
        </div>

        {canAssign ? (
          <ContentPicker
            label={e.assignees}
            hint={e.assigneesHint}
            type="STAFF"
            value={assignees}
            max={20}
            onChange={(next) => {
              setAssignees(next);
              markDirty();
            }}
          />
        ) : null}
      </FormSection>

      <FormSection title={e.sectionSources}>
        {sources.fields.map((field, index) => (
          <fieldset key={field.id} className="space-y-2 rounded-lg border p-3" data-testid="source-row">
            <FormField label={e.sourceTitle} error={errors.sources?.[index]?.title?.message ?? (errors as Record<string, { message?: string }>)[`sources.${index}.title`]?.message}>
              <Input {...form.register(`sources.${index}.title`)} dir="auto" data-testid="source-title" />
            </FormField>
            <div className="grid gap-2 sm:grid-cols-2">
              <FormField label={e.sourceAuthor}>
                <Input {...form.register(`sources.${index}.author`)} dir="auto" />
              </FormField>
              <FormField label={e.sourceUrl} error={(errors as Record<string, { message?: string }>)[`sources.${index}.url`]?.message}>
                <Input {...form.register(`sources.${index}.url`)} dir="ltr" type="url" placeholder="https://" data-testid="source-url" />
              </FormField>
            </div>
            <FormField label={e.sourceNote}>
              <Input {...form.register(`sources.${index}.note`)} dir="auto" />
            </FormField>
            <Button type="button" variant="ghost" onClick={() => sources.remove(index)}>
              <X aria-hidden data-icon="inline-start" />
              {e.removeSource}
            </Button>
          </fieldset>
        ))}
        <Button type="button" variant="secondary" onClick={() => sources.append({ title: "", author: "", url: "", note: "" })} data-testid="add-source">
          <Plus aria-hidden data-icon="inline-start" />
          {e.addSource}
        </Button>
      </FormSection>

      <FormSection title={e.sectionSeo}>
        <p className="text-xs text-text-secondary">{e.seoHint}</p>
        <FormField label={e.seoTitle} error={errors.seoTitle?.message}>
          <Input {...form.register("seoTitle")} dir="auto" />
        </FormField>
        <FormField label={e.seoDescription} error={errors.seoDescription?.message}>
          <Textarea {...form.register("seoDescription")} dir="auto" rows={2} />
        </FormField>
      </FormSection>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t bg-background/95 py-3 backdrop-blur-sm">
        <Button type="submit" disabled={isSubmitting} data-testid="article-save">
          {isSubmitting ? c.saving : status === "PUBLISHED" ? c.save : c.saveDraft}
        </Button>
        {isDirty ? (
          <span className="text-sm text-text-secondary" data-testid="article-unsaved">
            {c.unsaved}
          </span>
        ) : null}
        {message ? (
          <p role={message.isError ? "alert" : "status"} className={message.isError ? "text-sm text-destructive" : "text-sm text-text-secondary"} data-testid="article-message">
            {message.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}
