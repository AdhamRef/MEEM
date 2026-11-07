"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ErrorMessage } from "@/components/shared/error-message";
import { PageLoading } from "@/components/shared/page-loading";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { isOnByDefault } from "@/features/preferences/channel-choices";
import type { InterestCatalogue } from "@/features/topics/catalogue.service";
import { signInHref } from "@/lib/auth/callback-url";
import { ChannelGrid, countChannelsOn } from "./channel-grid";
import { usePreferences } from "./preferences-provider";
import { toggleSelection, TopicPicker } from "./topic-picker";

const s = strings.interests;

type Notice = { kind: "success" | "failure"; text: string } | null;

function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

function sameChoices(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((id) => a[id] === b[id]);
}

export function InterestsManager({ catalogue }: { catalogue: InterestCatalogue }) {
  const { status, isGuest, selectedTopicIds, channelChoices, saveInterests, resetInterests, reload } = usePreferences();
  const { topics, channels } = catalogue;

  // Null until the first edit, so this always shows what's stored until the person changes it.
  const [draftTopics, setDraftTopics] = useState<ReadonlySet<string> | null>(null);
  const [draftChoices, setDraftChoices] = useState<Record<string, boolean> | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  // A stored topic may have been unpublished since. Only offer what's shown here.
  const storedTopics = useMemo(() => {
    const available = new Set(topics.map((topic) => topic.id));
    return new Set(selectedTopicIds.filter((id) => available.has(id)));
  }, [topics, selectedTopicIds]);

  if (status === "loading") return <PageLoading />;
  if (status === "error") return <ErrorMessage onRetry={reload} />;

  const selected = draftTopics ?? storedTopics;
  const choices = draftChoices ?? channelChoices;
  const isDirty = !sameMembers(selected, storedTopics) || !sameChoices(choices, channelChoices);
  const channelsOn = countChannelsOn(channels, selected, choices);

  const run = async (work: () => Promise<void>, successText: string) => {
    setIsBusy(true);
    setNotice(null);
    try {
      await work();
      setDraftTopics(null);
      setDraftChoices(null);
      setNotice({ kind: "success", text: successText });
    } catch {
      setNotice({ kind: "failure", text: s.saveFailed });
    } finally {
      setIsBusy(false);
    }
  };

  const toggleTopic = (id: string) => {
    const next = toggleSelection(selected, id);
    setNotice(null);
    setDraftTopics(next);
    // A switch that now says the same as the default stops being a switch, so it follows topics again.
    setDraftChoices(
      Object.fromEntries(
        Object.entries(choices).filter(([channelId, isOn]) => {
          const channel = channels.find((item) => item.id === channelId);
          return !channel || isOn !== isOnByDefault(channel.topicIds, next);
        }),
      ),
    );
  };

  return (
    <div className="space-y-10">
      {topics.length ? (
        <section aria-labelledby="interests-topics" className="space-y-4">
          <div className="space-y-1">
            <h2 id="interests-topics" className="text-xl font-semibold">
              {s.topicsHeading}
            </h2>
            <p className="text-sm text-text-secondary">{s.topicsHint}</p>
          </div>
          <TopicPicker topics={topics} channels={channels} selectedIds={selected} onToggle={toggleTopic} label={s.topicsHeading} disabled={isBusy} />
        </section>
      ) : null}

      {channels.length ? (
        <section aria-labelledby="interests-channels" className="space-y-4">
          <div className="space-y-1">
            <h2 id="interests-channels" className="text-xl font-semibold">
              {s.channelsHeading}
            </h2>
            <p className="text-sm text-text-secondary">{s.channelsHint}</p>
          </div>
          <ChannelGrid
            channels={channels}
            topics={topics}
            selectedTopicIds={selected}
            choices={choices}
            disabled={isBusy}
            onChange={(next) => {
              setNotice(null);
              setDraftChoices(next);
            }}
          />
          <p className="text-xs text-subtle">{s.youtubeNote}</p>
        </section>
      ) : null}

      {isConfirmingReset ? (
        <div className="space-y-3 rounded-xl border bg-surface p-4">
          <p>{s.resetConfirm}</p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="destructive"
              disabled={isBusy}
              onClick={async () => {
                await run(resetInterests, s.resetDone);
                setIsConfirmingReset(false);
              }}
            >
              {s.resetConfirmAction}
            </Button>
            <Button variant="ghost" disabled={isBusy} onClick={() => setIsConfirmingReset(false)}>
              {s.resetCancel}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setIsConfirmingReset(true)} disabled={isBusy}>
          {s.reset}
        </Button>
      )}

      <p className="text-sm text-text-secondary">
        {isGuest ? (
          <>
            {s.guestNote}{" "}
            <Link href={signInHref("/interests")} className="text-brand underline-offset-4 hover:underline">
              {s.guestSignInLink}
            </Link>
          </>
        ) : (
          s.accountNote
        )}
      </p>

      <div className="sticky bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom))] z-10 -mx-4 border-t bg-background/90 px-4 py-3 backdrop-blur-md md:bottom-0" data-testid="interests-bar">
        <div className="flex items-center justify-between gap-3">
          <div role="status" className="min-w-0 text-sm">
            {notice ? <span className={notice.kind === "success" ? "text-text-secondary" : "text-destructive"}>{notice.text}</span> : <span className="text-text-secondary">{channelsOn === 0 ? s.noChannelsOnWarning : s.channelsOn(channelsOn)}</span>}
          </div>
          <Button onClick={() => run(() => saveInterests([...selected], choices), s.saved)} disabled={isBusy || !isDirty} data-testid="interests-save">
            {isBusy ? s.saving : s.save}
          </Button>
        </div>
      </div>
    </div>
  );
}
