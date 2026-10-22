import type { Metadata } from "next";
import { Alert, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Privacy policy" };

export default function Privacy() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <PageHeader eyebrow="Legal" title="Privacy" accent="policy.">How we handle your information.</PageHeader>
      <Alert tone="warn" className="mb-8">Template text for an assessment build. Have a qualified lawyer review and adapt this before launch, including your obligations under applicable data-protection law (for example India's DPDP Act and, if relevant, GDPR).</Alert>
      <div className="space-y-6 leading-relaxed text-ink-2 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-ink">
        <h2>What we collect</h2><p>Account details (email, display name), the golf scores you enter, your charity choice and contribution percentage, subscription and payment status, winnings and the evidence you upload to claim them, and basic technical logs.</p>
        <h2>Payments</h2><p>Card and payment details are handled by Stripe and never stored on our servers. We keep Stripe customer and subscription identifiers and invoice amounts.</p>
        <h2>How we use it</h2><p>To run your subscription, include you in draws, record contributions, verify and pay prizes, prevent fraud and send service messages.</p>
        <h2>What other members can see</h2><p>Nothing about your scores, results or winnings. Published draw results show winning numbers and totals, not participants.</p>
        <h2>Who can see evidence</h2><p>Only you and authorised administrators, through short-lived signed links. Evidence is stored in a private bucket.</p>
        <h2>Retention and your rights</h2><p>We keep financial records as long as the law requires. You can ask us to access, correct or delete your data via the contact page; some records must be retained for accounting and audit purposes.</p>
        <h2>Contact</h2><p>Use our <a className="underline" href="/contact">contact form</a>.</p>
      </div>
    </div>
  );
}
