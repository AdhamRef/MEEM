import { ExternalLink, FileX } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CollectionForm, CollectionItemsManager } from "@/components/admin/collections/collection-forms";
import { LibraryForm, TopicForm } from "@/components/admin/content/entity-forms";
import { StatusBadge } from "@/components/admin/content/list-frame";
import { LinksManager } from "@/components/admin/content/links-manager";
import { StatusActions } from "@/components/admin/content/status-actions";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { getCollectionForEditing, MAX_COLLECTION_ITEMS } from "@/features/collections/collections.service";
import { getLibraryForEditing } from "@/features/libraries/libraries.service";
import { canManageLink, linkTargetType, type LinkKind } from "@/features/relationships/links.service";
import { getTopicForEditing } from "@/features/topics/topics.service";
import { AppError } from "@/lib/errors";
import { hasPermission, type Actor } from "@/lib/permissions";
import { createCollectionAction, deleteCollectionAction, setCollectionArchivedAction, setCollectionPublishedAction, updateCollectionAction } from "../collections/actions";
import { createLibraryAction, deleteLibraryAction, setLibraryArchivedAction, setLibraryPublishedAction, updateLibraryAction } from "../libraries/actions";
import { createTopicAction, deleteTopicAction, setTopicArchivedAction, setTopicPublishedAction, updateTopicAction } from "../topics/actions";

const TOPIC_LINKS: LinkKind[] = ["topic.channel", "topic.article", "topic.playlist", "topic.library", "topic.resource", "topic.related", "topic.complementary"];
const LIBRARY_LINKS: LinkKind[] = ["library.article", "library.video", "library.playlist", "library.topic", "library.resource", "library.related"];

async function orNull<Row>(work: Promise<Row>): Promise<Row | null> {
  return work.catch((error: unknown) => {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION")) return null;
    throw error;
  });
}

function PanelHeader({ eyebrow, title, publicHref, children }: { eyebrow: string; title: string; publicHref?: string | null; children?: ReactNode }) {
  return (
    <header className="space-y-2">
      <p className="text-xs font-medium text-brand">{eyebrow}</p>
      <div className="flex flex-wrap items-center gap-3">
        <h2 dir="auto" className="text-xl font-semibold">
          {title}
        </h2>
        {children}
        {publicHref ? (
          <Button asChild variant="ghost" size="sm" className="ms-auto">
            <Link href={publicHref} target="_blank">
              <ExternalLink aria-hidden data-icon="inline-start" />
              {strings.structure.viewOnSite}
            </Link>
          </Button>
        ) : null}
      </div>
    </header>
  );
}

const NotFound = () => <StateMessage icon={FileX} title={strings.errors.notFound} />;
const listHref = (tab: string) => `/admin/structure?tab=${tab}`;
const linkSections = (actor: Actor, kinds: LinkKind[]) => kinds.map((kind) => ({ kind, targetType: linkTargetType(kind), canManage: canManageLink(actor, kind) }));

export async function TopicPanel({ actor, id }: { actor: Actor; id: string }) {
  const topic = await orNull(getTopicForEditing(actor, id));
  if (!topic) return <NotFound />;
  const isPublic = topic.status === "PUBLISHED" && !topic.isArchived;

  return (
    <div className="space-y-5" data-testid="topic-edit-page">
      <PanelHeader eyebrow={strings.structure.tabs.topics} title={topic.title} publicHref={isPublic ? `/topics/${encodeURIComponent(topic.slug)}` : null}>
        <StatusBadge status={topic.status} isArchived={topic.isArchived} />
      </PanelHeader>
      <StatusActions
        status={topic.status}
        isArchived={topic.isArchived}
        canPublish={hasPermission(actor, "content.publish")}
        canArchive={hasPermission(actor, "content.archive")}
        canDelete={hasPermission(actor, "content.delete")}
        onPublish={setTopicPublishedAction.bind(null, id)}
        onArchive={setTopicArchivedAction.bind(null, id)}
        onDelete={deleteTopicAction.bind(null, id)}
        listHref={listHref("topics")}
      />
      <TopicForm
        id={id}
        isPublished={topic.status === "PUBLISHED"}
        canEdit={hasPermission(actor, "topics.manage")}
        onSave={updateTopicAction.bind(null, id)}
        initial={{ title: topic.title, slug: topic.slug, introduction: topic.introduction, description: topic.description, coverImage: topic.coverImage, isFeatured: topic.isFeatured }}
      />
      <LinksManager ownerId={id} sections={linkSections(actor, TOPIC_LINKS)} />
    </div>
  );
}

