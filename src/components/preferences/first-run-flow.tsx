"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { isOnByDefault } from "@/features/preferences/channel-choices";
import type { InterestCatalogue } from "@/features/topics/catalogue.service";
import { cn } from "@/lib/utils";
import { ChannelGrid, countChannelsOn } from "./channel-grid";
import { usePreferences } from "./preferences-provider";
import { toggleSelection, TopicPicker } from "./topic-picker";

const s = strings.interests;

function Progress({ step }: { step: 1 | 2 }) {
  return (
    <div role="img" aria-label={s.stepOf(step, 2)} className="flex w-24 gap-1.5">
      {[1, 2].map((item) => (
        <span key={item} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-300", item <= step ? "bg-brand" : "bg-surface-elevated")} />
      ))}
    </div>
  );
}

function StepFrame({ step, title, description, onSkip, isBusy, onBack, footer, children }: { step: 1 | 2; title: string; description: string; onSkip: () => void; isBusy: boolean; onBack?: () => void; footer: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-2 md:px-8">
          <div className="flex items-center gap-2">
            {onBack ? (
              <Button type="button" variant="ghost" size="icon" onClick={onBack} disabled={isBusy} aria-label={s.back} data-testid="first-run-back">
                <ArrowRight aria-hidden />
              </Button>
            ) : null}
            <Progress step={step} />
          </div>
          <Button type="button" variant="ghost" onClick={onSkip} disabled={isBusy} data-testid="first-run-skip">
            {s.skip}
          </Button>
        </div>
      </header>

      <div key={step} className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 pt-6 pb-8 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-300 md:px-8">
        <div className="space-y-2">
          <h2 id="first-run-title" tabIndex={-1} className="text-3xl leading-tight font-semibold outline-none md:text-4xl">
            {title}
          </h2>
          <p className="max-w-2xl text-text-secondary">{description}</p>
        </div>
        {children}
        <p className="text-xs text-subtle">{s.youtubeNote}</p>
      </div>

      <footer className="sticky bottom-0 z-10 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
        <div className="mx-auto w-full max-w-6xl px-4 py-3 md:px-8">{footer}</div>
      </footer>
    </div>
  );
}

/**
 * The first-visit choices (§9.1, as the owner reshaped it on 2026-11-07). It fills the screen, in the
 * browser's top layer so nothing behind it can be reached by keyboard, and can always be skipped.
 * No player exists until it closes. The press that closes it also lets the first video start with sound.
 */
export function FirstRunFlow({ catalogue, onDismiss }: { catalogue: InterestCatalogue; onDismiss: () => void }) {
  const { completeOnboarding, skipOnboarding } = usePreferences();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [step, setStep] = useState<1 | 2>(1);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [isBusy, setIsBusy] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // A new step replaces everything on screen, so the reader's place moves with it.
  useEffect(() => {
    dialogRef.current?.scrollTo({ top: 0 });
    dialogRef.current?.querySelector<HTMLElement>("#first-run-title")?.focus({ preventScroll: true });
  }, [step]);

  const skip = async () => {
    setIsBusy(true);
    try {
      await skipOnboarding();
    } catch {
      // Being unable to remember the skip is no reason to keep someone out.
      onDismiss();
    }
  };

  const finish = async () => {
    setIsBusy(true);
    setHasFailed(false);
    try {
      await completeOnboarding([...selectedIds], choices);
    } catch {
      setHasFailed(true);
      setIsBusy(false);
    }
  };

  /** Choosing different topics resets hand-made switches only where they'd now say the same as the default. */
  const toggleTopic = (id: string) => {
    const next = toggleSelection(selectedIds, id);
    setSelectedIds(next);
    setChoices((current) => Object.fromEntries(Object.entries(current).filter(([channelId, isOn]) => {
      const channel = catalogue.channels.find((item) => item.id === channelId);
      return !channel || isOn !== isOnByDefault(channel.topicIds, next);
    })));
  };

  const channelsOn = countChannelsOn(catalogue.channels, selectedIds, choices);

  return (
    // Escape is ignored rather than treated as skipping, so nobody loses their picks by accident.
    <dialog ref={dialogRef} aria-labelledby="first-run-title" onCancel={(event) => event.preventDefault()} data-testid="first-run" className="fixed inset-0 m-0 size-full max-h-none max-w-none overflow-y-auto bg-background p-0 text-text-primary">
      {step === 1 ? (
        <StepFrame
          step={1}
          title={s.promptTitle}
          description={s.promptDescription}
          onSkip={skip}
          isBusy={isBusy}
          footer={
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-text-secondary" aria-live="polite" data-testid="first-run-count">
                {selectedIds.size === 0 ? s.pickAtLeastOne : s.topicsPicked(selectedIds.size)}
              </p>
              <Button type="button" size="lg" onClick={() => setStep(2)} disabled={isBusy || selectedIds.size === 0} data-testid="first-run-next">
                {s.next}
              </Button>
            </div>
          }
        >
          <TopicPicker topics={catalogue.topics} channels={catalogue.channels} selectedIds={selectedIds} onToggle={toggleTopic} label={s.promptTitle} disabled={isBusy} />
        </StepFrame>
      ) : (
        <StepFrame
          step={2}
          title={s.channelsTitle}
          description={s.channelsDescription}
          onSkip={skip}
          isBusy={isBusy}
          onBack={() => setStep(1)}
          footer={
            <div className="space-y-2">
              {hasFailed ? (
                <p role="alert" className="text-sm text-destructive">
                  {s.saveFailed}
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-text-secondary" aria-live="polite" data-testid="first-run-channels-on">
                  {channelsOn === 0 ? s.pickAtLeastOneChannel : s.channelsOn(channelsOn)}
                </p>
                <Button type="button" size="lg" onClick={finish} disabled={isBusy || channelsOn === 0} data-testid="first-run-finish">
                  {isBusy ? s.saving : s.start}
                </Button>
              </div>
            </div>
          }
        >
          <ChannelGrid channels={catalogue.channels} topics={catalogue.topics} selectedTopicIds={selectedIds} choices={choices} onChange={setChoices} disabled={isBusy} />
        </StepFrame>
      )}
    </dialog>
  );
}
