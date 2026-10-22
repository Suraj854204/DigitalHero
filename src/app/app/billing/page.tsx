import type { Metadata } from "next";
import Link from "next/link";
import { openBillingPortal, setCancelAtPeriodEnd } from "@/app/actions/billing";
import { ConfirmForm } from "@/components/ui/confirm";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert, Card, LinkButton, Money, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { getPlans } from "@/lib/data/public";
import { getMyContributions, getMySubscription } from "@/lib/data/subscriber";
import { formatDate } from "@/lib/format";
import { requireUserPage } from "@/lib/session";

export const metadata: Metadata = { title: "Billing" };

export default async function Billing({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireUserPage();
  const [sub, plans, payments] = await Promise.all([getMySubscription(), getPlans(), getMyContributions()]);
  const plan = plans.find((p) => p.id === sub?.plan_id);
  const invoices = payments.filter((p) => p.kind !== "subscription_annual_installment").slice(0, 12);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Billing" title="Your" accent="subscription.">Payments are handled by Stripe. Your status updates only when Stripe confirms a change.</PageHeader>
      {sp.portal === "unavailable" && <Alert tone="warn">The billing portal isn't available in this environment (Stripe isn't connected, or you don't have a subscription yet).</Alert>}
      {sp.updated && <Alert tone="success">Done. Your subscription will reflect this as soon as Stripe confirms it.</Alert>}
      {!sub ? (
        <Card><h2 className="text-lg font-bold">No subscription yet</h2><p className="mt-2 text-sm text-ink-2">Choose a plan and a charity to start.</p><div className="mt-4"><LinkButton href="/onboarding" variant="coral">Choose a plan</LinkButton></div></Card>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">{plan?.name ?? sub.plan_id} plan</h2><StatusBadge status={sub.status} /></div>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
            <div><dt className="text-muted">Price</dt><dd className="font-semibold">{plan ? <><Money minor={plan.amount_minor} /> / {plan.interval}</> : "-"}</dd></div>
            <div><dt className="text-muted">{sub.cancel_at_period_end ? "Access ends" : "Next renewal"}</dt><dd className="font-semibold">{formatDate(sub.current_period_end)}</dd></div>
            <div><dt className="text-muted">Started</dt><dd className="font-semibold">{formatDate(sub.created_at)}</dd></div>
          </dl>
          {sub.status === "past_due" && <Alert tone="error" className="mt-5">Your last payment failed. Update your card in the portal to stay in the draw.</Alert>}
          <div className="mt-6 flex flex-wrap gap-3">
            <form action={openBillingPortal}><SubmitButton variant="secondary" size="sm" pendingText="Opening…">Manage payment method & invoices</SubmitButton></form>
            {sub.status === "active" && <ConfirmForm action={setCancelAtPeriodEnd} trigger="Cancel subscription" triggerVariant="ghost" title="Cancel at the end of this period?" confirmLabel="Yes, cancel" variant="danger"
              description={<>You'll keep full access, and your place in the draw, until <strong>{formatDate(sub.current_period_end)}</strong>. After that you won't be charged again. You can change your mind before then.</>}><input type="hidden" name="cancel" value="true" /></ConfirmForm>}
            {sub.status === "canceling" && <form action={setCancelAtPeriodEnd}><input type="hidden" name="cancel" value="false" /><SubmitButton size="sm" pendingText="Updating…">Keep my subscription</SubmitButton></form>}
          </div>
        </Card>
      )}
      <section><h2 className="mb-3 text-lg font-bold">Recent payments</h2>
        {invoices.length === 0 ? <p className="text-sm text-muted">No confirmed payments yet.</p> : (
          <ul className="divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-card">{invoices.map((p) => <li key={p.id} className="flex justify-between gap-3 px-5 py-3 text-sm"><span>{formatDate(p.recognized_at)} · {p.invoice_id}</span><Money minor={p.amount_minor} className="font-semibold" /></li>)}</ul>)}
        <p className="mt-3 text-xs text-muted">Full invoices and receipts are available in the Stripe portal. <Link className="underline" href="/app/contributions">See where each payment went</Link>.</p></section>
    </div>
  );
}
