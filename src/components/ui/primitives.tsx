import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import { buttonClass, type ButtonVariant } from "./button-styles";

export function LinkButton({ href, children, variant = "primary", size = "md", className }: { href: string; children: React.ReactNode; variant?: ButtonVariant; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <Link href={href} className={cn(buttonClass(variant, size), className)}>
      {children}
    </Link>
  );
}

export function Card({ children, className, as: Tag = "div" }: { children: React.ReactNode; className?: string; as?: "div" | "section" | "article" }) {
  return <Tag className={cn("rounded-[var(--radius-lg)] border border-line bg-card p-6 shadow-soft", className)}>{children}</Tag>;
}

const tones = {
  neutral: "bg-paper-2 text-ink-2",
  green: "bg-mint text-forest-2",
  coral: "bg-coral-soft text-[#8a3416]",
  gold: "bg-[#f3e6c4] text-[#6d4e0c]",
  red: "bg-[#f6d7d0] text-danger",
  demo: "border border-dashed border-gold bg-[#fbf3dc] text-[#6d4e0c]",
} as const;

export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: keyof typeof tones; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide", tones[tone], className)}>{children}</span>;
}

export function DemoBadge({ label = "Demo data" }: { label?: string }) {
  return <Badge tone="demo">{label}</Badge>;
}

const statusTone: Record<string, keyof typeof tones> = {
  active: "green", approved: "green", paid: "green", published: "green", processed: "green",
  canceling: "gold", pending: "gold", pending_review: "gold", payout_pending: "gold", simulated: "gold", claimed: "gold", incomplete: "gold",
  past_due: "red", lapsed: "red", rejected: "red", failed: "red", canceled: "neutral", cancelled: "neutral",
  draft: "neutral", not_submitted: "neutral", inactive: "neutral", archived: "neutral",
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

export function Alert({ children, tone = "info", className }: { children: React.ReactNode; tone?: "info" | "error" | "success" | "warn"; className?: string }) {
  const t = { info: "border-forest/30 bg-mint/50 text-forest-2", error: "border-danger/40 bg-[#f9e0da] text-danger", success: "border-ok/40 bg-[#dff1e6] text-ok", warn: "border-gold/50 bg-[#fbf3dc] text-[#6d4e0c]" }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-[var(--radius-md)] border px-4 py-3 text-sm leading-relaxed", t, className)}>
      {children}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-line bg-card/60 px-6 py-12 text-center">
      <p className="font-serif text-xl text-ink">{title}</p>
      {children && <p className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, accent, children, actions }: { eyebrow?: string; title: string; accent?: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        {eyebrow && <p className="mb-2 font-mono text-xs uppercase tracking-[0.18em] text-forest">{eyebrow}</p>}
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          {title} {accent && <span className="serif-accent">{accent}</span>}
        </h1>
        {children && <p className="mt-3 text-base leading-relaxed text-ink-2">{children}</p>}
      </div>
      {actions}
    </header>
  );
}

export function Money({ minor, className }: { minor: number | string | null | undefined; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{formatMoney(minor)}</span>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "coral" }) {
  return (
    <Card className="p-5">
      <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className={cn("mt-2 text-3xl font-bold tabular-nums tracking-tight", tone === "coral" && "text-coral")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

export function Field({ label, name, error, hint, children }: { label: string; name: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p id={`${name}-error`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  "w-full rounded-[var(--radius-md)] border border-line bg-white px-4 py-3 text-base text-ink placeholder:text-muted/70 transition focus:border-forest focus:outline-none focus:ring-4 focus:ring-mint aria-[invalid=true]:border-danger";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { name: string; invalid?: boolean }) {
  const { invalid, className, ...rest } = props;
  return <input id={props.name} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${props.name}-error` : undefined} className={cn(inputClass, className)} {...rest} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { name: string }) {
  const { className, ...rest } = props;
  return <select id={props.name} className={cn(inputClass, "appearance-none bg-[length:1rem] pr-10", className)} {...rest} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { name: string; invalid?: boolean }) {
  const { invalid, className, ...rest } = props;
  return <textarea id={props.name} aria-invalid={invalid || undefined} className={cn(inputClass, "min-h-32", className)} {...rest} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton h-5 w-full", className)} />;
}

export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-6">
      <Skeleton className="h-10 w-72" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function Table({ head, children, caption }: { head: string[]; children: React.ReactNode; caption?: string }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-card shadow-soft">
      <table className="w-full min-w-[640px] text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="border-b border-line bg-paper-2/60 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">
          <tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line [&_td]:px-4 [&_td]:py-3 [&_td]:align-middle">{children}</tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, basePath, params = {} }: { page: number; pageSize: number; total: number; basePath: string; params?: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };
  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">Page {page} of {pages} · {total} results</span>
      <div className="flex gap-2">
        {page > 1 && <Link className={buttonClass("secondary", "sm")} href={href(page - 1)}>Previous</Link>}
        {page < pages && <Link className={buttonClass("secondary", "sm")} href={href(page + 1)}>Next</Link>}
      </div>
    </nav>
  );
}
