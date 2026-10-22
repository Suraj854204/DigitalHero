import { redirect } from "next/navigation";
import { Logo } from "@/components/site/logo";
import { SideNav } from "@/components/shell/nav";
import { signOut } from "@/app/actions/auth";
import { getMyUnreadCount } from "@/lib/data/subscriber";
import { requireUserPage } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUserPage();
  if (!profile.onboarding_completed_at && profile.role !== "admin") redirect("/onboarding");
  const unread = await getMyUnreadCount();
  const items = [
    { href: "/app", label: "Dashboard" },
    { href: "/app/scores", label: "My scores" },
    { href: "/app/charity", label: "My charity" },
    { href: "/app/contributions", label: "Contributions" },
    { href: "/app/draws", label: "Draws" },
    { href: "/app/winnings", label: "Winnings" },
    { href: "/app/billing", label: "Billing" },
    { href: "/app/notifications", label: "Notifications", badge: unread },
    { href: "/app/profile", label: "Profile" },
  ];
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Logo />
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">{profile.display_name ?? profile.email}</span>
            {profile.role === "admin" && <a className="font-semibold text-forest underline underline-offset-4" href="/admin">Admin</a>}
            <form action={signOut}><button className="rounded-full border border-ink/20 px-4 py-2 font-semibold hover:border-ink/50">Log out</button></form>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-8 lg:grid-cols-[14rem_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start"><SideNav items={items} label="Member" exact={["/app"]} /></aside>
        <main id="main" className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
