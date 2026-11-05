import { Library } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { cardGridClass, LibraryCard } from "@/components/knowledge/content-cards";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { listPublishedLibraries } from "@/features/libraries/libraries.service";

export const metadata: Metadata = { title: strings.libraries.pageTitle, description: strings.libraries.pageDescription, alternates: { canonical: "/libraries" } };

export default async function LibrariesPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  await connection();
  const { cursor } = await searchParams;
  const libraries = await listPublishedLibraries({ cursor });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 md:px-8">
      <header className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-semibold">{strings.libraries.pageTitle}</h1>
        <p className="text-text-secondary">{strings.libraries.pageDescription}</p>
      </header>

      {libraries.items.length ? (
        <>
          <div className={cardGridClass} data-testid="library-list">
            {libraries.items.map((library) => (
              <LibraryCard key={library.id} library={library} />
            ))}
          </div>
          {libraries.nextCursor ? (
            <div className="text-center">
              <Button asChild variant="secondary">
                <Link href={`/libraries?cursor=${libraries.nextCursor}`}>{strings.content.showMore}</Link>
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <StateMessage icon={Library} title={strings.libraries.emptyTitle} description={strings.libraries.emptyDescription} />
      )}
    </div>
  );
}
