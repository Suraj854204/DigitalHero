import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/site/logo";
import { Alert } from "@/components/ui/primitives";
import { getCharities, getPlans, getPublicSettings } from "@/lib/data/public";
import { requireUserPage } from "@/lib/session";
import { createUserClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Finish joining" };

export default async function Onboarding({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { profile } = await requireUserPage();
  const supabase = await createUserClient();
  const { data: sub } = await supabase.from("subscriptions").select("status").maybeSingle();
  if (sub && ["active", "canceling", "past_due"].includes(sub.status)) redirect("/app");

  const [{ items }, plans, settings] = await Promise.all([getCharities({ pageSize: 48 }), getPlans(), getPublicSettings()]);
  const preCharity = items.find((c) => c.slug === sp.charity);
  const prePlan = sp.plan === "yearly" ? "yearly" : "monthly";

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line"><div className="mx-auto flex h-16 max-w-5xl items-center px-5"><Logo /></div></header>
      <main id="main" className="mx-auto max-w-5xl px-5 py-12">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-forest">Almost there</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Choose your charity <span className="serif-accent">and plan.</span></h1>
        <p className="mt-3 max-w-2xl text-ink-2">You'll see exactly what you'll pay and where it goes before you continue to payment.</p>
        {sp.canceled && <Alert tone="warn" className="mt-6">Checkout was cancelled. Nothing has been charged, and you can try again whenever you're ready.</Alert>}
        <div className="mt-10">
          <OnboardingForm
            charities={items.map((c) => ({ id: c.id, name: c.name, category: c.category, is_demo: c.is_demo }))}
            plans={plans}
            minPercent={settings.minCharityBps / 100}
            poolBps={settings.prizePoolBps}
            defaults={{ displayName: profile.display_name ?? "", charityId: preCharity?.id, plan: prePlan }}
          />
        </div>
      </main>
    </div>
  );
}
