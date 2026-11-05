"use client";

import { Star, X } from "lucide-react";
import { useEffect, useState } from "react";
import { addLinkAction, listLinksAction, removeLinkAction, setLibraryItemFeaturedAction } from "@/app/(admin)/admin/picker-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import type { LinkKind, LinkRow } from "@/features/relationships/links.service";
import type { PickerType } from "@/features/relationships/picker.service";
import { cn } from "@/lib/utils";
import { PickerSearch } from "./content-picker";

export interface LinkSectionConfig {
  kind: LinkKind;
  targetType: PickerType;
  canManage: boolean;
}

function LinkSection({ ownerId, config }: { ownerId: string; config: LinkSectionConfig }) {
  const { kind, targetType, canManage } = config;
  const [rows, setRows] = useState<LinkRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    void listLinksAction({ kind, ownerId }).then((result) => {
      if (!isCurrent) return;
      if (result.ok) {
        setRows(result.data.items);
        setNextCursor(result.data.nextCursor);
      } else {
        setError(result.message);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [kind, ownerId]);

  const reload = async () => {
    const result = await listLinksAction({ kind, ownerId });
    if (result.ok) {
      setRows(result.data.items);
      setNextCursor(result.data.nextCursor);
    }
  };

  /** Changes are saved one at a time, so a failure here can't lose anything else on the page. */
  const run = async (work: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
    setIsBusy(true);
    setError(null);
    const result = await work();
    if (result.ok) await reload();
    else setError(result.message);
    setIsBusy(false);
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setIsBusy(true);
    const result = await listLinksAction({ kind, ownerId, cursor: nextCursor });
    if (result.ok) {
      setRows((current) => [...(current ?? []), ...result.data.items]);
      setNextCursor(result.data.nextCursor);
    } else {
      setError(result.message);
    }
    setIsBusy(false);
  };

  const supportsFeature = kind === "library.article" || kind === "library.video";

  return (
    <div className="space-y-2 rounded-lg border p-3" data-testid={`links-${kind}`}>
      <h3 className="text-sm font-medium">{strings.adminContent.linkKinds[kind]}</h3>

      {rows === null && !error ? <p className="text-sm text-text-secondary">{strings.states.loading}</p> : null}
      {rows?.length === 0 ? <p className="text-sm text-text-secondary">{strings.adminContent.linkedNothing}</p> : null}

      {rows?.length ? (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.linkId} className="flex items-center gap-1 rounded-lg bg-surface-elevated ps-3 pe-1 py-1 text-sm" data-testid="link-row">
              <span className="min-w-0 flex-1">
                <bdi className="block truncate">{row.label}</bdi>
                {row.hint ? <bdi className="block truncate text-xs text-text-secondary">{row.hint}</bdi> : null}
              </span>
              {row.isDraft ? <Badge variant="secondary">{strings.adminContent.picker.draftTag}</Badge> : null}
              {canManage && supportsFeature ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isBusy}
                  aria-pressed={row.isFeatured}
                  aria-label={`${row.isFeatured ? strings.adminContent.unfeatureItem : strings.adminContent.featureItem}: ${row.label}`}
                  onClick={() => run(() => setLibraryItemFeaturedAction({ kind, ownerId, targetId: row.id, isFeatured: !row.isFeatured }))}
                >
                  <Star aria-hidden className={cn(row.isFeatured && "fill-current text-brand")} />
                </Button>
              ) : null}
              {canManage ? (
                <Button type="button" variant="ghost" size="icon" disabled={isBusy} aria-label={`${strings.adminContent.removeLink}: ${row.label}`} onClick={() => run(() => removeLinkAction({ kind, ownerId, targetId: row.id }))}>
                  <X aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {nextCursor ? (
        <Button type="button" variant="ghost" disabled={isBusy} onClick={loadMore}>
          {strings.adminContent.loadMore}
        </Button>
      ) : null}

      {canManage ? (
        <PickerSearch
          type={targetType}
          label={strings.adminContent.addLink}
          excludeId={targetType === "TOPIC" && kind.startsWith("topic.") ? ownerId : targetType === "LIBRARY" && kind.startsWith("library.") ? ownerId : undefined}
          excludeIds={rows?.map((row) => row.id) ?? []}
          disabled={isBusy}
          onPick={(item) => run(() => addLinkAction({ kind, ownerId, targetId: item.id }))}
        />
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Every link is optional, and nothing here is required to publish (§13.2). */
export function LinksManager({ ownerId, sections }: { ownerId: string; sections: LinkSectionConfig[] }) {
  return (
    <section className="space-y-3 rounded-xl border bg-surface p-4" data-testid="links-manager">
      <h2 className="font-semibold">{strings.adminContent.linksTitle}</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {sections.map((config) => (
          <LinkSection key={config.kind} ownerId={ownerId} config={config} />
        ))}
      </div>
    </section>
  );
}