export async function LibraryPanel({ actor, id }: { actor: Actor; id: string }) {
  const library = await orNull(getLibraryForEditing(actor, id));
  if (!library) return <NotFound />;
  const isPublic = library.status === "PUBLISHED" && !library.isArchived;

  return (
    <div className="space-y-5" data-testid="library-edit-page">
      <PanelHeader eyebrow={strings.structure.tabs.libraries} title={library.name} publicHref={isPublic ? `/libraries/${encodeURIComponent(library.slug)}` : null}>
        <StatusBadge status={library.status} isArchived={library.isArchived} />
      </PanelHeader>
      <StatusActions
        status={library.status}
        isArchived={library.isArchived}
        canPublish={hasPermission(actor, "content.publish")}
        canArchive={hasPermission(actor, "content.archive")}
        canDelete={hasPermission(actor, "content.delete")}
        onPublish={setLibraryPublishedAction.bind(null, id)}
        onArchive={setLibraryArchivedAction.bind(null, id)}
        onDelete={deleteLibraryAction.bind(null, id)}
        listHref={listHref("libraries")}
      />
      <LibraryForm
        id={id}
        isPublished={library.status === "PUBLISHED"}
        canEdit={hasPermission(actor, "libraries.manage")}
        onSave={updateLibraryAction.bind(null, id)}
        initial={{ name: library.name, slug: library.slug, description: library.description, introduction: library.introduction, coverImage: library.coverImage, isFeatured: library.isFeatured }}
      />
      <LinksManager ownerId={id} sections={linkSections(actor, LIBRARY_LINKS)} />
    </div>
  );
}

export async function CollectionPanel({ actor, id }: { actor: Actor; id: string }) {
  const collection = await orNull(getCollectionForEditing(actor, id));
  if (!collection) return <NotFound />;
  const canEdit = hasPermission(actor, "topics.manage");

  return (
    <div className="space-y-5" data-testid="collection-edit-page">
      <PanelHeader eyebrow={strings.structure.tabs.collections} title={collection.title} publicHref={collection.status === "PUBLISHED" && !collection.isArchived ? "/explore" : null}>
        <StatusBadge status={collection.status} isArchived={collection.isArchived} />
      </PanelHeader>
      <p className="text-sm text-text-secondary">{strings.collections.intro}</p>
      <StatusActions
        status={collection.status}
        isArchived={collection.isArchived}
        canPublish={hasPermission(actor, "content.publish")}
        canArchive={hasPermission(actor, "content.archive")}
        canDelete={hasPermission(actor, "content.delete")}
        onPublish={setCollectionPublishedAction.bind(null, id)}
        onArchive={setCollectionArchivedAction.bind(null, id)}
        onDelete={deleteCollectionAction.bind(null, id)}
        listHref={listHref("collections")}
      />
      <CollectionForm id={id} canEdit={canEdit} onSave={updateCollectionAction.bind(null, id)} initial={{ title: collection.title, description: collection.description }} />
      <CollectionItemsManager collectionId={id} items={collection.items} canEdit={canEdit} max={MAX_COLLECTION_ITEMS} />
    </div>
  );
}

/** The full form, for someone who wants to fill everything in before the item exists. */
export function NewPanel({ actor, tab }: { actor: Actor; tab: "topics" | "libraries" | "collections" }) {
  const title = strings.structure.addRoot[tab];
  return (
    <div className="space-y-5" data-testid="structure-new-panel">
      <PanelHeader eyebrow={strings.structure.tabs[tab]} title={title} />
      {tab === "topics" ? (
        <TopicForm isPublished={false} canEdit={hasPermission(actor, "topics.manage")} onSave={createTopicAction} initial={{ title: "", slug: "", introduction: null, description: null, coverImage: null, isFeatured: false }} />
      ) : tab === "libraries" ? (
        <LibraryForm isPublished={false} canEdit={hasPermission(actor, "libraries.manage")} onSave={createLibraryAction} initial={{ name: "", slug: "", description: null, introduction: null, coverImage: null, isFeatured: false }} />
      ) : (
        <CollectionForm canEdit={hasPermission(actor, "topics.manage")} onSave={createCollectionAction} initial={{ title: "", description: null }} />
      )}
    </div>
  );
}
