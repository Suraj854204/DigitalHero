"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { startCheckout } from "@/app/actions/billing";
import { FormMessage } from "@/components/ui/form-message";
import { buttonClass } from "@/components/ui/button-styles";
import { Field, Input } from "@/components/ui/primitives";
import { splitPayment } from "@/lib/draw-engine/contributions";
import { bpsToPercent, formatMoney } from "@/lib/format";
import { onboardingSchema, type ActionState } from "@/lib/validation";
import { zodResolver } from "@/lib/zod-resolver";

type Charity = { id: string; name: string; category: string | null; is_demo: boolean };
type Plan = { id: string; name: string; interval: string; amount_minor: number };
type Values = { displayName: string; charityId: string; charityPercent: number; plan: "monthly" | "yearly"; acceptTerms: boolean };

export function OnboardingForm({ charities, plans, minPercent, poolBps, defaults }: { charities: Charity[]; plans: Plan[]; minPercent: number; poolBps: number; defaults: Partial<Values> }) {
  const [pending, start] = useTransition();
  const [server, setServer] = useState<ActionState>({ ok: false });
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<Values>({
    resolver: zodResolver<Values>(onboardingSchema),
    defaultValues: { displayName: defaults.displayName ?? "", charityId: defaults.charityId ?? "", charityPercent: Math.max(defaults.charityPercent ?? minPercent, minPercent), plan: defaults.plan ?? "monthly", acceptTerms: false },
  });
  const plan = plans.find((p) => p.id === watch("plan")) ?? plans[0];
  const percent = Number(watch("charityPercent")) || minPercent;
  const bps = Math.round(percent * 100);
  const split = plan && bps >= minPercent * 100 && bps + poolBps <= 10000 ? splitPayment(plan.amount_minor, { charityBps: bps, poolBps }) : null;
  const chosen = charities.find((c) => c.id === watch("charityId"));
  const err = (k: keyof Values) => errors[k]?.message ?? server.errors?.[k];

  const onSubmit = handleSubmit((v) =>
    start(async () => {
      const fd = new FormData();
      Object.entries(v).forEach(([k, val]) => { if (k !== "acceptTerms") fd.set(k, String(val)); });
      if (v.acceptTerms) fd.set("acceptTerms", "on");
      setServer(await startCheckout({ ok: false }, fd)); // redirects to Stripe Checkout on success
    }),
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-8 lg:grid-cols-[1.4fr_1fr]" noValidate>
      <div className="space-y-8">
        <FormMessage state={server} />
        <section aria-labelledby="s1"><h2 id="s1" className="text-xl font-bold">1. About you</h2>
          <div className="mt-4"><Field label="Display name" name="displayName" error={err("displayName")}><Input autoComplete="name" invalid={!!err("displayName")} {...register("displayName")} /></Field></div></section>

        <section aria-labelledby="s2"><h2 id="s2" className="text-xl font-bold">2. Your charity</h2>
          <fieldset className="mt-4"><legend className="sr-only">Choose a charity</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {charities.map((c) => (
                <label key={c.id} className={`cursor-pointer rounded-[var(--radius-md)] border p-4 transition has-[:checked]:border-forest has-[:checked]:bg-mint/50 has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-forest ${chosen?.id === c.id ? "border-forest" : "border-line bg-card hover:border-ink/40"}`}>
                  <input type="radio" value={c.id} className="sr-only" {...register("charityId")} />
                  <span className="block font-semibold leading-snug">{c.name}</span>
                  <span className="mt-1 block text-xs text-muted">{c.category}{c.is_demo ? " · demo charity" : ""}</span>
                </label>
              ))}
            </div>
            {err("charityId") && <p role="alert" className="mt-2 text-sm font-medium text-danger">{err("charityId")}</p>}
            <p className="mt-3 text-sm text-muted">Want to read about them first? <Link className="underline" href="/charities" target="_blank">Browse the directory</Link>.</p>
          </fieldset>
          <div className="mt-6">
            <Field label={`Share of each payment that goes to your charity (min ${minPercent}%)`} name="charityPercent" error={err("charityPercent")}>
              <div className="flex items-center gap-4">
                <input type="range" min={minPercent} max={100} step={1} value={percent} aria-label="Charity percentage" className="h-2 flex-1 accent-[var(--color-coral)]" onChange={(e) => setValue("charityPercent", Number(e.target.value), { shouldValidate: true })} />
                <div className="w-28"><Input type="number" min={minPercent} max={100} step="0.01" invalid={!!err("charityPercent")} {...register("charityPercent")} /></div>
              </div>
            </Field>
          </div>
        </section>

        <section aria-labelledby="s3"><h2 id="s3" className="text-xl font-bold">3. Your plan</h2>
          <fieldset className="mt-4 grid gap-3 sm:grid-cols-2"><legend className="sr-only">Plan</legend>
            {plans.map((p) => (
              <label key={p.id} className="cursor-pointer rounded-[var(--radius-md)] border border-line bg-card p-4 transition has-[:checked]:border-forest has-[:checked]:bg-mint/50 has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-forest">
                <input type="radio" value={p.id} className="sr-only" {...register("plan")} />
                <span className="block font-semibold">{p.name}</span>
                <span className="mt-1 block text-2xl font-bold tabular-nums">{formatMoney(p.amount_minor)}<span className="text-sm font-medium text-muted"> / {p.interval}</span></span>
              </label>
            ))}
          </fieldset>
        </section>

        <div>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4 accent-[var(--color-forest)]" {...register("acceptTerms")} /><span>I agree to the <Link className="underline" href="/terms" target="_blank">terms</Link> and <Link className="underline" href="/privacy" target="_blank">privacy policy</Link>, and understand my subscription renews automatically until I cancel.</span></label>
          {err("acceptTerms") && <p role="alert" className="mt-1 text-sm font-medium text-danger">{err("acceptTerms")}</p>}
        </div>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-[var(--radius-lg)] border border-line bg-card p-6 shadow-soft">
          <h2 className="text-lg font-bold">Your order</h2>
          {plan && split ? (
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between"><dt>{plan.name} plan</dt><dd className="font-bold tabular-nums">{formatMoney(plan.amount_minor)}</dd></div>
              <div className="flex justify-between text-coral"><dt>To {chosen?.name ?? "your charity"} ({bpsToPercent(bps)})</dt><dd className="font-semibold tabular-nums">{formatMoney(split.charityMinor)}</dd></div>
              <div className="flex justify-between"><dt>Prize pool ({bpsToPercent(poolBps)})</dt><dd className="tabular-nums">{formatMoney(split.poolMinor)}</dd></div>
              <div className="flex justify-between"><dt>Platform</dt><dd className="tabular-nums">{formatMoney(split.platformMinor)}</dd></div>
            </dl>
          ) : <p className="mt-4 text-sm text-danger">Charity share and prize pool can't exceed 100% of the payment.</p>}
          <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-muted">Renews every {plan?.interval}. Cancel any time from your billing page; access continues to the end of the paid period. Payment is taken securely by Stripe. Your account is activated only after Stripe confirms payment.</p>
          <button className={`${buttonClass("coral", "lg")} mt-5 w-full`} disabled={pending}>{pending ? "Taking you to checkout…" : "Continue to secure payment"}</button>
        </div>
      </aside>
    </form>
  );
}
