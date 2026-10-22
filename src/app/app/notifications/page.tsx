import type { Metadata } from "next";
import { markNotificationRead, markNotificationsRead } from "@/app/actions/member";
import { buttonClass } from "@/components/ui/button-styles";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { requireUserPage } from "@/lib/session";
import { createUserClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Notifications" };

export default async function Notifications() {
  await requireUserPage();
  const supabase = await createUserClient();
  const { data } = await supabase.from("notifications").select("id, title, body, created_at, read_at").order("created_at", { ascending: false }).limit(50);
  const unread = (data ?? []).filter((n) => !n.read_at).length;
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Notifications" title="What's" accent="new." actions={unread > 0 ? <form action={markNotificationsRead}><button className={buttonClass("secondary", "sm")}>Mark all as read</button></form> : undefined} />
      {(data ?? []).length === 0 ? <EmptyState title="You're all caught up">Updates about draws, your proof reviews and payouts will show up here.</EmptyState> : (
        <ul className="space-y-3">{data!.map((n) => (<li key={n.id}><Card className={`p-5 ${n.read_at ? "opacity-70" : "border-forest/40"}`}><div className="flex items-start justify-between gap-4"><div><p className="font-semibold">{!n.read_at && <span aria-label="Unread" className="mr-2 inline-block size-2 rounded-full bg-coral" />}{n.title}</p>{n.body && <p className="mt-1 text-sm text-ink-2">{n.body}</p>}<p className="mt-2 text-xs text-muted">{formatDate(n.created_at, true)}</p></div>
          {!n.read_at && <form action={markNotificationRead}><input type="hidden" name="id" value={n.id} /><button className="text-sm font-semibold text-forest underline">Mark read</button></form>}</div></Card></li>))}</ul>)}
    </div>
  );
}
