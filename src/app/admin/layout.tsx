import { signOut } from "@/app/actions/auth";
import { Logo } from "@/components/site/logo";
import { SideNav } from "@/components/shell/nav";
import { requireAdminPage } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: { default: "Admin", template: "%s | Admin" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireAdminPage();
  const db = createAdminClient();
  const [{ count: reviews }, { count: payouts }] = await Promise.all([
    db.from("winner_evidence").select("id", { count: "exact", head: true }).eq("review_status", "pending"),
    db.from("payouts").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  const items = [
    { href: "/admin", label: "Overview" }, { href: "/admin/users", label: "Users" }, { href: "/admin/subscriptions", label: "Subscriptions" },
    { href: "/admin/charities", label: "Charities" }, { href: "/admin/draws", label: "Draws" }, { href: "/admin/winners", label: "Winners", badge: reviews ?? 0 },
    { href: "/admin/payouts", label: "Payouts", badge: payouts ?? 0 }, { href: "/admin/contributions", label: "Contributions" }, { href: "/admin/reports", label: "Reports" },
    { href: "/admin/audit-logs", label: "Audit log" }, { href: "/admin/settings", label: "Settings" },
  ];
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-ink text-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5">
          <div className="flex items-center gap-3"><span className="[&_a]:text-white"><Logo /></span><span className="rounded-full bg-coral px-2.5 py-0.5 font-mono text-xs uppercase tracking-widest">Admin</span></div>
          <div className="flex items-center gap-3 text-sm"><a href="/app" className="underline underline-offset-4">Member view</a><span className="hidden text-white/70 sm:inline">{profile.email}</span>
            <form action={signOut}><button className="rounded-full border border-white/30 px-3 py-1.5 font-semibold hover:bg-white/10">Log out</button></form></div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-8 lg:grid-cols-[13rem_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start"><SideNav items={items} label="Admin" exact={["/admin"]} /></aside>
        <main id="main" className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
