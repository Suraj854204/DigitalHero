import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CharityArt } from "@/components/ui/charity-art";
import { Badge, Card, DemoBadge, LinkButton } from "@/components/ui/primitives";
import { getCharityBySlug, getCharityEvents } from "@/lib/data/public";
import { formatDate } from "@/lib/format";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await getCharityBySlug((await params).slug);
  return c ? { title: c.name, description: c.short_description ?? undefined } : { title: "Charity not found" };
}

export default async function CharityPage({ params }: Props) {
  const c = await getCharityBySlug((await params).slug);
  if (!c) notFound();
  const events = await getCharityEvents(c.id);

  return (
    <article className="mx-auto max-w-5xl px-5 py-14">
      <Link href="/charities" className="text-sm font-semibold text-forest underline underline-offset-4">← All charities</Link>
      <div className="mt-6 overflow-hidden rounded-[var(--radius-lg)] border border-line">
        <CharityArt slug={c.slug} className="h-56 w-full sm:h-72" label={c.image_alt ?? `Artwork for ${c.name}`} />
      </div>
      <div className="mt-8 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <div className="flex flex-wrap gap-2">{c.category && <Badge tone="green">{c.category}</Badge>}{c.location && <Badge>{c.location}</Badge>}{c.is_demo && <DemoBadge label="Demo charity" />}</div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight">{c.name}</h1>
          <div className="mt-6 space-y-4 leading-relaxed text-ink-2">{(c.description ?? c.short_description ?? "").split("\n\n").map((p, i) => <p key={i}>{p}</p>)}</div>
          {c.website_url && <p className="mt-6"><a className="font-semibold text-forest underline underline-offset-4" href={c.website_url} rel="noopener noreferrer nofollow" target="_blank">Visit their website ↗</a></p>}

          <h2 className="mt-12 text-xl font-bold">Upcoming events</h2>
          {events.length === 0 ? <p className="mt-3 text-sm text-muted">No events are listed for this charity right now.</p> : (
            <ul className="mt-4 space-y-3">{events.map((e) => (<li key={e.id}><Card className="p-4"><p className="font-semibold">{e.title}</p><p className="text-sm text-muted">{formatDate(e.starts_at, true)}{e.location ? ` · ${e.location}` : ""}</p>{e.description && <p className="mt-2 text-sm text-ink-2">{e.description}</p>}</Card></li>))}</ul>
          )}
        </div>
        <aside>
          <Card className="sticky top-24">
            <h2 className="text-lg font-bold">Support {c.is_demo ? "this demo charity" : "this charity"}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">Choose it when you join. At least 10% of every payment is recorded as a contribution to your charity, and you can change your choice any time.</p>
            <div className="mt-5 flex flex-col gap-2">
              <LinkButton href={`/signup?charity=${c.slug}`} variant="coral">Join and support them</LinkButton>
              <LinkButton href="/pricing" variant="secondary">See pricing</LinkButton>
            </div>
          </Card>
        </aside>
      </div>
    </article>
  );
}
