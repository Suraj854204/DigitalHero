import type { Metadata } from "next";
import { Alert, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Terms of service" };

export default function Terms() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <PageHeader eyebrow="Legal" title="Terms of" accent="service.">The rules of using Digital Heroes.</PageHeader>
      <Alert tone="warn" className="mb-8">Template text for an assessment build. Prize draws, subscriptions and charitable fundraising are regulated differently in different places. Get legal advice before launching, including on whether a prize draw requires a licence or registration where you operate.</Alert>
      <div className="space-y-6 leading-relaxed text-ink-2 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-ink">
        <h2>1. The service</h2><p>Digital Heroes is a subscription that lets you record golf scores, supports a charity you choose, and enters you in a monthly prize draw while you are eligible.</p>
        <h2>2. Subscriptions and renewal</h2><p>Plans renew automatically each month or year until cancelled. You can cancel at any time from your billing page and keep access until the end of the paid period.</p>
        <h2>3. Charity contributions</h2><p>At least 10% of each subscription payment is allocated to your chosen charity and recorded in our ledger. Changing your charity applies to payments recognised afterwards. Allocation is a record of the amount owed to the charity; transfers to charities are made periodically and are not tax-deductible receipts unless we state so.</p>
        <h2>4. Draws and prizes</h2><p>Eligibility requires an active subscription and five valid scores at the eligibility cutoff. Five numbers from 1 to 45 are drawn. Prize shares are published and shared equally within tiers. Prizes are not guaranteed. Published results are final except for documented, audited corrections.</p>
        <h2>5. Verification and payouts</h2><p>Winners must provide evidence of their scores. We may reject unverifiable claims. Approved prizes are paid by an external transfer and recorded with a reference.</p>
        <h2>6. Fair play</h2><p>You must enter genuine scores. Fraudulent entries can lead to disqualification and account suspension.</p>
        <h2>7. Changes and liability</h2><p>We may update these terms with notice. To the extent permitted by law, we are not liable for indirect losses.</p>
      </div>
    </div>
  );
}
