"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export interface NavItem { href: string; label: string; badge?: number }

export function SideNav({ items, label, exact = [] }: { items: NavItem[]; label: string; exact?: string[] }) {
  const path = usePathname();
  const active = (href: string) => (exact.includes(href) ? path === href : path === href || path.startsWith(href + "/"));
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined}
          className={cn("flex items-center justify-between gap-3 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-medium text-ink-2 transition hover:bg-paper-2 lg:rounded-[var(--radius-md)]", active(i.href) && "bg-forest text-white hover:bg-forest")}>
          <span>{i.label}</span>
          {!!i.badge && <span className="rounded-full bg-coral px-2 py-0.5 text-xs font-bold text-white">{i.badge}</span>}
        </Link>
      ))}
    </nav>
  );
}
