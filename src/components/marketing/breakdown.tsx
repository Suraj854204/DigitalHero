import { splitPayment } from "@/lib/draw-engine/contributions";
import { bpsToPercent, formatMoney } from "@/lib/format";

/** Illustrative split computed with the SAME integer function the ledger uses. */
export function ContributionBreakdown({ amountMinor, charityBps, poolBps, label }: { amountMinor: number; charityBps: number; poolBps: number; label: string }) {
  const s = splitPayment(amountMinor, { charityBps, poolBps });
  const parts = [
    { name: "Your charity", minor: s.charityMinor, color: "bg-coral", note: `${bpsToPercent(charityBps)} (minimum 10%)` },
    { name: "Monthly prize pool", minor: s.poolMinor, color: "bg-forest", note: bpsToPercent(poolBps) },
    { name: "Running the platform", minor: s.platformMinor, color: "bg-ink/70", note: bpsToPercent(10000 - charityBps - poolBps) },
  ];
  return (
    <figure aria-label={label}>
      <div className="flex h-5 overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.name} ${formatMoney(p.minor)}`).join(", ")}>
        {parts.map((p) => (<div key={p.name} className={p.color} style={{ width: `${(p.minor / s.amountMinor) * 100}%` }} />))}
      </div>
      <ul className="mt-5 space-y-3">
        {parts.map((p) => (
          <li key={p.name} className="flex items-baseline justify-between gap-4 text-sm">
            <span className="flex items-center gap-2"><span aria-hidden className={`size-3 rounded-full ${p.color}`} />{p.name} <span className="text-muted">· {p.note}</span></span>
            <span className="font-semibold tabular-nums">{formatMoney(p.minor)}</span>
          </li>
        ))}
      </ul>
      <figcaption className="mt-4 text-xs text-muted">Illustration of a {formatMoney(amountMinor)} payment at the current default settings. Your own split is shown on every receipt.</figcaption>
    </figure>
  );
}
