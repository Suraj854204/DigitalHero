import Link from "next/link";
export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" aria-label="Digital Heroes home" className={`inline-flex items-center gap-2 font-bold tracking-tight ${className}`}>
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
        <circle cx="14" cy="14" r="14" fill="#1f5a46" />
        <path d="M14 21.5c-5-3.4-6.8-6-6.8-8.5a3.9 3.9 0 0 1 6.8-2.6A3.9 3.9 0 0 1 20.8 13c0 2.5-1.8 5.100-6.800 8.500Z" fill="#d9603b" />
      </svg>
      <span className="text-lg">Digital<span className="text-forest">Heroes</span><span className="text-coral">.</span></span>
    </Link>
  );
}
