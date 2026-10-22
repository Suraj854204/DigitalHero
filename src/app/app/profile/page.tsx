import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { requireUserPage } from "@/lib/session";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Profile" };

export default async function Profile() {
  const { profile } = await requireUserPage();
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Profile" title="Your" accent="details." />
      <Card><ProfileForm displayName={profile.display_name ?? ""} /></Card>
      <Card><h2 className="text-lg font-bold">Account</h2><dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between"><dt className="text-muted">Email</dt><dd>{profile.email}</dd></div><div className="flex justify-between"><dt className="text-muted">Terms accepted</dt><dd>{formatDate(profile.terms_accepted_at)}</dd></div></dl><p className="mt-4 text-xs text-muted">To change your email or delete your account, contact us. Some financial records must be retained for audit purposes.</p></Card>
    </div>
  );
}
