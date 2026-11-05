import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { InterestsManager } from "@/components/preferences/interests-manager";
import { StateMessage } from "@/components/shared/state-message";
import { strings } from "@/config/strings.ar";
import { listActiveCategories } from "@/features/categories/categories.service";

export const metadata: Metadata = {
  title: strings.interests.pageTitle,
  robots: { index: false, follow: false },
};

// Reads the database, which isn't available while the site is being built.
export const dynamic = "force-dynamic";

export default async function InterestsPage() {
  const categories = await listActiveCategories();

  if (categories.length === 0) {
    return <StateMessage icon={Sparkles} headingLevel="h1" title={strings.interests.emptyTitle} description={strings.interests.emptyDescription} />;
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{strings.interests.pageTitle}</h1>
        <p className="text-text-secondary">{strings.interests.pageDescription}</p>
      </header>
      <InterestsManager categories={categories} />
    </div>
  );
}
