"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { startChannelImportAction } from "@/app/(admin)/admin/youtube-importer/actions";
import { FormField } from "@/components/admin/content/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { strings } from "@/config/strings.ar";

const t = strings.importer;

/** Explains why it's unavailable rather than offering something that would only fail. */
export function ImporterStart({ isConfigured, quotaExhausted }: { isConfigured: boolean; quotaExhausted: boolean }) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = !isConfigured ? t.apiNotConfigured : quotaExhausted ? t.quotaExhausted : null;

  const submit = async () => {
    setIsBusy(true);
    setError(null);
    const result = await startChannelImportAction({ input });
    if (result.ok) {
      router.push(`/admin/youtube-importer/${result.data.jobId}`);
      return;
    }
    setError(result.message);
    setIsBusy(false);
  };

  return (
    <section className="space-y-3 rounded-xl border bg-surface p-4" data-testid="importer-start">
      <p className="text-sm text-text-secondary">{t.description}</p>
      {reason ? (
        <p className="text-sm text-text-secondary" data-testid="importer-unavailable">
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
          <FormField label={t.channelLabel} hint={t.channelHint} error={error ?? undefined}>
            <Input value={input} dir="ltr" placeholder="@channel" onChange={(event) => setInput(event.target.value)} data-testid="channel-input" />
          </FormField>
          <Button type="submit" disabled={isBusy || !input.trim()} data-testid="channel-submit">
            {isBusy ? t.starting : t.start}
          </Button>
        </form>
      )}
    </section>
  );
}
