import { Compass, Search, SearchX, Timer } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { MixedContent } from "@/components/knowledge/content-card";
import { selectClass } from "@/components/admin/content/list-frame";
import { SearchBox } from "@/components/search/search-box";
import { StateMessage } from "@/components/shared/state-message";
import { Button } from "@/components/ui/button";
import { strings } from "@/config/strings.ar";
import { listActiveCategories } from "@/features/categories/categories.service";
import { CATEGORIZED_TYPES, searchContent, SEARCH_TYPES, type SearchGroup, type SearchResult, type SearchType } from "@/features/search/search.service";
import { AppError } from "@/lib/errors";
import { clientAddress, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { cn } from "@/lib/utils";

const s = strings.search;

// Results vary endlessly and change often, so they shouldn't be indexed as pages.
export const metadata: Metadata = { title: s.pageTitle, description: s.pageDescription, robots: { index: false, follow: true } };

interface PageProps {
  searchParams: Promise<{ q?: string; type?: string; category?: string; page?: string }>;
}

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function searchHref(params: { q: string; type?: string; category?: string; page?: number }): string {
  const query = new URLSearchParams({ q: params.q });
  if (params.type) query.set("type", params.type);
  if (params.category) query.set("category", params.category);
  if (params.page && params.page > 1) query.set("page", String(params.page));
  return `/search?${query.toString()}`;
}

async function runSearch(input: { query: string; type?: string; categoryId?: string; page?: string }): Promise<SearchResult | "RATE_LIMITED"> {
  try {
    await enforceRateLimit(RATE_LIMITS.search, clientAddress(await headers()));
  } catch (error) {
    if (error instanceof AppError && error.code === "RATE_LIMITED") return "RATE_LIMITED";
    throw error;
  }
  return searchContent(input);
}

function TypeTabs({ query, active, category, types }: { query: string; active?: SearchType; category?: string; types: readonly SearchType[] }) {
  const chip = "inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50";
  const selected = "border-brand bg-surface-elevated";
  const idle = "bg-surface hover:bg-surface-elevated";

  return (
    <nav aria-label={s.typesLabel}>
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" data-testid="search-types">
        <li>
          <Link href={searchHref({ q: query, category })} aria-current={active ? undefined : "page"} className={cn(chip, active ? idle : selected)}>
            {s.allTypes}
          </Link>
        </li>
        {types.map((type) => (
          <li key={type}>
            <Link href={searchHref({ q: query, type, category })} aria-current={active === type ? "page" : undefined} className={cn(chip, active === type ? selected : idle)} data-testid={`search-type-${type}`}>
              {s.types[type]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function GroupSection({ group, query, category }: { group: SearchGroup; query: string; category?: string }) {
  const headingId = `results-${group.type}`;
  return (
    <section aria-labelledby={headingId} data-testid={`search-group-${group.type}`}>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id={headingId} className="text-lg font-semibold">
          {s.types[group.type]}
        </h2>
        {group.hasMore ? (
          <Link href={searchHref({ q: query, type: group.type, category })} className="text-sm text-brand underline-offset-4 hover:underline" data-testid={`search-more-${group.type}`}>
            {s.viewAll}
          </Link>
        ) : null}
      </div>
      <MixedContent items={group.items} />
    </section>
  );
}

function NoResults({ title, description }: { title: string; description: string }) {
  return (
    <StateMessage
      icon={SearchX}
      title={title}
      description={description}
      action={
        <Button asChild variant="secondary">
          <Link href="/explore">
            <Compass aria-hidden data-icon="inline-start" />
            {s.browseExplore}
          </Link>
        </Button>
      }
    />
  );
}

export default async function SearchPage({ searchParams }: PageProps) {
  await connection();
  const params = await searchParams;
  const rawQuery = (single(params.q) ?? "").slice(0, 120);
  const categorySlug = single(params.category);

  const categories = await listActiveCategories();
  const selectedCategory = categories.find((category) => category.slug === categorySlug);
  const result = await runSearch({ query: rawQuery, type: single(params.type), categoryId: selectedCategory?.id, page: single(params.page) });

  const activeType = result !== "RATE_LIMITED" && result.status === "TYPE" ? result.type : undefined;
  const availableTypes = selectedCategory ? SEARCH_TYPES.filter((type) => CATEGORIZED_TYPES.includes(type)) : SEARCH_TYPES;
  const hasQuery = result !== "RATE_LIMITED" && result.status !== "EMPTY_QUERY";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 md:px-8" data-testid="search-page">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">{s.pageTitle}</h1>
        <p className="text-text-secondary">{s.pageDescription}</p>
      </header>

      <SearchBox initialQuery={rawQuery}>
        {activeType ? <input type="hidden" name="type" value={activeType} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="search-category" className="text-sm text-text-secondary">
            {s.categoryLabel}
          </label>
          <select id="search-category" name="category" defaultValue={selectedCategory?.slug ?? ""} className={`${selectClass} w-auto min-w-44`} data-testid="search-category">
            <option value="">{s.allCategories}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.slug}>
                {category.title}
              </option>
            ))}
          </select>
        </div>
        {selectedCategory ? <p className="text-xs text-text-secondary">{s.categoryNote}</p> : null}
      </SearchBox>

      {result === "RATE_LIMITED" ? <StateMessage icon={Timer} title={s.rateLimitedTitle} description={s.rateLimitedDescription} role="alert" /> : null}

      {result !== "RATE_LIMITED" && result.status === "EMPTY_QUERY" ? (
        <StateMessage
          icon={Search}
          title={s.promptTitle}
          description={s.promptDescription}
          action={
            <Button asChild variant="secondary">
              <Link href="/explore">
                <Compass aria-hidden data-icon="inline-start" />
                {s.browseExplore}
              </Link>
            </Button>
          }
        />
      ) : null}

      {hasQuery ? (
        <>
          <h2 className="text-base text-text-secondary" data-testid="search-summary">
            {s.resultsFor} <bdi className="font-semibold text-text-primary">{rawQuery}</bdi>
          </h2>
          <TypeTabs query={rawQuery} active={activeType} category={selectedCategory?.slug} types={availableTypes} />
        </>
      ) : null}

      {result !== "RATE_LIMITED" && result.status === "OVERVIEW" ? (
        result.groups.length ? (
          <div className="space-y-10" data-testid="search-results">
            {result.groups.map((group) => (
              <GroupSection key={group.type} group={group} query={rawQuery} category={selectedCategory?.slug} />
            ))}
          </div>
        ) : (
          <NoResults title={s.noResultsTitle} description={s.noResultsDescription} />
        )
      ) : null}

      {result !== "RATE_LIMITED" && result.status === "TYPE" ? (
        result.group.items.length ? (
          <div className="space-y-6" data-testid="search-results">
            <MixedContent items={result.group.items} />
            <nav aria-label={s.pageNumber(result.page)} className="flex flex-wrap items-center gap-4 text-sm">
              {result.group.hasMore ? (
                <Button asChild variant="secondary">
                  <Link href={searchHref({ q: rawQuery, type: result.type, category: selectedCategory?.slug, page: result.page + 1 })} data-testid="search-next">
                    {s.nextPage}
                  </Link>
                </Button>
              ) : null}
              {result.page > 1 ? (
                <Link href={searchHref({ q: rawQuery, type: result.type, category: selectedCategory?.slug })} className="text-text-secondary underline-offset-4 hover:underline" data-testid="search-first">
                  {s.backToStart}
                </Link>
              ) : null}
            </nav>
          </div>
        ) : (
          <NoResults title={s.noResultsTitle} description={s.noResultsDescription} />
        )
      ) : null}
    </div>
  );
}
