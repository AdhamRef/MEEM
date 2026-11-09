"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { addCollectionItemAction, removeCollectionItemAction, reorderCollectionItemsAction } from "@/app/(admin)/admin/collections/actions";
import { PickerSearch } from "@/components/admin/content/content-picker";
import { FormField } from "@/components/admin/content/form-field";
import { selectClass } from "@/components/admin/content/list-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { strings } from "@/config/strings.ar";
import type { ManagedCollectionItem } from "@/features/collections/collections.service";
import { moveItem } from "@/features/playlists/rules";
import type { ActionResult } from "@/lib/http/action";
import { zodResolver } from "@/lib/validation/zod-resolver";

const c = strings.adminContent;
const s = strings.collections;

const formSchema = z.object({
  title: z.string().trim().min(1, c.required).max(120, c.tooLong),
  description: z.string().trim().max(500, c.tooLong),
});
type FormValues = z.infer<typeof formSchema>;

interface CollectionFormProps {
  id?: string;
  canEdit: boolean;
  initial: { title: string; description: string | null };
  onSave: (input: unknown) => Promise<ActionResult<{ id: string }>>;
}

export function CollectionForm({ id, canEdit, initial, onSave }: CollectionFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: initial.title, description: initial.description ?? "" },
  });
  const { errors, isSubmitting } = form.formState;

  return (
    <form
      noValidate
      className="space-y-4 rounded-xl border bg-surface p-4"
      data-testid="collection-form"
      onSubmit={form.handleSubmit(async (values) => {
        const result = await onSave({ title: values.title, description: values.description.trim() || null });
        if (!result.ok) {
          setMessage({ text: result.message, isError: true });
          return;
        }
        setMessage({ text: c.saved, isError: false });
        if (id) router.refresh();
        else router.push(`/admin/collections/${result.data.id}`);
      })}
    >
      <FormField label={c.title} error={errors.title?.message}>
        <Input {...form.register("title")} disabled={!canEdit} dir="auto" />
      </FormField>
      <FormField label={c.description} error={errors.description?.message}>
        <Textarea {...form.register("description")} disabled={!canEdit} rows={2} dir="auto" />
      </FormField>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isSubmitting || !canEdit} data-testid="form-save">
          {isSubmitting ? c.saving : c.save}
        </Button>
        {message ? (
          <p role={message.isError ? "alert" : "status"} className={message.isError ? "text-sm text-destructive" : "text-sm text-text-secondary"} data-testid="form-message">
            {message.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}

const ITEM_TYPES = ["TOPIC", "ARTICLE", "VIDEO", "PLAYLIST", "LIBRARY", "RESOURCE"] as const;
type ItemType = (typeof ITEM_TYPES)[number];

interface ItemsManagerProps {
  collectionId: string;
  items: ManagedCollectionItem[];
  canEdit: boolean;
  max: number;
}

/** Arrow buttons rather than dragging: with at most twelve items, they're enough and work everywhere. */
export function CollectionItemsManager({ collectionId, items, canEdit, max }: ItemsManagerProps) {
  const router = useRouter();
  const [type, setType] = useState<ItemType>("TOPIC");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const perform = async (work: () => Promise<ActionResult<undefined>>) => {
    setIsBusy(true);
    setError(null);
    const result = await work();
    setIsBusy(false);
    if (!result.ok) setError(result.message);
    router.refresh();
  };

  const move = (from: number, to: number) => perform(() => reorderCollectionItemsAction(collectionId, moveItem(items, from, to).map((item) => item.id)));

  return (
    <section aria-labelledby="collection-items" className="space-y-4 rounded-xl border bg-surface p-4" data-testid="collection-items">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="collection-items" className="text-lg font-semibold">
          {s.itemsTitle}
        </h2>
        <span className="text-sm text-text-secondary">{s.itemsCount(items.length, max)}</span>
      </div>

      {items.length ? (
        <ol className="space-y-1.5" data-testid="collection-item-list">
          {items.map((item, index) => (
            <li key={item.id} className="flex items-center gap-2 rounded-lg border bg-surface-elevated ps-3 pe-1 py-1 text-sm" data-testid="collection-item">
              <span className="min-w-0 flex-1">
                <bdi className="block truncate">{item.label}</bdi>
                <span className="block truncate text-xs text-text-secondary">
                  {strings.library.types[item.entityType]}
                  {item.hint ? (
                    <>
                      {" · "}
                      <bdi>{item.hint}</bdi>
                    </>
                  ) : null}
                </span>
              </span>
              {item.isDraft ? <Badge variant="secondary">{c.picker.draftTag}</Badge> : null}
              {canEdit ? (
                <>
                  <Button type="button" variant="ghost" size="icon" disabled={isBusy || index === 0} aria-label={`${s.moveUp}: ${item.label}`} onClick={() => move(index, index - 1)}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" disabled={isBusy || index === items.length - 1} aria-label={`${s.moveDown}: ${item.label}`} onClick={() => move(index, index + 1)}>
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" disabled={isBusy} aria-label={`${s.remove}: ${item.label}`} onClick={() => perform(() => removeCollectionItemAction(collectionId, item.id))} data-testid="collection-item-remove">
                    <X aria-hidden />
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-text-secondary">{s.itemsEmpty}</p>
      )}

      {canEdit && items.length < max ? (
        <div className="space-y-2">
          <FormField label={s.itemType}>
            <select value={type} onChange={(event) => setType(event.target.value as ItemType)} className={selectClass} data-testid="collection-item-type">
              {ITEM_TYPES.map((option) => (
                <option key={option} value={option}>
                  {strings.library.types[option]}
                </option>
              ))}
            </select>
          </FormField>
          <PickerSearch key={type} type={type} label={s.addItem} disabled={isBusy} excludeIds={[]} onPick={(picked) => perform(() => addCollectionItemAction({ collectionId, entityType: type, entityId: picked.id }))} />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="collection-items-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
