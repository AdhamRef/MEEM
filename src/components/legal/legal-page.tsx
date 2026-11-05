import type { ReactNode } from "react";
import { strings } from "@/config/strings.ar";
import { getEnv } from "@/config/env";

/** Shared layout. Text comes from the strings module, and is the same for everyone. */
export function LegalPage({ title, intro, sections, testId }: { title: string; intro: string; sections: { heading: string; body: ReactNode }[]; testId: string }) {
  return (
    <article className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 leading-loose" data-testid={testId}>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="text-text-secondary">{intro}</p>
      </header>
      {sections.map((section) => (
        <section key={section.heading} className="space-y-2">
          <h2 className="text-xl font-semibold">{section.heading}</h2>
          <div className="space-y-2 text-text-secondary">{section.body}</div>
        </section>
      ))}
    </article>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-4">
      {children}
    </a>
  );
}

/** Says plainly when the owner hasn't supplied these yet, rather than showing invented details. */
export function ResponsibleParty() {
  const { LEGAL_RESPONSIBLE_NAME: name, LEGAL_CONTACT_EMAIL: email } = getEnv();
  const l = strings.legal;
  return (
    <div data-testid="legal-contact">
      <p>
        {l.responsible}: {name ? <bdi>{name}</bdi> : l.notProvided}
      </p>
      <p>
        {l.contact}:{" "}
        {email ? (
          <a href={`mailto:${email}`} className="text-brand underline underline-offset-4">
            <bdi>{email}</bdi>
          </a>
        ) : (
          l.notProvided
        )}
      </p>
    </div>
  );
}
