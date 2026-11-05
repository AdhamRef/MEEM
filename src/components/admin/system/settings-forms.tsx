"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateScoringAction, updateYouTubeSettingsAction } from "@/app/(admin)/admin/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { strings } from "@/config/strings.ar";
import type { ScoringConfig } from "@/features/recommendations/scoring";
import type { YouTubeSettings } from "@/features/youtube/settings.service";
import type { ActionResult } from "@/lib/http/action";

const s = strings.system;

function NumberField({ label, hint, value, onChange, testId, step = "1" }: { label: string; hint?: string; value: string; onChange: (value: string) => void; testId?: string; step?: string }) {
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      {label}
      <Input type="number" dir="ltr" step={step} value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId} />
      {hint ? <span className="block text-xs font-normal text-text-secondary">{hint}</span> : null}
    </label>
  );
}

function SaveRow({ isBusy, message, onSave, testId }: { isBusy: boolean; message: { text: string; isError: boolean } | null; onSave: () => void; testId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" disabled={isBusy} onClick={onSave} data-testid={testId}>
        {isBusy ? strings.adminContent.saving : strings.adminContent.save}
      </Button>
      {message ? (
        <p role={message.isError ? "alert" : "status"} className={message.isError ? "text-sm text-destructive" : "text-sm text-text-secondary"} data-testid={`${testId}-message`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

function useSave() {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const save = async (work: () => Promise<ActionResult<undefined>>) => {
    setIsBusy(true);
    setMessage(null);
    const result = await work();
    setIsBusy(false);
    setMessage(result.ok ? { text: strings.adminContent.saved, isError: false } : { text: result.message, isError: true });
    if (result.ok) router.refresh();
  };
  return { isBusy, message, save };
}

export function ScoringSettingsForm({ initial }: { initial: ScoringConfig }) {
  const { isBusy, message, save } = useSave();
  const [exploration, setExploration] = useState(String(Math.round(initial.explorationShare * 100)));
  const [interest, setInterest] = useState(String(initial.selectedInterestWeight));
  const [completion, setCompletion] = useState(String(initial.signalWeights.completion));
  const [saved, setSaved] = useState(String(initial.signalWeights.save));
  const [repeated, setRepeated] = useState(String(initial.signalWeights.repeatedEngagement));
  const [skip, setSkip] = useState(String(initial.signalWeights.earlySkip));
  const [maxScore, setMaxScore] = useState(String(initial.maxBehaviourScore));
  const [halfLife, setHalfLife] = useState(String(initial.decayHalfLifeDays));

  return (
    <section className="space-y-4 rounded-xl border bg-surface p-4" data-testid="scoring-settings">
      <div>
        <h2 className="font-semibold">{s.scoringTitle}</h2>
        <p className="text-sm text-text-secondary">{s.scoringHint}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label={s.exploration} hint={s.explorationHint} value={exploration} onChange={setExploration} testId="exploration" />
        <NumberField label={s.interestWeight} value={interest} onChange={setInterest} />
        <NumberField label={s.completionWeight} step="0.05" value={completion} onChange={setCompletion} />
        <NumberField label={s.saveWeight} step="0.05" value={saved} onChange={setSaved} />
        <NumberField label={s.repeatWeight} step="0.05" value={repeated} onChange={setRepeated} />
        <NumberField label={s.skipWeight} hint={s.skipHint} step="0.05" value={skip} onChange={setSkip} />
        <NumberField label={s.maxScore} value={maxScore} onChange={setMaxScore} />
        <NumberField label={s.halfLife} value={halfLife} onChange={setHalfLife} />
      </div>
      <SaveRow
        isBusy={isBusy}
        message={message}
        testId="scoring-save"
        onSave={() =>
          save(() =>
            updateScoringAction({
              selectedInterestWeight: Number(interest),
              signalWeights: { completion: Number(completion), save: Number(saved), repeatedEngagement: Number(repeated), earlySkip: Number(skip) },
              maxBehaviourScore: Number(maxScore),
              decayHalfLifeDays: Number(halfLife),
              explorationShare: Number(exploration) / 100,
            }),
          )
        }
      />
    </section>
  );
}

export function YouTubeSettingsForm({ initial }: { initial: YouTubeSettings }) {
  const { isBusy, message, save } = useSave();
  const [maxShort, setMaxShort] = useState(String(initial.maxShortSeconds));
  const [refreshAfter, setRefreshAfter] = useState(String(initial.refreshAfterDays));
  const [batches, setBatches] = useState(String(initial.refreshBatchesPerRun));

  return (
    <section className="space-y-4 rounded-xl border bg-surface p-4" data-testid="youtube-settings">
      <h2 className="font-semibold">{s.youtubeTitle}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label={s.maxShort} hint={s.maxShortHint} value={maxShort} onChange={setMaxShort} testId="max-short" />
        <NumberField label={s.refreshAfter} hint={s.refreshAfterHint} value={refreshAfter} onChange={setRefreshAfter} testId="refresh-after" />
        <NumberField label={s.batches} hint={s.batchesHint} value={batches} onChange={setBatches} />
      </div>
      <p className="text-sm text-text-secondary" data-testid="statistics-note">
        {s.statisticsNote}
      </p>
      <SaveRow isBusy={isBusy} message={message} testId="youtube-save" onSave={() => save(() => updateYouTubeSettingsAction({ maxShortSeconds: Number(maxShort), refreshAfterDays: Number(refreshAfter), refreshBatchesPerRun: Number(batches) }))} />
    </section>
  );
}
