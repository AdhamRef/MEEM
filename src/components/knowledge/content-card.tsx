import type { ResolvedContent } from "@/features/content/resolve";
import { ArticleCard, cardGridClass, LibraryCard, PlaylistCard, ResourceCard, ShortsStrip, TopicCard, VideoTile } from "./content-cards";

export function ContentCard({ item }: { item: ResolvedContent }) {
  switch (item.type) {
    case "VIDEO":
      return <VideoTile video={item.video} />;
    case "ARTICLE":
      return <ArticleCard article={item.article} />;
    case "TOPIC":
      return <TopicCard topic={item.topic} />;
    case "LIBRARY":
      return <LibraryCard library={item.library} />;
    case "PLAYLIST":
      return <PlaylistCard playlist={item.playlist} />;
    case "RESOURCE":
      return <ResourceCard resource={item.resource} />;
  }
}

const itemKey = (item: ResolvedContent) => {
  switch (item.type) {
    case "VIDEO":
      return item.video.id;
    case "ARTICLE":
      return item.article.id;
    case "TOPIC":
      return item.topic.id;
    case "LIBRARY":
      return item.library.id;
    case "PLAYLIST":
      return item.playlist.id;
    case "RESOURCE":
      return item.resource.id;
  }
};

/** Mixed content. Vertical Shorts get a strip of their own, since they'd stretch a shared grid. */
export function MixedContent({ items }: { items: ResolvedContent[] }) {
  const shorts = items.flatMap((item) => (item.type === "VIDEO" && item.video.kind === "SHORT" ? [item.video] : []));
  const others = items.filter((item) => !(item.type === "VIDEO" && item.video.kind === "SHORT"));

  return (
    <div className="space-y-4">
      {others.length ? (
        <div className={cardGridClass}>
          {others.map((item) => (
            <ContentCard key={itemKey(item)} item={item} />
          ))}
        </div>
      ) : null}
      {shorts.length ? <ShortsStrip videos={shorts} /> : null}
    </div>
  );
}
