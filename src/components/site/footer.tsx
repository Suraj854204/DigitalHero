import Link from "next/link";
import { Logo } from "./logo";

const COLS: { title: string; links: [string, string][] }[] = [
  { title: "Product", links: [["How it works", "/how-it-works"], ["Prizes & draws", "/prizes"], ["Pricing", "/pricing"], ["FAQ", "/faq"]] },
  { title: "Giving", links: [["Browse charities", "/charities"], ["About us", "/about"]] },
  { title: "Support", links: [["Contact", "/contact"], ["Terms of service", "/terms"], ["Privacy policy", "/privacy"]] },
  { title: "Account", links: [["Log in", "/login"], ["Create account", "/signup"], ["Dashboard", "/app"]] },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-paper-2/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">Play your rounds. Support a cause you choose. Enter a monthly draw. Every figure is shown, nothing is hidden.</p>
        </div>
        {COLS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-forest">{c.title}</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {c.links.map(([label, href]) => (<li key={href}><Link href={href} className="text-ink-2 hover:text-forest hover:underline">{label}</Link></li>))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-5 py-6 text-xs leading-relaxed text-muted">
          Digital Heroes is a charity-giving subscription with a monthly prize draw. Prizes are not guaranteed and depend on participation and results. Please play and give responsibly. © {new Date().getFullYear()} Digital Heroes.
        </p>
      </div>
    </footer>
  );
}
