/**
 * Generated abstract artwork for charities that have no uploaded image. Deterministic per slug.
 * We deliberately do NOT use stock photography of real beneficiaries: that would imply a real
 * relationship. Admins can upload real, licensed images per charity.
 */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const PALETTES = [
  ["#1f5a46", "#cfe3d6", "#d9603b"],
  ["#17463a", "#f8dccf", "#b9892b"],
  ["#d9603b", "#f6f1e9", "#1f5a46"],
  ["#b9892b", "#cfe3d6", "#17463a"],
];
export function CharityArt({ slug, className = "", label }: { slug: string; className?: string; label?: string }) {
  const h = hash(slug);
  const [a, b, c] = PALETTES[h % PALETTES.length];
  const r1 = 40 + (h % 50), r2 = 30 + ((h >>> 4) % 40), r3 = 18 + ((h >>> 8) % 28);
  const x1 = 30 + ((h >>> 3) % 40), y2 = 35 + ((h >>> 6) % 40);
  return (
    <svg viewBox="0 0 200 140" role="img" aria-label={label ?? "Abstract artwork"} className={className} preserveAspectRatio="xMidYMid slice">
      <rect width="200" height="140" fill={b} />
      <circle cx={x1} cy="70" r={r1} fill={a} opacity="0.92" />
      <circle cx={150} cy={y2} r={r2} fill={c} opacity="0.85" />
      <circle cx="110" cy="115" r={r3} fill={a} opacity="0.55" />
      <path d={`M0 ${100 + (h % 20)} Q 60 ${70 + (h % 30)} 120 ${105} T 200 ${90 + (h % 15)} V140 H0Z`} fill={a} opacity="0.35" />
    </svg>
  );
}
