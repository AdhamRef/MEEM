import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { InterestsManager } from "@/components/preferences/interests-manager";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { getInterestCatalogue } from "@/features/topics/catalogue.service";

export const metadata: Metadata = {
  title: strings.interests.pageTitle,
  robots: { index: false, follow: false },
};

// Reads the database, which isn't available while the site is being built.
export const dynamic = "force-dynamic";

export default async function InterestsPage() {
  const catalogue = await getInterestCatalogue();

  if (catalogue.channels.length === 0) {
    return <StateMessage icon={Sparkles} headingLevel="h1" title={strings.interests.emptyTitle} description={strings.interests.emptyDescription} />;
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 pt-8 md:px-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">{strings.interests.pageTitle}</h1>
        <p className="text-text-secondary">{strings.interests.pageDescription}</p>
      </header>
      <InterestsManager catalogue={catalogue} />
    </div>
  );
}
