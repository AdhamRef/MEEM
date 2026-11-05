"use client";

/* eslint-disable @next/next/no-img-element -- A preview of a just-uploaded image, whose host depends on the storage provider. */
import { ImagePlus, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";

export interface UploadResult {
  url: string;
  width: number;
  height: number;
}

/** The server validates the file. The result either carries a usable image or a safe message. */
export async function uploadImageFile(file: File): Promise<{ ok: true; image: UploadResult } | { ok: false; message: string }> {
  const form = new FormData();
  form.set("file", file);
  try {
    const response = await fetch("/api/uploads", { method: "POST", body: form });
    if (response.ok) return { ok: true, image: (await response.json()) as UploadResult };
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, message: body?.error?.message ?? strings.uploads.failed };
  } catch {
    return { ok: false, message: strings.uploads.failed };
  }
}

export function ImageField({ label, value, onChange, disabled }: { label: string; value: string | null; onChange: (url: string | null) => void; disabled?: boolean }) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setIsUploading(true);
    setError(null);
    const result = await uploadImageFile(file);
    if (result.ok) onChange(result.image.url);
    else setError(result.message);
    setIsUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-2" data-testid="image-field">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {value ? <img src={value} alt="" className="max-h-48 rounded-lg border" data-testid="image-field-preview" /> : null}
      <input ref={inputRef} id={id} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={disabled || isUploading} onChange={(event) => handleFile(event.target.files?.[0])} data-testid="image-field-input" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" disabled={disabled || isUploading} onClick={() => inputRef.current?.click()}>
          <ImagePlus aria-hidden data-icon="inline-start" />
          {isUploading ? strings.uploads.uploading : strings.uploads.choose}
        </Button>
        {value ? (
          <Button type="button" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
            <X aria-hidden data-icon="inline-start" />
            {strings.uploads.remove}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-text-secondary">{strings.uploads.hint}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="image-field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
