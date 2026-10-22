import type { Metadata } from "next";
import Link from "next/link";
import { CharityAssistant } from "@/components/marketing/charity-assistant";
import { CharityArt } from "@/components/ui/charity-art";
import { Badge, Card, DemoBadge, EmptyState, Input, PageHeader, Pagination, Select } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/button-styles";
import { getCharities } from "@/lib/data/public";

export const metadata: Metadata = { title: "Charities", description: "Browse the charities you can support with your subscription." };

export default async function CharitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(Number.parseInt(sp.page ?? "1", 10) || 1, 1);
  const data = await getCharities({ q: sp.q, category: sp.category, location: sp.location, page, pageSize: 9 });
  const filtered = !!(sp.q || sp.category || sp.location);

  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <PageHeader eyebrow="Charity directory" title="Choose a cause" accent="you believe in.">
        Every subscription sends at least 10% to the charity you choose. Browse, filter, and read each profile before you decide.
      </PageHeader>
      {data.isDemoSource && <div className="mb-6"><DemoBadge label="Showing demo charities: database not connected" /></div>}

      <form role="search" aria-label="Filter charities" className="mb-8 grid gap-3 rounded-[var(--radius-lg)] border border-line bg-card p-4 sm:grid-cols-[1.6fr_1fr_1fr_auto]">
        <div><label htmlFor="q" className="sr-only">Search</label><Input name="q" type="search" defaultValue={sp.q} placeholder="Search by name or cause" /></div>
        <div><label htmlFor="category" className="sr-only">Category</label>
          <Select name="category" defaultValue={sp.category ?? ""}><option value="">All categories</option>{data.categories.map((c) => <option key={c}>{c}</option>)}</Select></div>
        <div><label htmlFor="location" className="sr-only">Location</label>
          <Select name="location" defaultValue={sp.location ?? ""}><option value="">All locations</option>{data.locations.map((c) => <option key={c}>{c}</option>)}</Select></div>
        <button className={buttonClass("primary")}>Filter</button>
      </form>

      <div className="mb-10"><CharityAssistant /></div>

      {data.items.length === 0 ? (
        <EmptyState title={filtered ? "No charities match those filters" : "No charities yet"} action={filtered ? <Link className={buttonClass("secondary", "sm")} href="/charities">Clear filters</Link> : undefined}>
          {filtered ? "Try a different search term, or clear the filters to see everyone." : "Charities will appear here as soon as an administrator publishes them."}
        </EmptyState>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((c) => (
            <li key={c.id}>
              <Link href={`/charities/${c.slug}`} className="block h-full">
                <Card className="card-lift h-full overflow-hidden p-0">
                  <CharityArt slug={c.slug} className="h-36 w-full" label={c.image_alt ?? `Artwork for ${c.name}`} />
                  <div className="p-5">
                    <div className="flex flex-wrap gap-2">{c.category && <Badge tone="green">{c.category}</Badge>}{c.is_featured && <Badge tone="coral">Featured</Badge>}{c.is_demo && <DemoBadge label="Demo" />}</div>
                    <h2 className="mt-3 text-lg font-bold leading-snug">{c.name}</h2>
                    <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-2">{c.short_description}</p>
                    {c.location && <p className="mt-3 text-xs text-muted">{c.location}</p>}
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/charities" params={{ q: sp.q, category: sp.category, location: sp.location }} />
    </div>
  );
}
