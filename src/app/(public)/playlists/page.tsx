import { ListVideo } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { cardGridClass, PlaylistCard } from "@/components/knowledge/content-cards";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { listPublicPlaylists } from "@/features/playlists/playlists.service";

export const metadata: Metadata = { title: strings.playlists.pageTitle, description: strings.playlists.pageDescription, alternates: { canonical: "/playlists" } };

export default async function PlaylistsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  await connection();
  const { cursor } = await searchParams;
  const playlists = await listPublicPlaylists({ cursor });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 md:px-8">
      <header className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-semibold">{strings.playlists.pageTitle}</h1>
        <p className="text-text-secondary">{strings.playlists.pageDescription}</p>
      </header>

      {playlists.items.length ? (
        <>
          <div className={cardGridClass} data-testid="playlist-list">
            {playlists.items.map((playlist) => (
              <PlaylistCard key={playlist.id} playlist={playlist} />
            ))}
          </div>
          {playlists.nextCursor ? (
            <div className="text-center">
              <Button asChild variant="secondary">
                <Link href={`/playlists?cursor=${playlists.nextCursor}`}>{strings.content.showMore}</Link>
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <StateMessage icon={ListVideo} title={strings.playlists.emptyTitle} description={strings.playlists.emptyDescription} />
      )}
    </div>
  );
}
