import { bpsToPercent } from "@/lib/format";
import { Card } from "@/components/ui/primitives";

type Cfg = { shareBps: Record<string, number>; rollover: Record<string, boolean>; unclaimedPolicy: string };

export function TierCards({ cfg }: { cfg: Cfg }) {
  const tiers = [
    { n: 5, name: "Jackpot", desc: "All five numbers match." },
    { n: 4, name: "Four of five", desc: "Four of your scores match." },
    { n: 3, name: "Three of five", desc: "Three of your scores match." },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {tiers.map((t) => (
        <Card key={t.n} className={t.n === 5 ? "border-coral/40 bg-coral-soft/40" : ""}>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted">{t.name}</p>
          <p className="mt-3 text-5xl font-bold tracking-tight">{t.n}<span className="serif-accent text-2xl"> matches</span></p>
          <p className="mt-3 text-sm text-ink-2">{t.desc}</p>
          <p className="mt-4 border-t border-line pt-4 text-sm">
            <strong className="text-lg tabular-nums">{bpsToPercent(cfg.shareBps[String(t.n)])}</strong> of the prize pool, shared equally between winners in the tier.
          </p>
          {cfg.rollover[String(t.n)] && <p className="mt-2 text-xs font-semibold text-[#8a3416]">Unclaimed? It rolls over to next month's jackpot.</p>}
        </Card>
      ))}
    </div>
  );
}
