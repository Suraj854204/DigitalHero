"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/authz";
import { friendlyDbError } from "@/lib/db-errors";
import { getSession } from "@/lib/session";
import { createUserClient } from "@/lib/supabase/server";
import { formObject, zodErrors, type ActionState } from "@/lib/validation";

const selectSchema = z.object({
  charityId: z.string().uuid("Choose a charity."),
  percent: z.coerce.number().min(10, "The minimum is 10%.").max(100, "The maximum is 100%."),
});

/** New selection row; applies to payments recognised from now on. History is preserved. */
export async function changeCharity(_p: ActionState, fd: FormData): Promise<ActionState> {
  requireActor((await getSession())?.actor);
  const parsed = selectSchema.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("select_charity", { p_charity: parsed.data.charityId, p_bps: Math.round(parsed.data.percent * 100) });
  if (error) return { ok: false, message: friendlyDbError(error.message) };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Saved. This applies to payments recorded from now on; earlier contributions keep the charity they were booked to." };
}

const profileSchema = z.object({ displayName: z.string().trim().min(1, "Enter a name.").max(80) });
export async function updateProfile(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = requireActor((await getSession())?.actor);
  const parsed = profileSchema.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  const supabase = await createUserClient();
  const { error } = await supabase.from("profiles").update({ display_name: parsed.data.displayName }).eq("id", actor.id);
  if (error) return { ok: false, message: "We couldn't save that. Please try again." };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Profile updated." };
}

export async function markNotificationsRead(): Promise<void> {
  const actor = requireActor((await getSession())?.actor);
  const supabase = await createUserClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", actor.id).is("read_at", null);
  revalidatePath("/app", "layout");
}

export async function markNotificationRead(fd: FormData): Promise<void> {
  const actor = requireActor((await getSession())?.actor);
  const id = String(fd.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const supabase = await createUserClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).eq("user_id", actor.id);
  revalidatePath("/app", "layout");
}
