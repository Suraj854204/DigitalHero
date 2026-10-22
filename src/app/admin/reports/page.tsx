import type { Metadata } from "next";
import { buttonClass } from "@/components/ui/button-styles";
import { Alert, Card, Input, Money, PageHeader, Select, Table } from "@/components/ui/primitives";
import { getReport, isReportType, REPORT_TYPES, type ReportType } from "@/lib/admin/reports";
import { daysAgoISO } from "@/lib/format";
import { requireAdminPage } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Reports" };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const validDate = (v: string | undefined, fb: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fb);

export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const type: ReportType = sp.type && isReportType(sp.type) ? sp.type : "revenue";
  const to = validDate(sp.to, iso(new Date()));
  const from = validDate(sp.from, daysAgoISO(180).slice(0, 10));
  const [rows, recon] = await Promise.all([getReport(type, from, to), createAdminClient().from("v_reconciliation").select("check_name, ledger_minor, source_minor")]);
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const q = new URLSearchParams({ type, from, to }).toString();
  const bad = (recon.data ?? []).filter((r) => Number(r.ledger_minor) !== Number(r.source_minor));
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Reports" title="Numbers you can" accent="trace to the ledger.">Every figure comes from ledger-backed tables. Amounts are in paise in exports.</PageHeader>
      <form className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
        <div><label htmlFor="type" className="mb-1 block text-sm font-semibold">Report</label><Select name="type" id="type" defaultValue={type}>{Object.entries(REPORT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
        <div><label htmlFor="from" className="mb-1 block text-sm font-semibold">From</label><Input type="date" name="from" id="from" defaultValue={from} /></div>
        <div><label htmlFor="to" className="mb-1 block text-sm font-semibold">To</label><Input type="date" name="to" id="to" defaultValue={to} /></div>
        <button className={buttonClass("primary")}>Run</button>
      </form>
      <div className="flex items-center justify-between"><h2 className="text-lg font-bold">{REPORT_TYPES[type]} <span className="text-sm font-normal text-muted">({rows.length} rows)</span></h2><a className={buttonClass("secondary", "sm")} href={`/admin/reports/export?${q}`}>Download CSV</a></div>
      {rows.length === 0 ? <Alert tone="info">No data in this range.</Alert> : <Table caption={REPORT_TYPES[type]} head={cols.map((c) => c.replaceAll("_", " "))}>{rows.slice(0, 200).map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{c.endsWith("_minor") ? <Money minor={r[c] as number} /> : String(r[c] ?? "-")}</td>)}</tr>)}</Table>}
      {rows.length > 200 && <p className="text-sm text-muted">Showing the first 200 rows. The CSV contains all of them.</p>}
      <Card><h2 className="font-bold">Ledger reconciliation</h2>{bad.length > 0 && <Alert tone="error" className="my-3">{bad.length} check(s) don't balance. Investigate before releasing payouts.</Alert>}
        <Table caption="Reconciliation checks" head={["Check", "Ledger", "Source", "Result"]}>{(recon.data ?? []).map((r) => { const ok = Number(r.ledger_minor) === Number(r.source_minor); return <tr key={r.check_name}><td>{r.check_name}</td><td><Money minor={r.ledger_minor} /></td><td><Money minor={r.source_minor} /></td><td className={ok ? "font-semibold text-ok" : "font-semibold text-danger"}>{ok ? "Balanced" : "MISMATCH"}</td></tr>; })}</Table></Card>
    </div>
  );
}
