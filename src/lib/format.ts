/** Money is stored in integer paise. Formatting is the ONLY place we divide, and only for display. */
export function formatMoney(minor: number | bigint | string | null | undefined, currency = "INR"): string {
  const n = Number(minor ?? 0);
  const whole = Math.trunc(n / 100);
  const frac = Math.abs(n % 100);
  const sign = n < 0 ? "-" : "";
  const grouped = new Intl.NumberFormat("en-IN").format(Math.abs(whole));
  const symbol = currency.toUpperCase() === "INR" ? "₹" : currency.toUpperCase() + " ";
  return `${sign}${symbol}${grouped}${frac ? "." + String(frac).padStart(2, "0") : ""}`;
}

export function formatDate(d: string | Date | null | undefined, withTime = false): string {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "UTC",
  }).format(date);
}

export function formatMonth(d: string | Date): string {
  const date = typeof d === "string" ? new Date(`${d.slice(0, 10)}T00:00:00Z`) : d;
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** CSV with formula-injection protection (cells starting with = + - @ are prefixed). */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

/** ISO timestamp for N days before now. Lives here (not in components) so pages stay render-pure. */
export function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
