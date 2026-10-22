import type { Metadata } from "next";
import { Card, LinkButton, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "About" };

export default function About() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <PageHeader eyebrow="About" title="Giving that you can" accent="actually see.">Digital Heroes began with a simple question: what if the rounds people already play could quietly fund causes they care about, and every rupee were visible?</PageHeader>
      <div className="space-y-6 leading-relaxed text-ink-2">
        <p>We combine three things that rarely share a page: a place to record your scores, a monthly prize draw, and a subscription that funds a charity you choose. The giving comes first. The draw is the reason to come back.</p>
        <Card><h2 className="text-lg font-bold text-ink">What we promise</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5"><li>Your charity always receives at least 10% of your payment, recorded in a ledger.</li><li>Draw results can't be changed after they are published.</li><li>We never show impact figures a charity hasn't verified with us.</li><li>Prizes are never guaranteed, and we say so everywhere they appear.</li></ul></Card>
        <p>Digital Heroes is an early-stage product. Where something isn't live yet we label it, rather than pretend.</p>
      </div>
      <div className="mt-10 flex flex-wrap gap-3"><LinkButton href="/charities" variant="coral">Explore charities</LinkButton><LinkButton href="/contact" variant="secondary">Talk to us</LinkButton></div>
    </div>
  );
}
