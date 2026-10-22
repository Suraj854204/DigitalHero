"use client";
import Link from "next/link";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { Alert, Input } from "@/components/ui/primitives";

type Pick = { slug: string; name: string; reason: string };

export function CharityAssistant() {
  const [q, setQ] = useState("");
  const [state, setState] = useState<{ loading: boolean; picks?: Pick[]; note?: string; error?: string; source?: string }>({ loading: false });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ loading: true });
    try {
      const res = await fetch("/api/ai/charity-assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) });
      const json = await res.json();
      if (!res.ok) setState({ loading: false, error: json.error ?? "Something went wrong." });
      else setState({ loading: false, picks: json.picks, note: json.note, source: json.source });
    } catch {
      setState({ loading: false, error: "We couldn't reach the suggestion service. You can still browse below." });
    }
  }

  return (
    <section aria-labelledby="assist" className="rounded-[var(--radius-lg)] border border-line bg-mint/40 p-6">
      <h2 id="assist" className="text-lg font-bold">Not sure where to start?</h2>
      <p className="mt-1 text-sm text-ink-2">Describe what matters to you and we'll suggest charities from the list below.</p>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <label htmlFor="assist-q" className="sr-only">What cause matters to you?</label>
        <Input name="assist-q" id="assist-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. helping kids learn, or protecting rivers" maxLength={300} required minLength={3} />
        <button className={buttonClass("primary")} disabled={state.loading}>{state.loading ? "Thinking…" : "Suggest"}</button>
      </form>
      <div aria-live="polite" className="mt-4 space-y-3">
        {state.error && <Alert tone="error">{state.error}</Alert>}
        {state.note && <Alert>{state.note}</Alert>}
        {state.picks?.map((p) => (
          <div key={p.slug} className="rounded-[var(--radius-md)] bg-card p-4">
            <Link href={`/charities/${p.slug}`} className="font-semibold text-forest underline underline-offset-4">{p.name}</Link>
            <p className="mt-1 text-sm text-ink-2">{p.reason}</p>
          </div>
        ))}
        {state.picks && state.picks.length > 0 && <p className="text-xs text-muted">{state.source === "ai" ? "Suggested with AI from the charities listed here. Always read the full profile before choosing." : "Matched by keywords from the charities listed here."}</p>}
      </div>
    </section>
  );
}
