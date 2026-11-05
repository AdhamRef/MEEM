import type { Metadata } from "next";
import { connection } from "next/server";
import { ExternalLink, LegalPage, ResponsibleParty } from "@/components/legal/legal-page";
import { strings } from "@/config/strings.ar";

const t = strings.legal.terms;

export const metadata: Metadata = { title: t.title, description: t.intro, alternates: { canonical: "/terms" } };

export default async function TermsPage() {
  await connection();
  return (
    <LegalPage
      testId="terms-page"
      title={t.title}
      intro={t.intro}
      sections={[
        ...t.sections.map((section) => ({ heading: section.heading, body: <p>{section.body}</p> })),
        {
          heading: t.youtubeHeading,
          body: (
            <p>
              {t.youtubeBody} <ExternalLink href="https://www.youtube.com/t/terms">{strings.legal.privacy.youtubeTerms}</ExternalLink>.
            </p>
          ),
        },
        { heading: strings.legal.responsibleHeading, body: <ResponsibleParty /> },
      ]}
    />
  );
}
