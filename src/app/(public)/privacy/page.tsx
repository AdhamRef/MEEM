import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ExternalLink, LegalPage, ResponsibleParty } from "@/components/legal/legal-page";
import { strings } from "@/config/strings.ar";

const p = strings.legal.privacy;

export const metadata: Metadata = { title: p.title, description: p.intro, alternates: { canonical: "/privacy" } };

const list = (items: readonly string[]) => (
  <ul className="list-disc space-y-1 ps-5">
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
);

export default async function PrivacyPage() {
  // The responsible party comes from the running server's settings, not the build's.
  await connection();
  return (
    <LegalPage
      testId="privacy-page"
      title={p.title}
      intro={p.intro}
      sections={[
        { heading: p.guestsHeading, body: list(p.guests) },
        { heading: p.accountsHeading, body: list(p.accounts) },
        { heading: p.technicalHeading, body: list(p.technical) },
        {
          heading: p.youtubeHeading,
          body: (
            <>
              {list(p.youtube)}
              <p>
                {p.youtubeLinksIntro} <ExternalLink href="https://www.youtube.com/t/terms">{p.youtubeTerms}</ExternalLink> {p.and} <ExternalLink href="https://policies.google.com/privacy">{p.googlePrivacy}</ExternalLink>.
              </p>
            </>
          ),
        },
        { heading: p.notDoingHeading, body: list(p.notDoing) },
        {
          heading: p.controlHeading,
          body: (
            <>
              {list(p.control)}
              <p>
                <Link href="/account" className="text-brand underline underline-offset-4">
                  {p.accountLink}
                </Link>
                {" · "}
                <ExternalLink href="https://security.google.com/settings/security/permissions">{p.revokeLink}</ExternalLink>
              </p>
            </>
          ),
        },
        { heading: strings.legal.responsibleHeading, body: <ResponsibleParty /> },
      ]}
    />
  );
}
