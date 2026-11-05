"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createCategoryAction, setCategoryActiveAction, updateCategoryAction } from "@/app/(admin)/admin/categories/actions";
import { selectClass } from "@/components/admin/content/list-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { strings } from "@/config/strings.ar";
import { CATEGORY_ICONS } from "@/features/categories/schemas";
import type { ActionResult } from "@/lib/http/action";

const s = strings.system;

export interface CategoryView {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  icon: string | null;
  displayOrder: number;
  isActive: boolean;
}

interface EditorValues {
  title: string;
  description: string;
  icon: string;
  displayOrder: string;
}

function CategoryFields({ values, onChange, disabled }: { values: EditorValues; onChange: (next: EditorValues) => void; disabled?: boolean }) {
  const set = (key: keyof EditorValues, value: string) => onChange({ ...values, [key]: value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1.5 text-sm font-medium">
        {strings.adminContent.title}
        <Input value={values.title} dir="auto" maxLength={80} disabled={disabled} onChange={(event) => set("title", event.target.value)} data-testid="category-title" />
      </label>
      <label className="space-y-1.5 text-sm font-medium">
        {strings.adminContent.displayOrder}
        <Input value={values.displayOrder} inputMode="numeric" disabled={disabled} onChange={(event) => set("displayOrder", event.target.value)} data-testid="category-order" />
      </label>
      <label className="space-y-1.5 text-sm font-medium">
        {s.categoryIcon}
        <select value={values.icon} disabled={disabled} onChange={(event) => set("icon", event.target.value)} className={selectClass}>
          <option value="">{s.noIcon}</option>
          {CATEGORY_ICONS.map((icon) => (
            <option key={icon} value={icon}>
              {icon}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
        {strings.adminContent.description}
        <Textarea value={values.description} dir="auto" maxLength={500} rows={2} disabled={disabled} onChange={(event) => set("description", event.target.value)} />
      </label>
    </div>
  );
}

function toInput(values: EditorValues) {
  const order = Number(values.displayOrder || 0);
  return { title: values.title.trim(), description: values.description.trim() || null, icon: values.icon || null, displayOrder: Number.isInteger(order) && order >= 0 ? order : 0 };
}

function CategoryRow({ category, canManage }: { category: CategoryView; canManage: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState<EditorValues>({ title: category.title, description: category.description ?? "", icon: category.icon ?? "", displayOrder: String(category.displayOrder) });
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (work: () => Promise<ActionResult<undefined>>) => {
    setIsBusy(true);
    setMessage(null);
    const result = await work();
    setIsBusy(false);
    setMessage(result.ok ? strings.adminContent.saved : result.message);
    if (result.ok) router.refresh();
  };

  return (
    <li className="space-y-3 p-3" data-testid="category-row">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <bdi>{category.title}</bdi>
            {category.isActive ? null : <Badge variant="outline">{s.inactive}</Badge>}
          </p>
          <p className="text-xs text-text-secondary">
            <bdi>{category.slug}</bdi> · {strings.adminContent.displayOrder}: {category.displayOrder}
          </p>
        </div>
        {canManage ? (
          <>
            <Button type="button" variant="ghost" onClick={() => setIsOpen(!isOpen)} aria-expanded={isOpen} data-testid="category-edit">
              {strings.adminContent.edit}
            </Button>
            <Button type="button" variant="ghost" disabled={isBusy} onClick={() => run(() => setCategoryActiveAction(category.id, !category.isActive))} data-testid="category-toggle">
              {category.isActive ? s.deactivate : s.activate}
            </Button>
          </>
        ) : null}
      </div>
      {isOpen ? (
        <div className="space-y-3 rounded-lg border p-3">
          <CategoryFields values={values} onChange={setValues} />
          <Button type="button" disabled={isBusy || !values.title.trim()} onClick={() => run(() => updateCategoryAction(category.id, toInput(values)))} data-testid="category-save">
            {strings.adminContent.save}
          </Button>
        </div>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-text-secondary" data-testid="category-message">
          {message}
        </p>
      ) : null}
    </li>
  );
}

const EMPTY: EditorValues = { title: "", description: "", icon: "", displayOrder: "0" };

/** Categories are deactivated, never deleted, because content and interests refer to them. */
export function CategoryManager({ categories, canManage }: { categories: CategoryView[]; canManage: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState(EMPTY);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const create = async () => {
    setIsBusy(true);
    setMessage(null);
    const result = await createCategoryAction(toInput(values));
    setIsBusy(false);
    setMessage(result.ok ? { text: strings.adminContent.saved, isError: false } : { text: result.message, isError: true });
    if (result.ok) {
      setValues(EMPTY);
      router.refresh();
    }
  };

  return (
    <div className="space-y-5">
      {canManage ? (
        <section className="space-y-3 rounded-xl border bg-surface p-4" data-testid="category-create">
          <h2 className="font-semibold">{s.newCategory}</h2>
          <CategoryFields values={values} onChange={setValues} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={isBusy || !values.title.trim()} onClick={create} data-testid="category-create-save">
              {strings.adminContent.create}
            </Button>
            {message ? (
              <p role={message.isError ? "alert" : "status"} className={message.isError ? "text-sm text-destructive" : "text-sm text-text-secondary"} data-testid="category-create-message">
                {message.text}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {categories.length ? (
        <ul className="divide-y rounded-xl border bg-surface" data-testid="category-list">
          {categories.map((category) => (
            <CategoryRow key={category.id} category={category} canManage={canManage} />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border bg-surface p-8 text-center text-text-secondary">{strings.adminContent.empty}</p>
      )}
    </div>
  );
}
