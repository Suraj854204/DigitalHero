import type { Metadata } from "next";
import { LinkButton, PageHeader } from "@/components/ui/primitives";
import { FAQ } from "@/content/faq";

export const metadata: Metadata = { title: "FAQ" };

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <PageHeader eyebrow="FAQ" title="Questions," accent="answered.">Can't find yours? Ask us and we'll add it.</PageHeader>
      <div className="divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-card">
        {FAQ.map((f) => (
          <details key={f.q} className="group px-6 py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">{f.q}<span aria-hidden className="text-xl text-forest transition group-open:rotate-45">+</span></summary>
            <p className="mt-3 leading-relaxed text-ink-2">{f.a}</p>
          </details>
        ))}
      </div>
      <div className="mt-8"><LinkButton href="/contact" variant="secondary">Contact us</LinkButton></div>
    </div>
  );
}
