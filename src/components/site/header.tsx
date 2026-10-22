"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button-styles";
import { Logo } from "./logo";

const LINKS = [
  { href: "/charities", label: "Charities" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/prizes", label: "Prizes" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteHeader({ signedIn, isAdmin }: { signedIn: boolean; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-paper/85 backdrop-blur-md">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">Skip to content</a>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Logo />
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={path.startsWith(l.href) ? "page" : undefined} className={cn("rounded-full px-4 py-2 text-sm font-medium text-ink-2 transition hover:bg-paper-2", path.startsWith(l.href) && "bg-paper-2 text-ink")}>{l.label}</Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          {signedIn ? (
            <>
              {isAdmin && <Link href="/admin" className={buttonClass("ghost", "sm")}>Admin</Link>}
              <Link href="/app" className={buttonClass("primary", "sm")}>Your dashboard</Link>
            </>
          ) : (
            <>
              <Link href="/login" className={buttonClass("ghost", "sm")}>Log in</Link>
              <Link href="/signup" className={buttonClass("coral", "sm")}>Join now</Link>
            </>
          )}
        </div>
        <button type="button" className="rounded-full p-2 md:hidden" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((v) => !v)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Mobile" className="border-t border-line bg-paper px-5 pb-5 pt-3 md:hidden">
          <ul className="space-y-1">
            {LINKS.map((l) => (<li key={l.href}><Link onClick={() => setOpen(false)} href={l.href} className="block rounded-xl px-3 py-3 font-medium hover:bg-paper-2">{l.label}</Link></li>))}
          </ul>
          <div className="mt-4 flex gap-2">
            {signedIn ? (
              <Link onClick={() => setOpen(false)} href="/app" className={cn(buttonClass("primary"), "flex-1")}>Your dashboard</Link>
            ) : (
              <>
                <Link onClick={() => setOpen(false)} href="/login" className={cn(buttonClass("secondary"), "flex-1")}>Log in</Link>
                <Link onClick={() => setOpen(false)} href="/signup" className={cn(buttonClass("coral"), "flex-1")}>Join now</Link>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
